# Multi-ESP32 Teleoperated Unstructured terrain-traversal rover for SAR/CSSR — system datasheet

| | |
|---|---|
| **Document rev.** | 1.2 |
| **Boards covered** | ESP32 (TX, joystick transmitter) · ESP32 (RX, motor/sensor receiver) · ESP32-S3 (odometry sink) |
| **Link** | ESP-NOW, 2.4GHz, unencrypted, channel 0 |
| **Status** | All power sources confirmed. TX is USB-tethered as an interim setup — see Section 7 |

---

## 1. System overview

A hand-held ESP32 transmitter reads a two-axis analog joystick and a push-button, and broadcasts a 5-byte struct over ESP-NOW to a fixed receiver MAC address at 20Hz. The ESP32 receiver decodes the struct into arcade-mixed left/right motor commands, drives an L298N dual H-bridge, and separately reads two FC-03 wheel-speed encoders and an MPU9250 IMU. The receiver relays packed odometry (encoder ticks + accel/gyro/temp) over UART2 to a companion ESP32-S3, which is expected to run the higher-level CSI/dashboard workload described elsewhere in this project.

```
 TX (ESP32)                         RX (ESP32)                      S3 (ESP32-S3)
 ┌────────────┐   ESP-NOW 2.4GHz    ┌────────────┐   UART2 + 3.3V   ┌────────────┐
 │ Joystick   │ ──────────────────> │ L298N      │ ───────────────> │ Odometry   │
 │ + button   │   x, y, stop        │ FC-03 x2   │  ticks, IMU +    │ sink       │
 └────────────┘                     │ MPU9250    │  shared 3V3 rail │            │
                                    └────────────┘                  └────────────┘
```

---

## 2. Board summary

| Board | Role | MCU | Power source | Status |
|---|---|---|---|---|
| **TX** | Joystick transmitter | ESP32 | USB (5V), through onboard 3.3V LDO | Confirmed |
| **RX** | Motor + sensor receiver | ESP32 | 4×AA, 6V nominal, through onboard 3.3V LDO | Confirmed |
| **RX motor stage** | L298N dual H-bridge | — | 2S Li-ion, 7.4V nominal, 15A discharge-rated pack | Confirmed |
| **S3** | Odometry sink | ESP32-S3 | 3.3V, fed directly from RX's `3V3` pin | Confirmed |

---

## 3. Pinout — TX (joystick transmitter)

### 3.1 Signal pins

| # | ESP32 pin | ADC unit | Dir | Net | Signal | Range | Notes |
|---|---|---|---|---|---|---|---|
| TX-1 | `GPIO34` | ADC1_CH6 | ← | Joystick `VRx` | Analog, raw | 0–4095 (0–3.3V) | X axis / turn. ADC1 — safe to sample with WiFi radio active |
| TX-2 | `GPIO35` | ADC1_CH7 | ← | Joystick `VRy` | Analog, raw | 0–4095 (0–3.3V) | Y axis / throttle. ADC1 — same WiFi-safety note |
| TX-3 | `GPIO32` | — | ← | Joystick `SW` | Digital, active-low | 3.3V logic | `INPUT_PULLUP`; pressed = LOW = deadman/stop |

### 3.2 Power & ground

| # | ESP32 pin | Dir | Net | Signal | Voltage | Notes |
|---|---|---|---|---|---|---|
| TX-4 | `3V3` | → | Joystick `VCC` | Power | 3.3V | Not present in firmware — physical wiring only |
| TX-5 | `GND` | — | Joystick `GND` | Ground | — | |
| TX-6 | `5V` (or `VIN`) | ← | USB (host/power bank) | Power in | 5V nominal | Through onboard 3.3V LDO — tethered operation, no battery on TX for now |
| TX-7 | `GND` | — | USB | Ground | — | Ties into TX-5 |

---

## 4. Pinout — RX (motor + sensor receiver)

### 4.1 Signal pins

