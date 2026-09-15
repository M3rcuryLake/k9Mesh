<div align="center">
 
# K9Mesh
 
### Distributed Wi-Fi CSI Sensing Platform for Life-Sign Detection in Collapsed Structures

**Wi-Fi Channel State Information • Embedded Telemetry • Real-Time Signal Processing**

![Platform](https://img.shields.io/badge/Platform-ESP32%20%7C%20ESP32--S3-blue)
![Status](https://img.shields.io/badge/Status-Active%20Development-orange)
![Application](https://img.shields.io/badge/Application-CSSR-red)

</div>


## About

K9Mesh is an RF life-sign detection platform for **Collapsed Structure Search and Rescue (CSSR)**. It uses passive Wi-Fi Channel State Information (CSI) from commodity single-antenna ESP32 hardware to detect human motion and estimate respiration rate through visually opaque obstacles, and tags every RF observation with the live pose of a teleoperated rover.

The sensing core is a laptop-side port and extension of the [Micro-ESPectre](https://github.com/francescopace/micro-espectre) CSI engine. Its stock motion-detection pipeline is preserved: NBVI-selected subcarrier bands → spatial turbulence (σ/CV) → Hampel-filtered moving-variance segmentation against an adaptive baseline threshold — augmented with a trainable MLP classifier over nine turbulence-window statistics running in parallel on the same stream.

Beyond motion, K9Mesh adds a dedicated respiration estimator that recovers breathing rate from the sub-Hz amplitude undulations a stationary torso imprints on the channel: the calibrated band is collapsed to a per-packet amplitude scalar, scrubbed by a streaming MAD-based Hampel filter, detrended, resampled to a uniform 10 Hz grid over a 60 s sliding window, and transformed via FFT for a band-limited peak search in **0.15–0.5 Hz (10–30 breaths per minute)**. Detections are gated by spectral SNR (≥ 3) and suppressed while the motion detector reports activity — platform-induced movement dominates the respiratory band — and each estimate ships with confidence, spectral-purity, and harmonic-ratio metrics rather than a bare BPM number.

Everything runs on off-the-shelf parts — three ESP32-class boards, an L298N drive stage, FC-03 wheel encoders, and an MPU9250 IMU — with a React-based ground control station for live telemetry.


## System Overview

K9Mesh is a four-node distributed system. Each node owns a single responsibility and communicates over a dedicated transport:

| Node | Hardware | Transport | Responsibility |
|------|----------|-----------|----------------|
| Teleoperation TX | ESP32 (joystick) | ESP-NOW, 20 Hz | Manual rover control |
| Rover RX | ESP32 + L298N + FC-03 ×2 + MPU9250 | — | Drive, encoder ISR, IMU, odometry relay |
| CSI node | ESP32-S3 (MicroPython) | UDP :5005 | CSI capture, gain lock, odometry muxing |
| Host pipeline + GCS | Laptop (Python + Node) | WebSocket :8080 / HTTP :3001 | DSP, detection, dead reckoning, visualization |

```
 ┌──────────────────┐  ESP-NOW 2.4 GHz   ┌──────────────────────┐  UART2 115200 8N1  ┌────────────────────────┐
 │ TX: joystick     │ ─────────────────► │ RX: L298N · FC-03 ×2 │ ─────────────────► │ S3: CSI node           │
 │ deadman · 20 Hz  │  {x, y, stop}      │ MPU9250 @ 400kHz I²C │  CSV odom ~10 Hz   │ MicroPython · gain lock│
 └──────────────────┘                    └──────────────────────┘                    │ HT20 CSI · UDP stream  │
                                                                                     └───────────┬────────────┘
                                                                                                 │ UDP :5005
                                                                                                 ▼
                                               ┌────────────────────────┐   WebSocket :8080   ┌──────────────────────┐
                                               │ Host pipeline          │ ──────────────────► │ GCS (k9ui) :3001    │
                                               │ NBVI · MVS · MLP · FFT │                     │ React · Vite ·      │
                                               │ dead reckoning         │                     │ Leaflet · Tailwind  │
                                               └────────────────────────┘                     └──────────────────────┘
```

### Rover subsystem (`rover/`)

- **TX (`transmitter.ino`)** — reads a two-axis analog joystick (ADC1 pins, WiFi-safe) and an active-low deadman button, auto-calibrates the stick center at boot, and broadcasts a 5-byte struct (`int16 x`, `int16 y`, `bool stop`) to a fixed receiver MAC at 20 Hz over unencrypted ESP-NOW.
- **RX (`receiver.ino`)** — decodes control frames into arcade-mixed left/right PWM commands (5 kHz, 8-bit LEDC) for an L298N H-bridge; counts FC-03 encoder pulses in RISING-edge `IRAM_ATTR` ISRs (direction inferred from commanded speed sign); samples the MPU9250 over I²C at 400 kHz with correct MPU-9250 die-temperature conversion (333.87 LSB/°C, 21 °C offset); and relays packed odometry as ASCII CSV lines (`ticksL,ticksR,ax..gz,tempC,mpu_ok`) over UART2 at 115200 8N1.

Full electrical detail — pinout tables, power rails, operating and absolute-maximum ratings — is in **[DATASHEET.md](DATASHEET.md)** (rev 1.2); the schematic is in `Circuit-Diagram.png`.

### CSI node (`wifi/src/`)

The ESP32-S3 runs a MicroPython CSI streamer (`main.py`):

- Station-mode association at 802.11 b/g/n, **HT20** (64 subcarriers), 2.4 GHz-only, power management disabled, optional **BSSID lock** for stable multipath geometry.
- **Gain lock**: median AGC/FFT gain over 300 packets is forced via `csi_force_gain()` to stabilize amplitude scale. Modes: `auto` (skip and fall back to coefficient-of-variation normalization when AGC < 30, i.e. signal too strong), `enabled`, `disabled`.
- **Traffic generation** (ping or DNS mode) ensures a continuous packet stream for CSI sampling.
- Odometry is polled from UART in the main loop and **muxed into every CSI datagram**, so RF samples and pose data arrive in a single atomic packet.

**Wire format** (host `receiver.py` must match exactly):

| Field | Layout |
|-------|--------|
| Header (12 B) | `seq` u32 · `timestamp_us` u32 · `channel` u16 · `rssi` i8 · `csi_len` u8 |
| Odometry block (27 B) | `ticksL` i32 · `ticksR` i32 · `ax..az, gx..gz` i16 ×6 · `temp_c_x10` i16 · `mpu_ok` u8 |
| CSI payload (128 B) | 64 subcarriers × (Q, I) int8 pairs, HT20 |

---

## Host-Side Signal Processing (`wifi/host/`)

The host receives the UDP stream and runs the full detection pipeline per packet.

### 1. Acquisition (`receiver.py`)

Binds the UDP socket (optionally to a single interface via `SO_BINDTODEVICE`), parses the fixed-width struct, decodes subcarrier amplitudes as |H| = √(I² + Q²), tracks sequence numbers for loss accounting, and derives odometry freshness by diffing consecutive samples (the firmware repeats the last odom block because odometry updates at ~10 Hz while CSI arrives faster).

### 2. Calibration (`nbvi.py`, `csi_dsp.py`)

Before detection, a still-room calibration window (default **13 s**, ~50 warm-up packets) runs the **NBVI (Normalized Baseline Variability Index)** calibrator:

1. Buffers baseline CSI frames into an `n × 64` matrix.
2. Finds candidate quiet windows via percentile-based detection.
3. Scores all valid subcarriers (guard bands 11–52 and the DC bin 32 excluded, null subcarriers gated) using four selection strategies — *Entropy Spaced*, *MAD Clustered*, *Classic Spaced*, *Classic Clustered*.
4. Validates each candidate **12-subcarrier band** by running it through the real `MVSDetector` and measuring its false-positive rate on the baseline (P95 × 1.1 adaptive threshold).

The winning band is reused by the MVS motion detector, the respiration estimator, and the spectrogram — one calibration, shared by every downstream consumer. If NBVI fails, the fixed `DEFAULT_BAND` (`[12, 14, 16, 18, 20, 24, 28, 36, 40, 44, 48, 52]`) is used as the documented upstream fallback.

### 3. Motion detection (`mvs_detector.py`)

Per-packet pipeline, matching Micro-ESPectre's algorithm definitions:

```
band amplitudes → spatial turbulence (σ, or CV when not gain-locked)
              → Hampel filter (MAD-based, window 5, 6.0×)
              → 1st-order low-pass IIR (11 Hz cutoff @ 100 Hz)
              → moving variance over a sliding window (75 packets)
              → adaptive threshold (P95 × factor of baseline MV)
              → IDLE / MOTION with hysteresis (1 hit on, 5 hits off)
```

The threshold factor is the primary sensitivity lever: stock is 1.1; setting it to 0.7 places the threshold below typical baseline noise so nearly any deviation registers as motion.

A scalar confidence in [0, 100] is derived from the variance/threshold ratio and published alongside the state.

### 4. ML motion classifier (`ml_detector.py`, `ml_features.py`)

A parallel detector: an sklearn `MLPClassifier` (9 → 32 → 16 → 1, with `StandardScaler`) over **nine turbulence-window features** — mean, std, MAD, IQR, peak-to-peak, mean absolute first difference, skewness, excess kurtosis, zero-crossing rate — computed on the same Hampel/low-pass filtered turbulence stream but on the fixed `DEFAULT_BAND` with raw std (CV normalization is deliberately disabled for ML, per upstream).

Models are not shipped pretrained (feature definitions are a reconstruction; upstream weights are incompatible). Train your own:

```bash
# 1. Collect labeled runs — one label per run, several runs per class
sudo python collect_data.py --interface wlp2s0 --label baseline --duration 120 --out data/baseline_01.npz
sudo python collect_data.py --interface wlp2s0 --label movement --duration 60  --out data/movement_01.npz

# 2. Train
python train_model.py --data "data/*.npz" --out ../models/model.pkl
```

The bundle (`model.pkl`) is loaded from `wifi/models/`; if absent, ML detection disables itself gracefully and MVS remains the only motion source.

### 5. Respiration estimation (`respiration.py`)

Breathing manifests as sub-Hz CSI amplitude fluctuations. The estimator consumes the same NBVI-selected band — mean band amplitude per packet — and runs:

```
band amplitude → streaming Hampel filter (window 7, 5.0 MAD)
             → 60 s sliding buffer (packet timestamps + filtered values)
             → unique/sort (relay-jitter guard)
             → quadratic detrend → linear resample @ 10 Hz
             → FFT → band-limited peak search in [0.15, 0.5] Hz
```

The operating band corresponds to **10–30 breaths per minute**. Results are SNR-gated (minimum 3.0) and evaluation is **motion-gated**: the detector only runs while MVS reports `idle`, and only once ≥ 30 s of samples are buffered.

Each evaluation emits a `BreathResult`:

| Field | Meaning |
|-------|---------|
| `rate_bpm` | Estimated respiration rate (null if no significant peak) |
| `snr` | Peak-to-noise-floor ratio |
| `confidence` | 0–1 trust score for `rate_bpm` |
| `spectral_purity` | Peak power / total in-band power |
| `band_power_frac` | In-band power / total spectral power |
| `harmonic_ratio` | Power at 2× peak frequency / power at peak (harmonic discriminant) |

### 6. Dead reckoning (`dead_reckoning.py`)

Differential-drive odometry from encoder tick deltas, with heading integrated from the MPU9250 **gyro-z** rather than the tick differential (tick-based heading drifts hard under wheel slip on TT gearmotors). Position updates use **midpoint integration** (heading evaluated at the step midpoint), halving first-order error versus naive Euler. Gyro scaling follows the firmware's ±250 dps full scale (131 LSB/(°/s)); a tick-differential heading fallback engages if the IMU reports bad data. Robot geometry is configurable: wheel radius, ticks-per-revolution (`20 × 24` gear ratio × 20-hole disc), and wheelbase (must be measured on the chassis).

### 7. Spectrogram (`spectrogram.py`)

Per packet, the calibrated band's raw amplitudes are min-max normalized and mapped to an HSV colormap (hue 240° → 0°), producing an RGB row per hop boundary. The most recent row is attached to **every** telemetry frame once the buffer has filled, so the UI renders a continuous band-level spectrogram instead of strobing at hop boundaries.


## Ground Control Station (`k9ui/`, `runner.py`)

`runner.py` is an asyncio process orchestrator: it starts the Express bridge, then either the Vite dev server (`--dev`) or a production build (opened in the browser). SIGINT/SIGTERM trigger an idempotent staged shutdown (terminate → 5 s grace → kill).

`k9ui/server/bridge.js` (port **3001**) provides:

- `POST /api/start` — spawns `wifi/host/main.py` with `--interface`, `--model`, `--port` and optional `--calibration-seconds` / `--skip-calibration`; rejects concurrent runs (409); validates model presence up front.
- `POST /api/stop` — SIGTERM with SIGKILL escalation after 5 s.
- `GET /api/status` — `{ running, pid, error, firstPacket }`; `firstPacket` flips when the host reports `FIRST_PACKET_RECEIVED`.
- Static hosting of the built UI bundle.

`wifi/host/main.py` fans telemetry out over **`ws://127.0.0.1:8080`**; the React client (`TelemetryProvider`) consumes it through rolling-window hooks. The dashboard renders:

- **TelemetryPanel** — RSSI, packet loss, MVS state/variance/threshold/confidence, ML score, IMU die temperature, stale-data flags
- **LiveGraph** — motion variance vs. adaptive threshold, respiration rate, ML score timelines
- **Spectrogram** — streaming band-level CSI amplitude imagery
- **RoverMap** — live pose on a Leaflet map

A mock telemetry generator supports UI development without hardware.

### Telemetry schema

```json
{
  "seq": 1234,
  "timestamp_us": 1723015324123456,
  "channel": 6,
  "rssi": -58,
  "dropped": 2,
  "band": [12, 14, 16, 18, 20, 24, 28, 36, 40, 44, 48, 52],
  "mvs":   { "state": "idle", "variance": 1.2e-4, "threshold": 4.5e-4, "confidence": 27.3 },
  "ml":    { "ready": true, "score": 0.02, "detection": "idle", "enabled": true },
  "breath": {
    "rate_bpm": 15.4, "snr": 6.1, "confidence": 0.81, "peak_freq_hz": 0.26,
    "spectral_purity": 0.62, "band_power_frac": 0.44, "harmonic_ratio": 0.09, "n_samples": 600
  },
  "pose": { "x": 0.42, "y": -0.15, "theta_deg": 92.1 },
  "temperature_c": 39.2,
  "stale": false,
  "csi_spectrogram_row": [[23, 41, 255], [30, 68, 240], "..."]
}
```

`pose` is the dead-reckoned rover frame `(x, y, θ)`; `stale` indicates the odometry block is a repeat (not freshly updated); `temperature_c` is the MPU9250 die temperature (suppressed when the sample is not backed by a valid `mpu_ok` reading).


## Repository Layout

```
K9Mesh/
├── rover/                      # ESP32 teleoperation firmware (Arduino)
│   ├── transmitter.ino         #   Joystick TX — ESP-NOW control frames
│   └── receiver.ino            #   Drive, encoder ISRs, IMU, UART odom relay
│
├── wifi/                       # CSI sensing subsystem
│   ├── firmware/               #   Prebuilt MicroPython CSI firmware (ESP32, ESP32-S3)
│   ├── setup.py                #   Flash/deploy tooling (esptool + SHA256-verified releases)
│   ├── main.py                 #   Device entry point
│   ├── src/                    #   MicroPython CSI streamer
│   │   ├── main.py             #     WiFi/CSI init, gain lock, UDP streaming, odom mux
│   │   ├── config.py(.example) #     Credentials, gain-lock mode, traffic gen (config_local.py overrides)
│   │   ├── traffic_generator.py#     Ping/DNS packet generation
│   │   └── utils.py            #     HT20 payload normalization, I/Q helpers
│   ├── host/                   #   Host-side pipeline (Python 3.13)
│   │   ├── receiver.py         #     UDP ingest, struct parsing, amplitude extraction
│   │   ├── main.py             #     Calibration, detection loop, WebSocket fan-out
│   │   ├── csi_dsp.py          #     Hampel, low-pass, turbulence, moving variance, thresholds
│   │   ├── nbvi.py             #     Multi-strategy subcarrier-band calibration
│   │   ├── mvs_detector.py     #     Moving-variance segmentation motion detector
│   │   ├── ml_detector.py      #     MLP motion classifier (inference)
│   │   ├── ml_features.py      #     9-feature turbulence-window extraction
│   │   ├── train_model.py      #     MLP training (sklearn)
│   │   ├── collect_data.py     #     Labeled CSI dataset collection
│   │   ├── respiration.py      #     FFT-based breathing-rate estimator
│   │   ├── dead_reckoning.py   #     Differential-drive odometry + gyro heading
│   │   └── spectrogram.py      #     Band-normalized HSV spectrogram rows
│   ├── models/model.pkl        #   Trained model bundle (scaler + MLP)
│   └── requirements.txt
│
├── k9ui/                       # Ground control station
│   ├── server/bridge.js        #   Express bridge — REST control, process spawn, static host
│   └── src/                    #   React 18 + Vite + Tailwind telemetry UI
│
├── runner.py                   # Orchestrator — bridge + build/dev, signal-safe shutdown
├── DATASHEET.md                # Hardware datasheet (pinout, power, ratings) rev 1.2
├── Circuit-Diagram.png
└── README.md
```

---

## Build & Run

### Prerequisites

- **Rover firmware**: Arduino IDE or CLI with the ESP32 Arduino core ≥ 3.0 (LEDC API), flash `rover/transmitter.ino` and `rover/receiver.ino`; set the receiver MAC in the transmitter.
- **CSI node**: flash `wifi/firmware/ESP32_CSI_S3.bin` via `wifi/setup.py` (SHA256-verified against the upstream Micro-ESPectre release) or deploy `wifi/src/` with `mpremote`. Configure credentials in `wifi/src/config_local.py` (copy from `config_local.py.example`): SSID, password, host IP, optional BSSID lock, gain-lock mode, traffic-generator rate.
- **Host + GCS**: Python 3.13 with `pip install -r wifi/requirements.txt`; Node.js ≥ 18 with `npm install` inside `k9ui/`.

### Running the full stack

```bash
# Production: builds the UI, starts bridge on :3001, opens browser
python runner.py

# Development: bridge on :3001 + Vite dev server with HMR
python runner.py --dev
```

Start acquisition from the UI (enter your monitor interface, choose calibration mode), or manually:

```bash
cd wifi/host
sudo python main.py --interface wlp2s0            # NBVI calibration (13 s), then live detection
sudo python main.py --interface wlp2s0 --skip-calibration   # DEFAULT_BAND, MVS variance-only
```

`sudo` is only required for `SO_BINDTODEVICE` interface binding; without root the receiver falls back to all interfaces. The host listens for CSI on UDP :5005 and broadcasts telemetry on WebSocket :8080.

### Operating notes

- Calibration requires a **still room**: the NBVI baseline and the MVS adaptive threshold are both derived from it, and respiration reuses the selected band.
- `--skip-calibration` disables the motion flag entirely (variance is reported but no threshold exists) — useful for signal inspection.
- Respiration estimates are only meaningful while the rover is stationary and MVS is `idle`; platform-induced motion dominates the sub-Hz band otherwise.


## Hardware

| Component | Role |
|-----------|------|
| ESP32 (TX) | Joystick transmitter, ESP-NOW |
| ESP32 (RX) | Motor control, encoder ISR, IMU master |
| ESP32-S3 | Odometry sink + CSI acquisition (MicroPython) |
| L298N | Dual H-bridge motor driver (2S Li-ion, 7.4 V nominal) |
| FC-03 ×2 | Wheel-speed encoders (interrupt-driven, 3.3 V) |
| MPU9250 | 9-DoF IMU, 400 kHz I²C |
| Laptop | Host DSP pipeline + ground control station |

See **[DATASHEET.md](DATASHEET.md)** for complete pinouts, power-tree analysis, recommended operating conditions, absolute-maximum ratings, and design errata (ADC1-vs-ADC2 WiFi constraints, 3.3 V rail loading, ESP-NOW security notes).


## Implementation Status
- [x] Teleoperation (ESP-NOW, arcade mix, deadman)
- [x] Encoder/IMU odometry relay (UART)
- [x] CSI acquisition + AGC/FFT gain lock (HT20)
- [x] NBVI subcarrier-band calibration
- [x] MVS motion detection (adaptive threshold, hysteresis)
- [x] MLP motion classifier (train + infer)
- [x] Respiration estimation (FFT, SNR-gated, motion-gated)
- [x] Dead reckoning (midpoint integration, gyro heading)
- [x] CSI spectrogram
- [x] GCS bridge + live dashboard


## Contributing
Contributions are welcome across embedded systems, RF sensing, signal processing, and frontend engineering. Bug reports, feature requests and pull requests are encouraged.



## Acknowledgements
- **Micro-ESPectre** — the CSI engine and algorithm definitions this project extends (`csi_dsp.py`, `nbvi.py` are ports of the upstream ESP32-S3 firmware implementations; NBVI is © Francesco Pace, GPLv3)
- **Espressif Systems** — ESP-IDF/Arduino core, ESP-NOW, CSI APIs
- **Random Nerd Tutorials** — ESP-NOW reference patterns used in the rover firmware


## References
[1] *SA-WiSense: A Blind-Spot-Free Respiration Sensing Framework for Single-Antenna Wi-Fi Devices.*
[2] *TwSense: Highly Robust Through-the-Wall Human Detection Method Based on COTS Wi-Fi Device.*
[3] *VitalCSI: Contactless Respiratory Rate Estimation Using Consumer-Grade Wi-Fi Channel State Information.*
[4] *RaliSense: Extending WiFi Respiratory Detection Range by Rapid Alignment of Dynamic Components.*

