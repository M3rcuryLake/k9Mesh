# K9Mesh Search & Rescue Rover Platform
## Master Interface Control Document (ICD)

**Document Identifier:** K9M-SYS-ICD-001  
**Version:** 1.0.0  
**Status:** Approved Engineering Baseline  
**Classification:** Technical Specification / Systems Architecture  
**Target Systems:** K9Mesh Operator Console (Host GCS), Micro-ESPectre CSI Sensing Node, STM32 Real-Time Rover Controller  

---

## Document Control & Revision History

| Version | Release Date | Primary Author / Contributor | Description of Change |
| :--- | :--- | :--- | :--- |
| **1.0.0** | 2026-08-06 | K9Mesh Systems Engineering Team | Initial baseline release merging Micro-ESPectre CSI Telemetry Audit and STM32 Rover Controller Subsystem Specification. |

---

## Table of Contents
1. [System Overview & Architecture](#section-1--system-overview--architecture)
2. [Data Ownership & Transport Matrix](#section-2--data-ownership--transport-matrix)
3. [Master Telemetry Schema](#section-3--master-telemetry-schema)
4. [Telemetry Classification & Operator Value](#section-4--telemetry-classification--operator-value)
5. [Command & Control Interface Protocol](#section-5--command--control-interface-protocol)
6. [Transport Layers & Framing Protocols](#section-6--transport-layers--framing-protocols)
7. [Message Schemas & Packet Definitions](#section-7--message-schemas--packet-definitions)
8. [Update Frequencies & Timing Deadlines](#section-8--update-frequencies--timing-deadlines)
9. [Fault Management & Failure Contingency](#section-9--fault-management--failure-contingency)
10. [Versioning & Compatibility Governance](#section-10--versioning--compatibility-governance)
11. [Future Payload & Expansion Reservations](#section-11--future-payload--expansion-reservations)

---

## Section 1 — System Overview & Architecture

The K9Mesh platform is an open-source, cyber-physical search-and-rescue robotic system engineered for Collapsed Structure Search and Rescue (CSSR). It combines through-rubble RF life-sign detection (using commodity Wi-Fi Channel State Information) with differential-drive robotic mobility and dead-reckoning navigation.

### 1.1 Architectural Topology

The system comprises three physical processing layers and two primary inter-subsystem data highways:

```
+-------------------------------------------------------------------------------+
|                           OPERATOR LAYER (HOST GCS)                           |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  |                     React Operator Console (UI)                         |  |
|  +-------------------------------------------------------------------------+  |
|                                     |  IPC Bridge (window.k9mesh)             |
|  +-------------------------------------------------------------------------+  |
|  |                   Electron Main Process / Gateway                       |  |
|  |           (MQTT Client, Serial Transport, Telemetry Multiplexer)        |  |
|  +-------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
                                      |
                         Network / Physical Boundary
                                      |
         +----------------------------+----------------------------+
         | (Production Mode)                                       | (Development Mode)
         | IEEE 802.11 b/g/n Wi-Fi                                 | Direct USB-CDC / UART
         | MQTT Topic: k9mesh/rover/#                              | 115200 Baud Stream
         v                                                         v
+------------------------------------+           +------------------------------+
|     RF SENSING & COMMS NODE        |           |  ROVER COMPUTATION HUB       |
|    (Espressif ESP32-C6 / S3)       |           |     (STM32F103C8T6 72MHz)    |
|                                    |           |                              |
|  - CSI Acquisition (802.11 HT20)   |           |  - Closed-Loop PID Control   |
|  - Spatial Turbulence Engine       |           |  - 9-DOF AHRS Sensor Fusion  |
|  - MVS / ML Detection Pipeline     |           |  - Optical Wheel Odometry    |
|  - MQTT Telemetry Gateway          |           |  - NRF24 Override Decoupler  |
+------------------------------------+           +------------------------------+
                  |                                             ^
                  |  Inter-Board UART Bridge (USART1 / UART2)   |
                  |  115200 Baud, Packed Binary C-Struct Frames |
                  +---------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
|                       ACTUATORS, SENSORS & TRANSDUCERS                        |
|                                                                               |
|  - Actuation: L298N Dual H-Bridge -> 4x Brushed DC Motors (4WD)               |
|  - Inertial: MPU9250 (3-Axis Gyro, 3-Axis Accel, 3-Axis AK8963 Magnetometer)  |
|  - Odometry: 2x FC-03 Photoelectric Slotted Infrared Encoders                 |
|  - RF Link: NRF24L01+ 2.4GHz Direct Manual Override Remote                    |
|  - Power: 6.0V Primary Battery Pack -> Voltage Sense Line                     |
+-------------------------------------------------------------------------------+
```

### 1.2 Subsystem Responsibilities

1. **Operator Console (React / Presentation Layer):**  
   Strict, deterministic visual rendering of the complete telemetry state. Passive presentation; zero runtime simulation or synthetic data generation.
2. **Host Desktop Runtime (Electron Main Process):**  
   Acts as the central telemetry broker interface. Manages network sockets (MQTT, TCP), local serial ports (USB-CDC), context-isolated IPC dispatching, and command transmission.
3. **RF Life-Sign Sensing Node (ESP32-C6 / Micro-ESPectre):**  
   Captures raw 802.11 HT20 CSI frames ($100\text{ Hz}$), executes hardware AGC gain locking, computes spatial variance/turbulence, extracts statistical feature vectors, executes neural network motion inference, and serializes outbound Wi-Fi MQTT telemetry.
4. **Rover Mobility & Navigation Hub (STM32F103C8T6):**  
   Executes deterministic real-time control loops ($1\text{ kHz}$ SysTick): reads high-rate IMU ($50\text{ Hz}$), accumulates optical wheel ticks via hardware interrupts (`EXTI0`/`EXTI1`), computes linear velocity and cumulative distance, runs motor PID controllers, parses manual NRF24L01 override frames, and streams packed binary status to the ESP32.
5. **Actuators & Sensors:**  
   Provide physical mobility and capture raw environmental/motion state parameters.

---

## Section 2 — Data Ownership & Transport Matrix

This matrix establishes the definitive producer, intermediate transport pipeline, and ultimate consumer for every telemetry variable in the K9Mesh platform.

| Telemetry Variable | Primary Producer | Ingestion Mechanism | Transport Route | Ultimate Consumer | Persistence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `mcu_status` | STM32 Baseboard | Internal Watchdog / FSM | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `core_temp_stm32` | STM32 Baseboard | Internal ADC Channel 16 | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `chip_type_esp32` | ESP32 CSI Node | `os.uname().machine` | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | No |
| `free_heap_kb_esp32`| ESP32 CSI Node | `gc.mem_free()` | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `uptime_esp32` | ESP32 CSI Node | `time.ticks_ms()` | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `uptime_stm32` | STM32 Baseboard | SysTick Counter | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Diagnostics Page | Yes (Log) |
| `radio_link_quality`| NRF24L01 Receiver | Packet Success Rate | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `radio_signal_pct` | NRF24L01 Receiver | Dynamic Loss Model | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `radio_latency_ms` | NRF24L01 Receiver | Auto-ACK Round Trip | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `radio_override` | STM32 Baseboard | SPI1 Frame Ingestion | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Event) |
| `wifi_ip` | ESP32 CSI Node | `wlan.ifconfig()` | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | No |
| `wifi_rssi` | ESP32 CSI Node | `wlan.status('rssi')` | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `csi_pps` | ESP32 CSI Node | CSI Frame Counter | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `dropped_packets` | ESP32 CSI Node | Hardware Ring Buffer | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `traffic_gen_pps` | ESP32 CSI Node | Background Thread | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `battery_percent` | Battery Sense / ADC | Scaled Curve Lookup | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `battery_voltage` | Battery Sense / ADC | Internal ADC Sampling | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `battery_est_time` | Host / Electron | Linear Discharge Model | Host Electron Engine $\rightarrow$ IPC | Operator Console | No |
| `battery_discharge` | STM32 / Host | $dV/dt$ Derivation | Host Electron Engine $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `heading` | MPU9250 IMU | I2C1 + AHRS Fusion | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `pitch` | MPU9250 IMU | I2C1 + AHRS Fusion | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `roll` | MPU9250 IMU | I2C1 + AHRS Fusion | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `speed` | FC-03 Encoders | Hardware EXTI0/EXTI1 | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `distance` | FC-03 Encoders | Accumulated Ticks | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `rpm_fl` / `rpm_rl` | FC-03 Encoders | Left Wheel EXTI Delta | STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `rpm_fr` / `rpm_rr` | FC-03 Encoders | Right Wheel EXTI Delta| STM32 $\rightarrow$ UART $\rightarrow$ ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `csi_state` | Micro-ESPectre ML/MVS| Runtime Motion Policy| ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `csi_movement` | Micro-ESPectre ML/MVS| Variance / Score | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `csi_threshold` | Micro-ESPectre | Adaptive Calculator | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `csi_confidence` | Micro-ESPectre ML | Sigmoid Activation | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `csi_array_status` | ESP32 CSI Node | Frame Ingestion Watchdog| ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | No |
| `csi_calibrated` | ESP32 CSI Node | NBVI Execution State | ESP32 $\rightarrow$ MQTT $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | No |
| `breathing_detected`| Respiration DSP Node| Spectral Peak Detector| ESP32 / Host DSP $\rightarrow$ IPC | Operator Console | Yes (Event) |
| `breathing_rate` | Respiration DSP Node| FFT Dominant Peak | ESP32 / Host DSP $\rightarrow$ IPC | Operator Console | Yes (Log) |
| `gps_lat` / `gps_lon`| GNSS Receiver (Ext) | NMEA Parsing (RMC/GGA)| Direct Host USB / GNSS $\rightarrow$ Electron $\rightarrow$ IPC | Operator Console | Yes (Log) |

---

## Section 3 — Master Telemetry Schema

The table below merges all telemetry attributes into a single unified contract.

| Field Name | JSON Field Key | Data Type | Units | Valid Range | Update Rate | Producer | Primary Consumer | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **System Status (STM32)** | `hardware.stm32` | `string` | Enum | `"OK"`, `"FAULT"`, `"OFFLINE"` | $10\text{ Hz}$ | STM32 | UI System Vitals | High |
| **System Status (ESP32)** | `hardware.esp32` | `string` | Enum | `"OK"`, `"FAULT"`, `"OFFLINE"` | $1\text{ Hz}$ | ESP32 | UI System Vitals | High |
| **MQTT Broker Status** | `hardware.mqtt` | `string` | Enum | `"OK"`, `"FAULT"`, `"OFFLINE"` | $1\text{ Hz}$ | Electron Host | UI System Vitals | High |
| **Wi-Fi Link Status** | `hardware.wifi` | `string` | Enum | `"OK"`, `"FAULT"`, `"OFFLINE"` | $1\text{ Hz}$ | ESP32 | UI System Vitals | High |
| **STM32 Core Temp** | `hardware.coreTemp` | `float` | $^\circ\text{C}$ | $-40.0 - +85.0$ | $1\text{ Hz}$ | STM32 | UI System Vitals | Medium |
| **Radio Link Quality** | `radio.linkQuality` | `string` | Enum | `"EXCELLENT"`, `"GOOD"`, `"FAIR"`, `"POOR"` | $5\text{ Hz}$ | STM32 (NRF) | UI System Vitals | High |
| **Radio Latency** | `radio.latency` | `integer` | $\text{ms}$ | $0 - 1000$ | $5\text{ Hz}$ | STM32 (NRF) | UI System Vitals | Medium |
| **Radio Signal Percent** | `radio.signalPercent` | `integer` | $\%$ | $0 - 100$ | $5\text{ Hz}$ | STM32 (NRF) | UI System Vitals | Medium |
| **Battery Percentage** | `battery.percent` | `integer` | $\%$ | $0 - 100$ | $1\text{ Hz}$ | STM32 ADC | UI System Vitals | High |
| **Battery Voltage** | `battery.voltage` | `float` | $\text{V}$ | $0.00 - 8.40$ | $1\text{ Hz}$ | STM32 ADC | UI System Vitals | High |
| **Battery Est Runtime** | `battery.estTime` | `string` | Time | Format: `"HH:MM:SS"` | $0.1\text{ Hz}$ | Host Electron | UI System Vitals | Low |
| **Battery Discharge Rate**| `battery.discharge` | `string` | Enum | `"NORMAL"`, `"HIGH"`, `"CRITICAL"` | $1\text{ Hz}$ | Host Electron | UI System Vitals | Medium |
| **Heading Angle** | `imu.heading` | `float` | Degrees ($^\circ$)| $0.00 - 359.99$ | $20\text{ Hz}$ | STM32 (IMU) | UI Heading / IMU | High |
| **Pitch Angle** | `imu.pitch` | `float` | Degrees ($^\circ$)| $-90.00 - +90.00$ | $20\text{ Hz}$ | STM32 (IMU) | UI Heading / IMU | High |
| **Roll Angle** | `imu.roll` | `float` | Degrees ($^\circ$)| $-180.00 - +180.00$ | $20\text{ Hz}$ | STM32 (IMU) | UI Heading / IMU | High |
| **Linear Travel Speed** | `odometry.speed` | `float` | $\text{m/s}$ | $0.00 - 5.00$ | $10\text{ Hz}$ | STM32 Encoders| UI Odometry | Medium |
| **Traversed Distance** | `odometry.distance` | `float` | $\text{m}$ | $0.00 - 9999.99$ | $10\text{ Hz}$ | STM32 Encoders| UI Odometry | Medium |
| **Motor RPM (FL)** | `odometry.motors.FL`| `integer` | $\text{RPM}$ | $0 - 1000$ | $10\text{ Hz}$ | STM32 Encoders| UI Odometry | Medium |
| **Motor RPM (FR)** | `odometry.motors.FR`| `integer` | $\text{RPM}$ | $0 - 1000$ | $10\text{ Hz}$ | STM32 Encoders| UI Odometry | Medium |
| **Motor RPM (RL)** | `odometry.motors.RL`| `integer` | $\text{RPM}$ | $0 - 1000$ | $10\text{ Hz}$ | STM32 Encoders| UI Odometry | Medium |
| **Motor RPM (RR)** | `odometry.motors.RR`| `integer` | $\text{RPM}$ | $0 - 1000$ | $10\text{ Hz}$ | STM32 Encoders| UI Odometry | Medium |
| **GPS Latitude** | `gps.latitude` | `float` | Degrees ($^\circ$)| $-90.000000 - +90.000000$ | $1\text{ Hz}$ | External GNSS | UI GPS NAV | Medium |
| **GPS Longitude** | `gps.longitude` | `float` | Degrees ($^\circ$)| $-180.000000 - +180.000000$| $1\text{ Hz}$ | External GNSS | UI GPS NAV | Medium |
| **CSI Array Status** | `csi.arrayOnline` | `boolean` | Flag | `true`, `false` | $1\text{ Hz}$ | ESP32 CSI Node| UI CSI Survivor | High |
| **CSI Calibration State**| `csi.calibrated` | `boolean` | Flag | `true`, `false` | $1\text{ Hz}$ | ESP32 CSI Node| UI CSI Survivor | High |
| **CSI Breathing Flag** | `csi.breathingDetected`| `boolean`| Flag | `true`, `false` | $1\text{ Hz}$ | Respiration DSP| UI CSI Survivor | High |
| **CSI Breathing Rate** | `csi.breathingRate` | `float` | $\text{BPM}$ | $0.0 - 60.0$ | $0.5\text{ Hz}$ | Respiration DSP| UI CSI Survivor | High |
| **CSI Confidence Score** | `csi.confidence` | `string` | Percent | Format: `"91.0000000000"` | $1\text{ Hz}$ | ESP32 ML Node | UI CSI Survivor | High |
| **CSI Detection State** | `csi.state` | `string` | Enum | `"STABLE"`, `"MOTION"`, `"IDLE"` | $1\text{ Hz}$ | ESP32 Policy | UI CSI Survivor | High |
| **Motion Activity Level**| `motion.level` | `string` | Enum | `"LOW"`, `"MEDIUM"`, `"HIGH"` | $1\text{ Hz}$ | Micro-ESPectre| UI Motion Detector| Medium |
| **Last Motion Event Age**| `motion.lastEventSeconds`|`integer`| Seconds | $0 - 86400$ | $1\text{ Hz}$ | Micro-ESPectre| UI Motion Detector| Medium |

---

## Section 4 — Telemetry Classification & Operator Value

Telemetry streams are segregated into four operational tiers to govern network bandwidth allocation, logging fidelity, and UI prominence.

```
+-----------------------------------------------------------------------------------+
|                        TELEMETRY CLASSIFICATION HIERARCHY                         |
+-----------------------------------------------------------------------------------+
|  TIER 1: MISSION CRITICAL                                                         |
|  - Survivor Breathing Detected, Rate (BPM), Confidence Score                      |
|  - Rover Attitude Rollover Alarms (Pitch > 45 deg, Roll > 45 deg)                 |
|  - Manual Radio Control Link Status & Emergency Stop State                        |
|  - Critical Battery Depletion (< 10%) & MCU Fault Flags                           |
+-----------------------------------------------------------------------------------+
|  TIER 2: OPERATIONAL TELEMETRY                                                    |
|  - Compass Heading, Optical Speed, Traversed Distance                             |
|  - Battery Voltage & Remaining Runtime                                            |
|  - Wi-Fi Link Quality, CSI Packet Ingestion Rate (PPS), Packet Loss               |
+-----------------------------------------------------------------------------------+
|  TIER 3: ENGINEERING DIAGNOSTICS                                                  |
|  - Individual Motor RPMs (FL/FR/RL/RR), PWM Command Effort                        |
|  - Raw IMU Angular Rates (Gyro Z) and Tri-Axial Accelerations                     |
|  - Active Subcarrier Allocation Mask (12 Selected Bins), Baseline Noise Floor     |
+-----------------------------------------------------------------------------------+
|  TIER 4: DEVELOPER DEBUG                                                          |
|  - MicroPython Heap Free Bytes, Main Event Loop Execution Jitter                  |
|  - Neural Network 9-Feature Statistical Input Vectors                             |
|  - Raw 128-Byte HT20 CSI I/Q Channel Response Arrays (UDP 5001 Stream)            |
+-----------------------------------------------------------------------------------+
```

### Technical Justification

1. **Mission Critical (Tier 1):**  
   Directly impacts human life detection and rover physical preservation. These packets have the highest transmission priority and are logged with sub-millisecond timestamps.
2. **Operational (Tier 2):**  
   Required for real-time situational awareness and manual/autonomous piloting. Rendered prominently on primary console instruments.
3. **Engineering Diagnostics (Tier 3):**  
   Used to detect mechanical slippage, terrain degradation, or localized RF interference. Routed to auxiliary engineering sub-panels.
4. **Developer Debug (Tier 4):**  
   High-bandwidth introspection data. Suppressed in field deployment unless explicitly polled or routed over dedicated development debug links.

---

## Section 5 — Command & Control Interface Protocol

The K9Mesh command subsystem operates on a deterministic Request-Acknowledgement model over MQTT or Direct Serial.

### 5.1 Command Dictionary

| Command Name | Opcode / String | Parameters / Payload Schema | ACK Required | Timeout | Retry Count | Fallback Behavior on Failure |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **EMERGENCY_STOP** | `CMD_ESTOP` | `{"reason": string}` | Yes (Immediate)| $50\text{ ms}$ | 3 | Hardware cuts motor PWM to 0 via STM32 fail-safe. |
| **STOP** | `CMD_STOP` | `{"brake_mode": "COAST"\|"HOLD"}` | Yes | $100\text{ ms}$| 2 | Coast to halt. |
| **MOVE_FORWARD** | `CMD_DRIVE_FWD`| `{"speed_mps": float, "duration_ms": uint32}` | Yes | $200\text{ ms}$| 1 | Stop after duration expires (Deadman timer). |
| **MOVE_BACKWARD** | `CMD_DRIVE_REV`| `{"speed_mps": float, "duration_ms": uint32}` | Yes | $200\text{ ms}$| 1 | Stop after duration expires (Deadman timer). |
| **TURN_LEFT** | `CMD_TURN_LEFT`| `{"yaw_rate_dps": float, "angle_deg": float}` | Yes | $200\text{ ms}$| 1 | Cease turning upon target angle or timeout. |
| **TURN_RIGHT** | `CMD_TURN_RIGHT`| `{"yaw_rate_dps": float, "angle_deg": float}`| Yes | $200\text{ ms}$| 1 | Cease turning upon target angle or timeout. |
| **SET_SPEED** | `CMD_SET_SPEED`| `{"left_pwm": uint8, "right_pwm": uint8}` | Yes | $100\text{ ms}$| 2 | Maintain previous speed. |
| **CALIBRATE_IMU** | `CMD_CAL_IMU` | `{"mode": "GYRO_ZERO"\|"MAG_FULL"}` | Yes | $5000\text{ ms}$| 0 | Abort calibration; retain previous bias vectors. |
| **RESET_ODOMETRY**| `CMD_RESET_ODOM`| `{"reset_distance": bool, "reset_pose": bool}`| Yes | $200\text{ ms}$| 2 | Retain current accumulated odometer readings. |
| **CALIBRATE_CSI** | `CMD_CAL_CSI` | `{"duration_packets": uint16}` | Yes | $10000\text{ ms}$| 0 | Retain default subcarrier band and threshold. |
| **SET_CSI_THRESH** | `CMD_SET_CSI_TH`| `{"threshold": float}` | Yes | $500\text{ ms}$| 2 | Retain previous threshold. |
| **HEARTBEAT** | `CMD_HEARTBEAT`| `{"timestamp_ms": uint32}` | Yes | $1000\text{ ms}$| 0 | Trigger Link Lost Watchdog if 3 consecutive missed. |
| **PING** | `CMD_PING` | `{"seq": uint32}` | Yes (Pong) | $500\text{ ms}$| 0 | Log round-trip latency. |
| **SYSTEM_REBOOT** | `CMD_REBOOT` | `{"target": "STM32"\|"ESP32"\|"ALL"}` | Yes | $2000\text{ ms}$| 0 | Controlled system re-initialization. |

---

## Section 6 — Transport Layers & Framing Protocols

The architecture defines two operational transports: **Production Mode** (Wireless Mesh) and **Development Mode** (Direct Hardware Tether).

```
===================================================================================
PRODUCTION TRANSPORT PIPELINE (WIRELESS SEARCH OPERATION)
===================================================================================
+-------------+ USART1 (Packed Binary) +-------------+ IEEE 802.11 +----------------+
| STM32 Rover | ---------------------> | ESP32 Wi-Fi | ----------> | Mosquitto MQTT |
| Controller  | 115200 Baud (39 Bytes) | CSI Gateway |  WPA2 / AP  | Host Broker    |
+-------------+                        +-------------+             +----------------+
                                                                            |
                                                                            v
+------------------+     Context Isolation IPC      +--------------------------------+
|  React Operator  | <============================ | Electron Desktop Application   |
|  Console UI      |   window.k9mesh.onTelemetry   | (MQTT Client Subscription)     |
+------------------+                                +--------------------------------+

===================================================================================
DEVELOPMENT TRANSPORT PIPELINE (BENCH HARDWARE DEBUGGING)
===================================================================================
+-------------+ USB-CDC / FTDI Serial Stream (JSON or Binary Frames) +----------------+
| STM32 Rover | ===================================================> | Electron Host  |
| Controller  | 115200 Baud via Micro-USB Connector                  | SerialPort API |
+-------------+                                                      +----------------+
                                                                            |
                                                                            v
+------------------+     Context Isolation IPC      +--------------------------------+
|  React Operator  | <============================ | Electron Bridge Dispath        |
|  Console UI      |   window.k9mesh.onTelemetry   | (Zero MQTT Broker Dependency)  |
+------------------+                                +--------------------------------+
```

### 6.1 Inter-Board Binary Frame Protocol (STM32 $\leftrightarrow$ ESP32)

Communication between the STM32 and ESP32 over USART1 uses a fixed-length packed binary structure protected by a 16-bit CRC:

```c
// Target Architecture: Little-Endian 32-bit ARM / Xtensa
// Packing: 1-byte aligned (__attribute__((packed)))

typedef struct __attribute__((packed)) {
    uint16_t sync_word;           // 0x524B (ASCII "KR" for K9-Rover)
    uint8_t  frame_seq;           // Rolling packet counter (0 - 255)
    uint8_t  mcu_status;          // 0=OFFLINE, 1=OK, 2=FAULT
    float    heading_deg;         // IEEE 754 float (0.0 to 359.99)
    float    pitch_deg;           // IEEE 754 float (-90.0 to +90.0)
    float    roll_deg;            // IEEE 754 float (-180.0 to +180.0)
    float    speed_mps;           // IEEE 754 float (0.00 to 5.00)
    float    distance_m;          // IEEE 754 float (0.00 to 9999.99)
    int16_t  rpm_left;            // Signed RPM (-1000 to +1000)
    int16_t  rpm_right;           // Signed RPM (-1000 to +1000)
    uint8_t  radio_link_quality;  // 0=POOR, 1=FAIR, 2=GOOD, 3=EXCELLENT
    uint8_t  radio_signal_pct;    // Percentage (0 - 100)
    uint16_t radio_latency_ms;    // Round trip latency (ms)
    uint16_t battery_mv;          // Battery rail millivolts (e.g. 6000 mV)
    uint8_t  battery_pct;         // Battery state of charge (0 - 100)
    int16_t  core_temp_c_x10;     // Temperature * 10 (e.g. 325 = 32.5 C)
    uint16_t crc16_ccitt;         // CRC-16-CCITT (Poly: 0x1021, Init: 0xFFFF)
} K9Mesh_RoverTelemetryFrame_t;   // Total Length: Exactly 39 Bytes
```

---

## Section 7 — Message Schemas & Packet Definitions

All external network communication between the Rover and the Host Ground Control Station uses standardized JSON envelopes.

### 7.1 Unified Telemetry Message Schema
**MQTT Topic:** `k9mesh/rover/telemetry`

```json
{
  "protocol_version": "1.0",
  "msg_type": "TELEMETRY",
  "timestamp_epoch_ms": 1785994074821,
  "node_id": "k9-alpha-01",
  "data": {
    "radio": {
      "linkQuality": "EXCELLENT",
      "rssi": -42,
      "latency": 12,
      "signalPercent": 94
    },
    "hardware": {
      "stm32": "OK",
      "esp32": "OK",
      "mqtt": "OK",
      "wifi": "OK",
      "coreTemp": 32.5
    },
    "battery": {
      "percent": 84,
      "voltage": 6.12,
      "estTime": "01:34:18",
      "discharge": "NORMAL"
    },
    "csi": {
      "arrayOnline": true,
      "calibrated": true,
      "breathingDetected": true,
      "breathingRate": 14.7,
      "confidence": "91.0000000000",
      "state": "STABLE"
    },
    "motion": {
      "level": "LOW",
      "lastEventSeconds": 14
    },
    "gps": {
      "latitude": null,
      "longitude": null
    },
    "imu": {
      "heading": 45.2,
      "pitch": -2.1,
      "roll": 0.8
    },
    "odometry": {
      "speed": 0.42,
      "distance": 18.5,
      "motors": {
        "FL": 120,
        "FR": 120,
        "RL": 120,
        "RR": 120
      }
    }
  }
}
```

### 7.2 Command Message Schema
**MQTT Topic:** `k9mesh/rover/command`

```json
{
  "protocol_version": "1.0",
  "msg_type": "COMMAND",
  "msg_id": "cmd_098234",
  "timestamp_epoch_ms": 1785994075100,
  "command": "CMD_DRIVE_FWD",
  "parameters": {
    "speed_mps": 0.50,
    "duration_ms": 2000
  }
}
```

### 7.3 Acknowledgement Message Schema
**MQTT Topic:** `k9mesh/rover/ack`

```json
{
  "protocol_version": "1.0",
  "msg_type": "ACK",
  "msg_id": "ack_098234",
  "ref_cmd_id": "cmd_098234",
  "timestamp_epoch_ms": 1785994075145,
  "status": "SUCCESS",
  "error_code": 0,
  "message": "Motor drive executed"
}
```

### 7.4 Error / Fault Message Schema
**MQTT Topic:** `k9mesh/rover/errors`

```json
{
  "protocol_version": "1.0",
  "msg_type": "ERROR",
  "msg_id": "err_002914",
  "timestamp_epoch_ms": 1785994076012,
  "subsystem": "ACTUATION",
  "severity": "CRITICAL",
  "error_code": 401,
  "message": "Left motor encoder stall detected under forward PWM drive"
}
```

---

## Section 8 — Update Frequencies & Timing Deadlines

| Telemetry Subsystem | Hardware Publishing Frequency | Target UI Render Frequency | Data Stale Threshold ($T_{\text{stale}}$) | Connection Timeout ($T_{\text{offline}}$) | Fail-Safe UI Visual Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **IMU / Heading** | $20\text{ Hz}$ ($50\text{ ms}$) | $20\text{ Hz}$ ($50\text{ ms}$) | $200\text{ ms}$ | $1000\text{ ms}$ | Render `HEADING: ---°`, Star `*` centers |
| **Wheel Odometry** | $10\text{ Hz}$ ($100\text{ ms}$) | $10\text{ Hz}$ ($100\text{ ms}$) | $500\text{ ms}$ | $2000\text{ ms}$ | Render `SPEED: -- M/S`, `DIST: -- M` |
| **Manual Radio Link** | $5\text{ Hz}$ ($200\text{ ms}$) | $5\text{ Hz}$ ($200\text{ ms}$) | $1000\text{ ms}$ | $3000\text{ ms}$ | Render `LINK: OFFLINE`, `SIGNAL: [----------]` |
| **CSI Detection / Score**| $1\text{ Hz}$ ($1000\text{ ms}$) | $1\text{ Hz}$ ($1000\text{ ms}$) | $3000\text{ ms}$ | $5000\text{ ms}$ | Render `CSI ARRAY: OFFLINE` |
| **Battery / Power Rails**| $1\text{ Hz}$ ($1000\text{ ms}$) | $1\text{ Hz}$ ($1000\text{ ms}$) | $5000\text{ ms}$ | $10000\text{ ms}$| Render `VOLTAGE: --V`, Bar `[----------]` |
| **Hardware Core Status** | $1\text{ Hz}$ ($1000\text{ ms}$) | $1\text{ Hz}$ ($1000\text{ ms}$) | $3000\text{ ms}$ | $5000\text{ ms}$ | Render `STM32_MCU: OFFLINE` |
| **System Heartbeat** | $1\text{ Hz}$ ($1000\text{ ms}$) | $1\text{ Hz}$ ($1000\text{ ms}$) | $2000\text{ ms}$ | $3000\text{ ms}$ | Trigger global comms loss visual banner |

---

## Section 9 — Fault Management & Failure Contingency

| Failure Condition | Detection Mechanism | UI Console Representation | Rover Autonomous Action | Recovery Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Lost MQTT Link** | 3 missed heartbeat intervals ($>3000\text{ ms}$) | `MQTT_BROKER: OFFLINE`, Dim green status indicator | Halt active autonomous drive missions; enter standby | Automatic reconnect loop with exponential backoff ($1-10\text{ s}$) |
| **Lost Serial Link (STM32 $\leftrightarrow$ ESP32)** | UART framing error or timeout ($>500\text{ ms}$) | `STM32_MCU: OFFLINE`, Odometry/IMU reads `NA` | ESP32 sets Rover health bit to FAULT; retains Wi-Fi CSI | Hardware re-open UART port; transmit sync pulse |
| **Lost NRF24 Override Link** | NRF24 auto-acknowledge packet failure | `LINK: OFFLINE`, `SIGNAL: [----------]` | Disengage manual mode; transfer control to autonomous safe-stop | Controller re-establishes channel hopping sweep |
| **Low Battery (< 15%)** | ADC sample voltage $< 4.8\text{ V}$ | Flashing `BATTERY` banner, `DISCHARGE: CRITICAL` | Limit motor max PWM to 50%; disable non-critical payloads | Alert operator to return rover to deployment base |
| **Critical Rollover (Pitch/Roll > 45°)** | AHRS quaternion threshold exceeded | `PITCH` or `ROLL` highlighted with flashing indicator | Emergency stop; cut all H-Bridge motor outputs | Require manual operator intervention / reverse command |
| **Wheel Motor Stall** | PWM command active but encoder $\Delta \text{ticks} = 0$ for $1.5\text{ s}$ | `FL/FR/RL/RR` readouts flag `0 RPM` under drive | Reduce PWM to prevent H-Bridge thermal shutdown | Reverse vehicle drive for $500\text{ ms}$ to clear rubble |
| **CSI RF Hardware Stall** | ESP32 `wlan.csi_read()` returns `NULL` for $2\text{ s}$ | `CSI ARRAY: OFFLINE`, `CALIBRATED: UNSET` | Suppress false motion triggers; log RF stall event | Re-initialize ESP32 CSI ring buffer and Wi-Fi PHY |
| **Packet Corruption (CRC Fail)**| CRC-16-CCITT mismatch on binary or JSON frame | Increment internal error counter; discard frame | Reject malformed command; maintain last valid state | Request immediate telemetry frame re-transmission |

---

## Section 10 — Versioning & Compatibility Governance

### 10.1 Semantic Versioning Hierarchy
The K9Mesh interface specifications adhere to strict Semantic Versioning (`MAJOR.MINOR.PATCH`):
- **MAJOR (Breaking Changes):** Modifications to binary struct layout, removal of JSON keys, changes to MQTT base topic hierarchy, or changes to CRC polynomials. Requires simultaneous upgrades across firmware and console software.
- **MINOR (Backward-Compatible Additions):** Introduction of new optional telemetry JSON fields, reservation of new command opcodes, or introduction of non-breaking diagnostic fields.
- **PATCH (Non-Functional Clarifications):** Document typo fixes, valid range boundary clarifications, or timing tolerance updates.

### 10.2 Robustness Principle & Backward Compatibility Contract
1. **Console Ingestion Policy (Postel's Law):** The Operator Console parser MUST ignore unknown JSON fields and MUST safely handle missing or `null` attributes by rendering designated unassigned indicators (`--`).
2. **Firmware Command Policy:** Microcontroller command parsers encountering unknown opcodes MUST reply with a structured `ERR_UNKNOWN_COMMAND` packet rather than hanging or resetting the processor.
3. **Deprecation Grace Period:** Any field slated for deprecation must be documented as `DEPRECATED` for at least one minor release cycle before physical removal.

---

## Section 11 — Future Payload & Expansion Reservations

The K9Mesh architecture pre-allocates schema namespaces, command opcodes, and binary identifiers for planned system expansions:

```
+-------------------------------------------------------------------------------+
|                    PRE-ALLOCATED EXPANSION NAMESPACES                         |
+-------------------------------------------------------------------------------+
|  1. THERMAL IMAGER SUBSYSTEM (LWIR Radiometric)                               |
|     - Namespace: telemetry.thermal                                            |
|     - Reserved Keys: spotTempC, minTempC, maxTempC, colormap, rawMatrixBase64  |
|     - Reserved Command: CMD_CAL_SHUTTER (0x30)                                |
+-------------------------------------------------------------------------------+
|  2. ENVIRONMENTAL & HAZARDOUS GAS SENSING                                     |
|     - Namespace: telemetry.environment                                        |
|     - Reserved Keys: coPpm, co2Ppm, ch4LelPercent, o2Percent, vocIndex, tempC |
|     - Reserved Command: CMD_CAL_GAS_ZERO (0x31)                               |
+-------------------------------------------------------------------------------+
|  3. 2D / 3D SOLID-STATE LiDAR OBSTACLE MAPPING                                |
|     - Namespace: telemetry.lidar                                              |
|     - Reserved Keys: minObstacleDistM, pointCloudCompressed, scanRateHz       |
|     - Reserved Command: CMD_SET_LIDAR_POWER (0x32)                            |
+-------------------------------------------------------------------------------+
|  4. MULTI-ROVER SWARM MESH ROUTING                                            |
|     - Namespace: telemetry.swarm                                              |
|     - Reserved Keys: peerRoversCount, meshHopCount, routeTable, relayNodeId   |
|     - Reserved Command: CMD_SWARM_COORDINATE (0x33)                           |
+-------------------------------------------------------------------------------+
|  5. AUTONOMOUS SLAM & AI PATH PLANNING                                        |
|     - Namespace: telemetry.navigation.autonomy                                |
|     - Reserved Keys: navGoalX, navGoalY, pathWaypoints, localCostmapGrid      |
|     - Reserved Command: CMD_EXECUTE_PATH (0x34)                               |
+-------------------------------------------------------------------------------+
```

---

### Document Approval & Authoritative Baseline
This Interface Control Document constitutes the formal systems contract governing all subsequent software implementations, hardware bridge developments, and communication driver integrations for the K9Mesh platform.