| # | ESP32 pin | Dir | Net | Peripheral pin | Signal | Voltage | Notes |
|---|---|---|---|---|---|---|---|
| RX-1 | `GPIO25` | → | L298N | `ENA` | PWM | 3.3V logic | Left motor speed |
| RX-2 | `GPIO26` | → | L298N | `IN1` | Direction | 3.3V logic | Left motor direction A |
| RX-3 | `GPIO27` | → | L298N | `IN2` | Direction | 3.3V logic | Left motor direction B |
| RX-4 | `GPIO14` | → | L298N | `IN3` | Direction | 3.3V logic | Right motor direction A |
| RX-5 | `GPIO4`  | → | L298N | `IN4` | Direction | 3.3V logic | Right motor direction B |
| RX-6 | `GPIO33` | → | L298N | `ENB` | PWM | 3.3V logic | Right motor speed |
| RX-7 | `GPIO34` | ← | Left FC-03 | `DO` | Pulse (RISING) | 3.3V logic | Input-only pin, interrupt-driven |
| RX-8 | `GPIO35` | ← | Right FC-03 | `DO` | Pulse (RISING) | 3.3V logic | Input-only pin, interrupt-driven |
| RX-9 | `GPIO21` | ↔ | MPU9250 | `SDA` | I2C data | 3.3V | 400kHz |
| RX-10 | `GPIO22` | → | MPU9250 | `SCL` | I2C clock | 3.3V | 400kHz |
| RX-11 | `GPIO17` | → | S3 | `RX` | UART2 TX | 3.3V logic | 115200 8N1 |
| RX-12 | `GPIO16` | ← | S3 | `TX` | UART2 RX | 3.3V logic | 115200 8N1 |
| — | — | — | Left FC-03 | `A0` | Analog (unused) | — | Not connected — firmware never reads it |
| — | — | — | Right FC-03 | `A0` | Analog (unused) | — | Not connected — firmware never reads it |

### 4.2 Power & ground

| # | ESP32 pin | Dir | Net | Peripheral pin | Signal | Voltage | Notes |
|---|---|---|---|---|---|---|---|
| RX-13 | `3V3` | → | MPU9250 | `VCC` | Power | 3.3V | MPU9250 is 3.3V-native — never wire to 5V |
| RX-14 | `3V3` | → | Left FC-03 | `VCC` | Power | 3.3V | 3.3V preferred over 5V — reduces comparator noise/bounce on `DO` |
| RX-15 | `3V3` | → | Right FC-03 | `VCC` | Power | 3.3V | Same as above |
| RX-16 | `GND` | — | MPU9250 | `GND` | Ground | — | |
| RX-17 | `GND` | — | Left FC-03 | `GND` | Ground | — | |
| RX-18 | `GND` | — | Right FC-03 | `GND` | Ground | — | |
| RX-19 | `GND` | — | L298N | `GND` | Ground | — | Common ground meeting point for AA pack, Li-ion pack, and ESP32 |
| RX-20 | `GND` | — | S3 | `GND` | Ground | — | Required for UART to work reliably |
| RX-25 | `3V3` | → | S3 | `3V3` / `VCC` | Power | 3.3V | S3 is powered directly off RX's 3.3V rail — not a separate supply |
| RX-21 | `VIN` (or `5V`) | ← | 4×AA pack | `+` | Power in | 6V nominal (4×1.5V) | Through ESP32's onboard 3.3V LDO — confirm board's max input rating |
| RX-22 | `GND` | — | 4×AA pack | `–` | Ground | — | Ties into common ground |
| RX-23 | — | ← | L298N `+12V` terminal | 2S Li-ion `+` | Power in | 7.4V nominal, 15A discharge cap | Does not route through ESP32 |
| RX-24 | — | — | L298N `GND` | 2S Li-ion `–` | Ground | — | Same common ground as RX-19 |

---

## 5. Recommended operating conditions

