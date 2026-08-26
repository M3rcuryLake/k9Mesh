# K9Mesh

<div align="center">

### An Open-Source RF Life-Sign Detection Platform for Collapsed Structure Search and Rescue

**Wi-Fi Channel State Information • Embedded Robotics • Real-Time Signal Processing**

![License](https://img.shields.io/badge/License-MIT-green)
![Platform](https://img.shields.io/badge/Platform-ESP32%20%7C%20STM32-blue)
![Status](https://img.shields.io/badge/Status-Active%20Development-orange)
![Application](https://img.shields.io/badge/Application-CSSR-red)

</div>

---

## About

K9Mesh is an open-source RF life-sign detection platform designed for **Collapsed Structure Search and Rescue (CSSR)**.

The platform combines Wi-Fi Channel State Information (CSI), embedded robotics and real-time signal processing to detect human motion and respiration through visually opaque obstacles using commodity hardware.

Unlike conventional robotic platforms, K9Mesh combines RF sensing with rover localization. Every detection is associated with the rover's estimated position, allowing rescue teams to visualize survivor probability maps instead of isolated sensor readings.

The system is built around a distributed embedded architecture consisting of an STM32 motion controller, an ESP32 CSI processing node and a mission control backend connected through MQTT.

K9Mesh extends the Micro-ESPectre CSI engine while preserving its original motion detection pipeline. Additional modules perform respiration detection, rover pose synchronization and probabilistic survivor mapping without modifying the core algorithm.

The project is intended as an open research platform for embedded systems, RF sensing and disaster response.

---

## Motivation

Locating survivors after structural collapse remains one of the most time-critical stages of disaster response.

Thermal cameras require line of sight. Acoustic sensors depend on victims producing sound. Search dogs remain highly effective but require extensive training and cannot safely access every environment. Professional life-sign radar systems provide excellent performance but are expensive and difficult to deploy at scale.

K9Mesh investigates an alternative approach.

Instead of transmitting dedicated radar signals, the platform analyses disturbances in existing Wi-Fi communication channels. Human movement and respiration introduce measurable changes in Channel State Information that can be processed to estimate the presence of life behind visually opaque obstacles.

The objective is not to replace existing rescue technologies. K9Mesh is designed to provide an additional sensing modality that assists rescue teams in prioritizing search operations.

---

## System Overview

K9Mesh consists of four independent subsystems.

| Subsystem | Responsibility |
|-----------|----------------|
| STM32 Rover Controller | Motion control, odometry and sensor fusion |
| ESP32 CSI Node | RF sensing and signal processing |
| STM32 Remote Controller | Manual rover operation through nRF24L01 |
| Mission Control | Visualization, MQTT communication and survivor mapping |

Separating these responsibilities allows each subsystem to operate independently while simplifying future development and maintenance.

---

## Capabilities

### RF Sensing

- Human motion detection using Wi-Fi CSI
- Respiration detection
- Through-wall RF sensing
- Adaptive environmental calibration
- Confidence estimation

### Robotics

- Differential drive platform
- STM32 motion controller
- MPU9250 inertial measurement unit
- Wheel encoder odometry
- Dead reckoning
- PID motor control

### Communication

- UART communication between STM32 and ESP32
- nRF24L01 remote control
- MQTT telemetry
- Real-time mission monitoring

### Mission Control

- Rover pose visualization
- Live telemetry
- Detection logging
- Survivor probability mapping
- Search zone prioritization

---

## Design Objectives

K9Mesh has been designed around four engineering objectives.

### Modularity

Motion control, RF sensing and mission management operate as independent subsystems with clearly defined interfaces.

### Reproducibility

The complete hardware and software stack is based on commercially available components and open-source software.

### Extensibility

New sensing algorithms, localization techniques and autonomous navigation modules can be integrated without redesigning the existing architecture.

### Accessibility

The platform demonstrates that RF life-sign sensing can be implemented using low-cost embedded hardware, making experimentation accessible to students, researchers and humanitarian organizations.

---

## Repository Layout

```
K9Mesh/
│
├── firmware/
│   ├── stm32/
│   ├── esp32/
│   └── micro-espectre/
│
├── backend/
├── hardware/
├── datasets/
├── experiments/
├── docs/
│
├── README.md
└── LICENSE
```

The repository is organized to separate firmware, documentation, hardware resources, datasets and experimental results.
## System Architecture

K9Mesh follows a distributed embedded architecture in which each subsystem is responsible for a single task. Separating motion control, RF sensing and mission management improves real-time performance, simplifies debugging and allows individual components to evolve independently.

```
                     Mission Control
      Visualization • MQTT • Heatmaps • Logging
                        ▲
                        │ Wi-Fi
                        │
                ESP32 CSI Processing Node
      CSI Acquisition • Motion • Respiration • MQTT
                        ▲
                      UART
                        ▲
               STM32 Rover Controller
    IMU • Encoders • Odometry • PID • Motor Control
                        ▲
                    nRF24L01
                        ▲
             STM32 Remote Controller
```

---

### STM32 Rover Controller

The STM32 is responsible for every real-time operation performed by the rover. It controls the drive system, estimates the rover pose and continuously transfers navigation data to the ESP32.

Responsibilities include:

- Differential drive control
- PID motor speed regulation
- Wheel encoder processing
- MPU9250 sensor fusion
- Dead reckoning
- Rover pose estimation
- UART communication with the ESP32

Keeping motion control independent from RF sensing ensures deterministic execution regardless of Wi-Fi traffic or MQTT activity.

---

### ESP32 CSI Processing Node

The ESP32 performs all RF sensing operations.

It captures Wi-Fi Channel State Information packets, executes the modified Micro-ESPectre processing pipeline and publishes processed data through MQTT.

Responsibilities include:

- CSI acquisition
- Gain calibration
- Adaptive subcarrier selection
- Motion detection
- Respiration detection
- MQTT communication
- Pose synchronization

The ESP32 never performs motor control, allowing RF processing to operate without affecting rover stability.

---

### STM32 Remote Controller

A dedicated STM32-based controller communicates with the rover using an nRF24L01 radio module.

This communication channel is completely independent of Wi-Fi and provides reliable low-latency manual control.

Responsibilities include:

- Steering control
- Speed control
- Emergency stop
- Wireless command transmission

---

### Mission Control

Mission Control receives telemetry from the rover through MQTT.

Instead of displaying raw CSI measurements, it converts processed detections into information useful during search and rescue operations.

Mission Control provides:

- Live rover telemetry
- Rover trajectory
- Motion detection status
- Respiration detection status
- Detection confidence
- Survivor probability maps
- Search coverage visualization
- Experimental data logging

---

## Communication Architecture

K9Mesh uses three independent communication channels.

| Interface | Purpose |
|-----------|----------|
| nRF24L01 | Remote rover control |
| UART | STM32 ↔ ESP32 communication |
| MQTT | Rover ↔ Mission Control |

Each interface has a dedicated purpose, reducing system complexity while improving reliability.

---

## System Workflow

The complete operating sequence is shown below.

```
Power On
    │
    ▼
Initialize Hardware
    │
    ▼
CSI Calibration
    │
    ▼
Start Mission
    │
    ▼
Drive Rover
    │
    ▼
Estimate Rover Pose
    │
    ▼
Acquire CSI Packets
    │
    ▼
Detect Motion
    │
 ┌──┴──┐
 │     │
 │No   │Yes
 │     ▼
 │ Stop Rover
 │     │
 │     ▼
 │Detect Respiration
 │     │
 └────►▼
Publish MQTT
    │
    ▼
Mission Control
    │
    ▼
Update Survivor Map
```

Every subsystem contributes to the workflow without interrupting any other subsystem.

---

# CSI Processing

K9Mesh extends the Micro-ESPectre CSI engine while preserving its original statistical motion detection pipeline.

Incoming Wi-Fi packets undergo calibration before feature extraction and classification.

```
Raw CSI
    │
    ▼
Gain Lock
    │
    ▼
Adaptive Subcarrier Selection
    │
    ▼
Spatial Turbulence Estimation
    │
    ▼
Optional Filtering
    │
    ▼
Moving Variance
    │
    ▼
Adaptive Threshold
    │
    ▼
Human Motion Detection
```

The calibration stage automatically determines stable subcarriers and estimates the environmental baseline. This allows the detector to adapt to different operating environments without manual tuning.

Detailed mathematical descriptions of the processing stages are available in **micro-espectre/ALGORITHMS.md**.

---

# CSSR Extension

The original Micro-ESPectre engine detects environmental motion.

K9Mesh extends the architecture by introducing independent processing modules while preserving compatibility with the existing motion detector.

```
                 CSI Stream
                      │
              Existing Preprocessing
                      │
         ┌────────────┴─────────────┐
         │                          │
         ▼                          ▼
 Human Motion Detection     Respiration Detection
         │                          │
         └────────────┬─────────────┘
                      ▼
              MQTT Data Publisher
```

The motion detector remains unchanged.

The respiration detector operates as a parallel processing module and consumes the same calibrated CSI stream.

This architecture allows future physiological or localization algorithms to be integrated without modifying the existing detection pipeline.

---

# Respiration Detection

Detecting stationary survivors requires analysing much smaller signal variations than those produced by body movement.

K9Mesh introduces a dedicated respiration detection pipeline that estimates breathing rate from low-frequency CSI fluctuations.

```
CSI
 │
 ▼
Stable Subcarriers
 │
 ▼
Weighted Average
 │
 ▼
Downsampling
 │
 ▼
Sliding Ring Buffer
 │
 ▼
Band-pass Filter
0.1–0.5 Hz
 │
 ▼
Fast Fourier Transform
 │
 ▼
Peak Detection
 │
 ▼
Respiration Rate
```

The detector estimates respiration between **6 and 30 breaths per minute**.

To minimise platform-induced interference, respiration analysis is intended to operate while the rover is stationary.

Each detection includes:

- Respiration rate
- Detection confidence
- Packet quality
- Signal quality

The respiration detector operates independently of the motion detector and does not modify the original Micro-ESPectre processing pipeline.
# Rover Pose Estimation

Human detection alone is insufficient during search and rescue operations. Rescue teams require spatial information to determine where a potential survivor is located and which areas have already been inspected.

K9Mesh addresses this by associating every RF observation with the rover's estimated position.

The STM32 continuously estimates the rover pose using wheel encoder odometry combined with heading information from the MPU9250 gyroscope. The estimated position is transmitted to the ESP32 through UART, where it is embedded into every MQTT message generated by the CSI processing pipeline.

```
Wheel Encoders
        │
        ▼
Distance Estimation
        │
        ▼
MPU9250 Gyroscope
        │
        ▼
Heading Estimation
        │
        ▼
Dead Reckoning
        │
        ▼
(X, Y, Heading)
        │
        ▼
ESP32
        │
        ▼
MQTT
```

This allows RF detections to be visualized in their physical context rather than as isolated sensor measurements.

---

# Survivor Probability Mapping

Instead of producing binary motion events, K9Mesh continuously builds a probabilistic representation of the search area.

Every RF observation contributes to the confidence associated with a specific region of the environment.

```
CSI Observation
        │
        ▼
Motion Score
        │
        ▼
Respiration Status
        │
        ▼
Detection Confidence
        │
        ▼
Rover Position
        │
        ▼
Probability Grid
        │
        ▼
Survivor Map
```

Areas with repeated high-confidence detections gradually become high-priority search zones, while unexplored regions remain marked for additional inspection.

This approach allows rescue teams to allocate resources based on evidence rather than individual sensor events.

---

# Mission Control

Mission Control acts as the operational interface for K9Mesh.

It receives telemetry through MQTT and converts embedded sensor data into information that can be interpreted quickly by rescue personnel.

Mission Control provides:

- Live rover telemetry
- Rover trajectory visualization
- Human motion status
- Respiration status
- Detection confidence
- Survivor probability maps
- Search coverage visualization
- Mission recording

The objective is to present actionable information rather than raw RF measurements.

---

# MQTT Message Structure

Every processed observation is published as a structured JSON message.

```json
{
    "timestamp": 1723015324,
    "state": "motion",
    "movement": 0.81,
    "breathing": true,
    "breathing_bpm": 15.4,
    "confidence": 0.93,
    "signal_quality": 0.89,
    "pps": 965,
    "rover_x": 2.37,
    "rover_y": 4.91,
    "rover_heading": 92.1
}
```

The message format has been designed to support future sensing modules without requiring changes to the communication protocol.

---

# Signal to Survivor

The purpose of K9Mesh is not simply to detect RF disturbances.

The objective is to transform wireless measurements into meaningful information for search and rescue operations.

```
Wi-Fi Packet
      │
      ▼
Channel State Information
      │
      ▼
Signal Processing
      │
      ▼
Human Motion Detection
      │
      ▼
Respiration Detection
      │
      ▼
Pose Synchronization
      │
      ▼
MQTT Telemetry
      │
      ▼
Mission Control
      │
      ▼
Survivor Probability Map
      │
      ▼
Prioritized Search Zones
```

Every subsystem contributes to this processing chain. The final output is not a single detection event but a continuously updated representation of the environment that supports decision making during rescue operations.

---

# Novel Contributions

K9Mesh combines embedded robotics, RF sensing and localization into a unified open-source platform for collapsed structure search and rescue.

The project introduces several architectural contributions.

### Distributed Embedded Architecture

Motion control, RF sensing and mission management operate on independent hardware platforms connected through dedicated communication channels.

### Mobile Wi-Fi CSI Sensing

CSI acquisition is integrated with a mobile robotic platform capable of exploring unknown environments while continuously collecting RF observations.

### Parallel Respiration Detection

A dedicated respiration detection pipeline extends the Micro-ESPectre engine without modifying the existing motion detection algorithm.

### Pose-Tagged RF Observations

Every CSI measurement is synchronized with the rover position, allowing detections to be visualized spatially.

### Survivor Probability Mapping

Multiple observations are fused into a continuously updated probability map that highlights high-confidence search zones.

### Open Research Platform

The complete hardware and software stack is designed for reproducible research using commercially available components.

---

# Experimental Validation

K9Mesh will be evaluated using representative search and rescue scenarios.

The evaluation focuses on sensing performance, localization accuracy and system reliability.

| Metric | Description |
|----------|-------------|
| Motion Detection Accuracy | Correct classification of human movement |
| Respiration Detection Accuracy | Estimated breathing rate compared with ground truth |
| False Positive Rate | Incorrect detections in an empty environment |
| Localization Error | Difference between estimated and measured rover position |
| Through-Wall Performance | Detection across different construction materials |
| Processing Latency | Time from CSI acquisition to visualization |
| Packet Processing Rate | CSI packets processed per second |
| Coverage Efficiency | Percentage of environment successfully scanned |

Experimental datasets and performance results will be published with future releases of the repository.

---
# Future Development

K9Mesh has been designed as a modular research platform. The current implementation establishes the core sensing pipeline, while the architecture allows additional sensing modalities and autonomous capabilities to be integrated without redesigning the system.

Future development will focus on improving localization accuracy, detection reliability and autonomous exploration.

### RF Sensing

- Multi-node Wi-Fi CSI sensing
- Adaptive clutter suppression
- Dynamic environmental calibration
- Confidence-aware detection models
- Extended RF propagation analysis

### Robotics

- Autonomous waypoint navigation
- Simultaneous Localization and Mapping (SLAM)
- Obstacle avoidance
- Autonomous search planning
- Multi-rover coordination

### Signal Processing

- Deep learning assisted CSI feature extraction
- Bayesian confidence estimation
- Adaptive respiration tracking
- Continuous environmental learning
- Automatic parameter optimization

### Mission Control

- Three-dimensional survivor probability mapping
- Mission replay and analysis
- Cloud-based telemetry
- Multi-rover visualization
- GIS integration for disaster response

---

# Hardware

| Component | Description |
|----------|-------------|
| ESP32 | Wi-Fi CSI acquisition and signal processing |
| STM32 | Rover motion controller |
| STM32 | Remote controller |
| MPU9250 | Inertial Measurement Unit |
| L298D | Motor driver |
| TT Gear Motors | Differential drive platform |
| Wheel Encoders | Odometry |
| nRF24L01 | Remote communication |
| Laptop | Mission Control |
| Mosquitto | MQTT broker |

---

# Software Stack

### Embedded

- STM32 HAL
- ESP-IDF
- FreeRTOS

### Signal Processing

- Wi-Fi Channel State Information
- Fast Fourier Transform
- Statistical Signal Processing
- Adaptive Thresholding
- Digital Filtering

### Communication

- UART
- SPI
- MQTT
- nRF24L01

### Backend

- Python
- NumPy
- Matplotlib
- MQTT
- JSON

---

# Repository Structure

```
K9Mesh/
│
├── firmware/
│   ├── stm32/
│   ├── esp32/
│   └── micro-espectre/
│
├── backend/
│
├── hardware/
│
├── datasets/
│
├── experiments/
│
├── docs/
│
├── images/
│
├── README.md
│
└── LICENSE
```

---

# Build Status

| Module | Status |
|----------|---------|
| Rover Platform | ✅ |
| STM32 Motion Control | ✅ |
| Wireless Controller | ✅ |
| CSI Acquisition | ✅ |
| Motion Detection | ✅ |
| MQTT Communication | ✅ |
| Rover Pose Estimation | 🚧 |
| Respiration Detection | 🚧 |
| Survivor Probability Mapping | 🚧 |
| Mission Control Dashboard | 🚧 |
| Autonomous Navigation | 📋 |
| Multi-Node CSI | 📋 |

---

# Contributing

Contributions are welcome from researchers, students and developers interested in:

- Embedded Systems
- Robotics
- RF Engineering
- Wireless Communication
- Signal Processing
- Disaster Response Technology
- Humanitarian Engineering

Bug reports, feature requests and pull requests are encouraged.

---

# Why Open Source?

Search and rescue technology should be reproducible, accessible and continuously improved through collaboration.

K9Mesh is released as an open-source platform to encourage experimentation in RF sensing, embedded robotics and disaster response technologies.

By combining affordable hardware with open software, the project aims to lower the barrier for researchers, students and humanitarian organizations interested in life-sign detection.

The long-term objective is to establish a reproducible platform that supports research, education and real-world deployment.

---

# Acknowledgements

K9Mesh builds upon the work of several open-source communities and research projects.

Special thanks to:

- Micro-ESPectre
- Espressif Systems
- STM32 Community
- Open-source Robotics Community
- Embedded Systems Research Community

Their work has provided the foundation upon which K9Mesh has been developed.

---

# Citation

If K9Mesh contributes to your research, please cite the repository.

```bibtex
@misc{k9mesh,
    title={K9Mesh: An Open-Source RF Life-Sign Detection Platform for Collapsed Structure Search and Rescue},
    author={Your Team Name},
    year={2026},
    publisher={GitHub},
    url={https://github.com/your-repository}
}
```

---

# Project Vision

K9Mesh explores the use of Wi-Fi Channel State Information as a practical sensing modality for humanitarian search and rescue.

Rather than replacing existing rescue technologies, the platform complements conventional methods by providing an additional source of environmental awareness in situations where visibility is limited.

The project demonstrates how commodity embedded hardware, open-source software and modern signal processing techniques can be combined to develop affordable research platforms for disaster response.

As the project evolves, K9Mesh aims to become a reproducible reference platform for RF-based life-sign detection, embedded robotics and intelligent search assistance.

---

<div align="center">

## K9Mesh

### Open-Source RF Life-Sign Detection Platform

**Designed for research. Built for humanitarian applications.**

*"When visibility ends, radio continues."*

⭐ If you find this project useful, consider giving it a star.

</div>
