# K9Mesh Ground Control Station — Live Telemetry Integration Test Specification

**Document Identifier:** `K9MESH-SPEC-INT-10.0`  
**Target Environment:** Electron Main + Renderer Desktop Console  
**Transport:** Local WebSocket (`ws://127.0.0.1:8080`)  
**Ingestion Schema:** Micro-ESPectre Raw Ingest $\rightarrow$ Master ICD 1.0  
**Status:** Authoritative Engineering Integration Specification  

---

## 1. Prerequisites

Before executing the live integration test, ensure the host development environment meets the following specifications:

*   **Operating System:** Windows 10/11, macOS 12+, or Ubuntu 22.04+
*   **Node.js Runtime:** `v18.0.0` or higher (`v20+` recommended)
*   **Package Manager:** `npm` (v9+)
*   **Python Runtime:** Python `3.10` or higher
*   **Python Dependencies:** `websockets` library installed in the active Python environment:
    ```bash
    pip install websockets
    ```
*   **Network Port:** Port `8080` must be free and unblocked on `localhost` (`127.0.0.1`).

---

## 2. Installation & Build

Build the production bundles and TypeScript compilation targets for both the Renderer and Electron Main process:

```bash
# 1. Install Node dependencies
npm install

# 2. Compile TypeScript and Vite production bundle
npm run build:app
```

---

## 3. Launching Electron in Integration Test Mode

Start the K9Mesh Ground Control Station in **Integration Test Mode**. In this mode, the `SourceFactory` automatically configures `WebSocketTelemetrySource` on `ws://127.0.0.1:8080` as the active telemetry transport.

```bash
npm run integration:test
```

### Expected Startup Output
```text
[SourceFactory] Integration Test Mode active — configured WebSocket telemetry transport.
[WS] Listening on ws://127.0.0.1:8080
[WS] Waiting for producer...
```

---

## 4. Launching the Python Micro-ESPectre Producer

Open a second terminal window and execute the live hardware test producer:

### Option A: Active Motion Mode (Phase 10 Hardware Target)
```bash
python scratch/test_producer.py --rate-hz 10.0
```

### Option B: Stable / Stationary Mode (No Motion)
```bash
python scratch/test_producer.py --stable --rate-hz 10.0
```

---

## 5. Expected Console Output Sequence

When the live telemetry pipeline is actively streaming, console logs across all architectural layers appear in concise operational format:

```text
# Step 1: Producer Connects
[WS] Producer connected from 127.0.0.1

# Step 2: Packet Arrival (10 Hz)
[WS] Packet received seq=11708

# Step 3: Schema Normalization & Zero-Synthetic Mapping
[Adapter] Packet normalized (seq: 11708)

# Step 4: Multi-Rule Verification (Schema, Enum, Engineering Bounds)
[Validator] Packet accepted

# Step 5: High-Speed Preload IPC Broadcast
[Host] Telemetry published (dispatch time: 0ms)
```

---

## 6. End-to-End Field Verification Matrix

| Backend Field | Received Value | Master ICD Field | Target UI Widget | Display Behavior |
| :--- | :--- | :--- | :--- | :--- |
| `seq` | `11708` | `sequence` | Header / Sequence Tracker | Monotonically increments |
| `timestamp_us` | `959410021` | `timestamp_epoch_ms` | Header / Telemetry Timestamp | Advances continuously |
| `channel` | `5` | `radio.channel` | COMMS & SIGNAL / Link | Active channel 5 |
| `rssi` | `-61` | `radio.rssi` | COMMS & SIGNAL / Signal Bar | Signal: `[||||||||--] 78%` |
| *(derived)* | `-61 dBm` | `radio.linkQuality` | COMMS & SIGNAL / Link | `EXCELLENT` |
| `dropped` | `6` | `radio.dropped` | Diagnostics / Comms | Drop counter matches |
| `mvs.state` | `"motion"` | `csi.state` & `motion.level` | Motion Detector & CSI Panel | State: `MOTION`, Level: `HIGH` |
| `mvs.confidence` | `83.1163605485` | `csi.confidence` | CSI Confidence | `83.1163605485%` |
| `ml.ready` | `true` | `csi.calibrated` & `arrayOnline` | CSI Array & Calibrated Status | `CSI ARRAY: ONLINE`, `CALIBRATED` |
| *Battery Voltage* | *(absent)* | `battery.voltage` | BATTERY Panel | `--` (No fabrication) |
| *Battery Percent* | *(absent)* | `battery.percent` | BATTERY Panel | `[----------] --` |
| *GPS Coordinates* | *(absent)* | `gps.latitude`, `gps.longitude` | GPS NAV Panel | `--`, `--` |
| *IMU Heading* | *(absent)* | `imu.heading` | HEADING / IMU Panel | `--` |
| *Odometry / RPM* | *(absent)* | `odometry.motors` | ODOMETRY Panel | `--` |
| *STM32 Status* | *(absent)* | `hardware.stm32` | HARDWARE STATUS Panel | `--` |

---

## 7. Automated Qualification Suite

Execute the comprehensive qualification suite to verify failure injection, malformed JSON drops, oversized payload rejection, single-client enforcement, and 300-packet streaming performance:

```bash
npm run integration:verify
```