| Parameter | Min | Typ | Max | Unit | Notes |
|---|---|---|---|---|---|
| Logic supply (all boards) | 3.0 | 3.3 | 3.6 | V | ESP32/ESP32-S3 native rail |
| TX system input (USB) | 4.75 | 5.0 | 5.25 | V | Interim tethered supply — see Section 7 |
| RX system input (`VIN`) | — | 6.0 | ~12 | V | 4×AA nominal; upper bound is a typical ESP32 board LDO ceiling, confirm per-board |
| Motor supply (2S Li-ion) | 6.0 | 7.4 | 8.4 | V | 6.0V = fully discharged cutoff, 8.4V = fully charged |
| Motor pack discharge current | — | — | 15 | A | Pack rating; L298N itself is typically limited to ~2A/channel continuous — check driver's own rating against motor stall current |
| FC-03 `VCC` | 3.3 | 3.3 | 5.0 | V | 3.3V recommended on this design to avoid comparator bounce on `DO` |
| I2C bus speed (MPU9250) | — | 400 | — | kHz | |
| UART2 (RX ↔ S3) | — | 115200 | — | baud | 8N1 |
| ESP-NOW report rate (TX) | — | 20 | — | Hz | 50ms loop delay |

## 6. Absolute maximum ratings

| Parameter | Rating | Consequence if exceeded |
|---|---|---|
| Voltage on any 3.3V-logic GPIO | 3.6V | Pin damage / latch-up risk |
| MPU9250 `VCC` | 3.3V (do not exceed) | Sensor damage — part is not 5V-tolerant |
| L298N logic-side input from ESP32 | 3.3V logic, referenced to common GND | Ensure `5V-EN` jumper (if present) is **off** to avoid backfeeding the logic rail |
| ADC2 pins under active WiFi | N/A | Do not use for analog input — readings are invalid/blocked while WiFi is active. TX correctly avoids this by using ADC1 (`GPIO34`/`35`) |

## 7. Notes / errata

- **FC-03 `A0`** is present on the module but unconnected in this design — firmware only reads the comparator's `DO` pulse via `attachInterrupt()`.
- **FC-03 noise sensitivity**: this sensor is known to be sensitive to interference on `VCC`/`GND`; powering it from a regulator shared with switching loads has been reported to cause bounced/over-counted pulses. 3.3V from the ESP32 is used here specifically to mitigate this.
- **Encoder input pins** `GPIO34`/`GPIO35` are input-only on the ESP32 — acceptable here since they're read-only interrupt sources, but they cannot be repurposed as outputs elsewhere in the design.
- **No pull-up configured** on `pinMode(ENCODER_L, INPUT)` — confirm the FC-03's `DO` stage is push-pull (actively driven both directions); if it's open-collector, the line may float and cause spurious `RISING` interrupts.
- **TX runs off USB for now** — fine on the bench, but a wired/tethered controller is a real constraint for a CSSR field unit (limits range and requires a nearby power bank or laptop). Worth planning a battery option (LiPo + charge module, or the same 4×AA approach as RX) before field trials — flag this in Section 2/3.2 as "interim" rather than final.
- **RX's 3.3V rail now carries five loads**: MPU9250, two FC-03 encoders, and the entire ESP32-S3 board (RX-25), all off the same onboard LDO that also powers RX's own MCU/radio. A bare ESP32 dev board's LDO is often only rated for a few hundred mA; the ESP32-S3 alone can pull 300–500mA in short WiFi TX bursts. Worth measuring actual combined current draw on the bench — if the rail sags during a WiFi burst, it can brown out the MPU9250/encoders or reset the S3 mid-transfer. A dedicated 3.3V regulator for the S3 (fed from the 4×AA pack directly, sharing only GND) would remove this risk if you see instability.
- **ESP-NOW is unencrypted** (`peerInfo.encrypt = false`) and broadcasts to a fixed MAC with `channel = 0` (auto/current channel) — anyone on the same channel with the receiver's MAC address could potentially spoof control packets. Not a concern for a hobby rover, but worth knowing if this ever leaves a trusted network environment.

---

*End of document rev. 1.0. Codenamed:Rocky*
