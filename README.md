
# K9Mesh

### **An Open-Source Wi-Fi CSI Based Life-Sign Detection Rover for Collapsed Structure Search & Rescue (CSSR)**

> Detecting human presence through obstacles using commodity Wi-Fi hardware, embedded signal processing, and real-time robotic exploration.
> 
> **K9Mesh is not designed to replace rescue teams.**
>
> It is designed to help them answer one critical question faster than ever before:
>
> **"Where should we search first?"**

----------

## Overview

Every year, thousands of lives are lost due to delayed victim localization following earthquakes, structural collapses, landslides, mine accidents, and other disaster scenarios. Existing search techniques often rely on expensive radar systems, thermal cameras with limited penetration capability, or acoustic sensors that perform poorly in noisy environments.

**K9Mesh** is an open-source embedded sensing platform that transforms commodity ESP32 Wi-Fi hardware into a low-cost RF life-sign detection system capable of detecting human motion and respiratory activity through obstacles using **Wi-Fi Channel State Information (CSI)**.

The project combines real-time CSI processing, robotic exploration, dead-reckoning localization, and RF signal analysis to generate prioritized survivor search zones for first responders.

----------

# Key Features

### RF Life-Sign Detection

-   Human motion detection using Wi-Fi CSI    
-   Through-wall RF sensing
-   Respiration detection (6–30 BPM)    
-   Adaptive environmental calibration    
-   Real-time confidence estimation
    

----------

### Embedded Robotics

-   Differential drive rover
-   STM32-based motor controller
-   MPU9250 IMU integration   
-   Wheel encoder odometry
-   PID speed control    
-   Wireless remote operation via nRF24L01
    

----------

### Signal Processing

-   Automatic Gain Lock    
-   Adaptive Subcarrier Selection    
-   Spatial Turbulence Analysis    
-   Hampel Outlier Filtering 
-   Butterworth Low-Pass Filtering
-   Moving Variance Estimation    
-   Adaptive Threshold Detection
    

----------

### Backend

-   MQTT communication    
-   Live telemetry    
-   Detection logging    
-   Rover pose fusion    
-   Detection heatmaps		    
-   Ranked survivor zones
    

----------

# System Architecture

```text
                    Mission Control Laptop
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  Mosquitto MQTT Broker                                        │
│  Visualization                                                 │
│  Survivor Ranking                                              │
│  Heatmap Generation                                            │
│  Data Logging                                                  │
│                                                               │
└───────────────────────────────────────────────────────────────┘
                      ▲
                      │ Wi-Fi
                      │
         ┌─────────────────────────────┐
         │      ESP32 CSI Node         │
         │─────────────────────────────│
         │ CSI Acquisition             │
         │ Motion Detection            │
         │ Breathing Detection         │
         │ MQTT Publisher              │
         └──────────────▲──────────────┘
                        │ UART
                        │
         ┌──────────────┴──────────────┐
         │        STM32 Rover          │
         │─────────────────────────────│
         │ MPU9250                     │
         │ Wheel Encoders              │
         │ Motor PID                   │
         │ Dead Reckoning              │
         │ L298D                       │
         └──────────────▲──────────────┘
                        │
                 nRF24L01 Link
                        │
         ┌──────────────┴──────────────┐
         │      STM32 Controller       │
         │─────────────────────────────│
         │ Joysticks                   │
         │ Buttons                     │
         │ Manual Rover Control        │
         └─────────────────────────────┘

```

----------

# CSI Processing Pipeline

The project is built upon an extended version of the **Micro-ESPectre** CSI engine.

```
Raw CSI
   │
Gain Lock
   │
Band Selection
   │
Spatial Turbulence
   │
Optional Signal Conditioning
   │
Moving Variance
   │
Adaptive Threshold
   │
Motion Detection

```

During initialization, the engine automatically performs:

-   Gain stabilization    
-   AGC locking
-   Optimal subcarrier selection    
-   Environmental baseline estimation
    

This calibration enables robust operation under varying RF conditions without requiring manual parameter tuning.

For a complete mathematical description of the processing pipeline, refer to **`micro-espectre/ALGORITHMS.md`**.

----------

# CSSR Extension

RF-LifeSign extends the original Micro-ESPectre architecture by introducing modular life-sign processing modules that operate in parallel with the existing motion detector.

```
                     CSI Stream
                          │
                 Existing Preprocessing
                          │
             ┌────────────┴────────────┐
             │                         │
             ▼                         ▼
      Motion Detector        Breathing Detector
             │                         │
             └────────────┬────────────┘
                          ▼
                    MQTT Publisher

```

The original motion detection pipeline remains completely unchanged.

New processing modules consume the same calibrated CSI stream without modifying the existing algorithm.

----------

# Breathing Detection

A dedicated respiration detection module extends the CSI processing engine to detect low-frequency chest motion associated with human breathing.

Processing stages include:

-   Stable subcarrier fusion    
-   Signal downsampling
-   Sliding ring buffer
-   0.1–0.5 Hz band-pass filtering
-   Frequency-domain analysis (FFT)
-   Dominant peak detection
-   Breathing rate estimation
-   Confidence scoring
    

Unlike motion detection, respiration analysis is designed to operate while the rover is stationary, allowing weak periodic chest motion to be isolated from platform-induced RF disturbances.

Expected operating range:

- Parameter
- Value
- Respiration Rate
- 6–30 BPM
- Analysis Window
- 20–30 s
- Frequency Band
- 0.1–0.5 Hz

Complete implementation details are available in **`DATASHEET.md`**.

----------

# Localization

Every CSI measurement is associated with the rover's estimated pose.

The STM32 computes:

-   X Position
-   Y Position    
-   Heading
    

using wheel encoder odometry fused with MPU9250 gyroscope data.

This allows the backend to generate:

-   Rover trajectory
-   RF coverage maps
-   Survivor probability heatmaps
-   Ranked inspection zones
    
----------
# Technology Stack

### Embedded

-   ESP32
-   STM32
-   FreeRTOS
-   ESP-IDF
-   STM32 HAL
    

### Signal Processing

-   Wi-Fi CSI
-   FFT
-   Adaptive Thresholding
-   Statistical Signal Processing
-   Spatial Turbulence Analysis
    

### Communication

-   UART
-   SPI
-   MQTT
-   Mosquitto    
-   nRF24L01
    

### Backend

-   Python
-   NumPy
-   Matplotlib
-   MQTT
    
----------
# Repository Structure
```
firmware/
│
├── stm32/
├── esp32/
├── micro-espectre/
│
backend/
│
docs/
│
hardware/
│
datasets/
│
experiments/

```
----------
# Vision

K9Mesh aims to democratize RF life-sign sensing by providing an entirely open-source, low-cost, and extensible platform for humanitarian search and rescue research.

Rather than replacing existing rescue technologies, the project is intended to complement thermal imaging, acoustic sensing, and canine search teams by providing an additional RF-based sensing modality capable of operating in visually occluded environments.

Our long-term objective is to develop an affordable embedded RF sensing platform that enables researchers, students, and disaster response teams to explore the next generation of intelligent search and rescue systems.

