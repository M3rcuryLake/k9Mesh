# Rover Controller — Complete Compiled Datasheet

4WD search-and-rescue rover: STM32-based odometry/motor hub, dual FC-03 wheel encoders, MPU9250 IMU, NRF24L01 manual-override radio, and ESP32 WiFi-CSI/MQTT link.

---

## 1. System architecture

```
                    ┌─────────────┐
        ┌──────────►│   L298N     │──► Left motors (parallel)
        │           │  (motor drv)│──► Right motors (parallel)
        │           └─────────────┘
        │
        │           ┌─────────────┐
        ├──────────►│  MPU9250    │  (I2C1 — heading/accel)
        │           └─────────────┘
        │
        │           ┌─────────────┐
STM32 ──┼──────────►│ FC-03 × 2   │  (EXTI — wheel ticks)
(hub)   │           └─────────────┘
        │
        │           ┌─────────────┐
        ├──────────►│  NRF24L01   │  (SPI1 — manual override link)
        │           └─────────────┘
        │
        │           ┌─────────────┐
        └───UART1───►│   ESP32    │──► WiFi CSI + MQTT (own supply)
                     │  (DevKit)  │
                     └─────────────┘
```

---

## 2. STM32F103C8T6 ("Blue Pill") — main controller

| Spec | Value |
|---|---|
| Core | ARM Cortex-M3, 72 MHz |
| Flash / RAM | 64 KB / 20 KB |
| Logic voltage | 3.3V (most GPIOs 5V-tolerant — verify per pin) |
| Onboard regulator | AMS1117-3.3, ~800mA rated, realistically budget less under shared load |
| I2C | I2C1 (PB6/PB7) |
| SPI | SPI1 (PA4–PA7) |
| USART | USART1 (PA9/PA10) |
| PWM timers | TIM1–TIM4 |
| EXTI | One interrupt line per pin number; PB0 and PA0 share EXTI0 — can't use both at once |

### Full pin map

| Function | Pin(s) | Peripheral |
|---|---|---|
| Motor A/B speed (PWM) | PA0, PA1 | TIM2_CH1, TIM2_CH2 |
| Motor A/B direction | PB12, PB13, PB14, PB15 | GPIO |
| MPU9250 SCL / SDA | PB6, PB7 | I2C1 |
| Left / right encoder pulse | PB0, PB1 | EXTI0, EXTI1 |
| NRF24L01 SCK/MISO/MOSI | PA5, PA6, PA7 | SPI1 |
| NRF24L01 CSN / CE | PA4, PA3 | GPIO |
| NRF24L01 IRQ (optional) | PA2 | EXTI2 |
| ESP32 link TX / RX | PA9, PA10 | USART1 |

---

## 3. L298N — dual H-bridge motor driver

| Spec | Value |
|---|---|
| Motor supply (VS) | 5–46V DC |
| Logic supply (VSS) | 5V, onboard regulator (jumper-selectable) |
| Max current/channel | ~2A continuous, ~3A peak |
| Voltage drop | ~1.4–2V across the bridge |
| Channels | 2 (A = left side, B = right side) |

### Pinout

| Pin | Function | Connects to |
|---|---|---|
| ENA | Left speed (PWM) | STM32 PA0 |
| IN1, IN2 | Left direction | STM32 PB12, PB13 |
| OUT1, OUT2 | Left motors (front + rear, parallel) | — |
| ENB | Right speed (PWM) | STM32 PA1 |
| IN3, IN4 | Right direction | STM32 PB14, PB15 |
| OUT3, OUT4 | Right motors (front + rear, parallel) | — |
| 12V | Motor power in | Battery pack (direct, not shared with logic) |
| 5V | Logic power out | 5V rail strip |
| GND | Common ground | Shared with all boards |

**4WD wiring note:** both motors on a side must have matching (+)/(−) polarity to OUT1/OUT2 (or OUT3/OUT4) — mismatched polarity makes one wheel per side spin backwards relative to its partner.

---

## 4. MPU9250 — 9-DOF IMU

| Spec | Value |
|---|---|
| Interface | I2C |
| Address | 0x68 (0x69 if AD0 high) |
| Logic voltage | 3.3V |
| Accel range | ±2/4/8/16 g |
| Gyro range | ±250/500/1000/2000 °/s |
| Magnetometer (AK8963) | ±4800 µT, sub-address 0x0C |
| WHO_AM_I | reg 0x75 → expect 0x71 |

### Pinout

| Pin | Connects to |
|---|---|
| VCC | 3.3V rail |
| GND | Common ground |
| SCL | STM32 PB6 |
| SDA | STM32 PB7 |
| AD0 | GND |

Pull-ups: most breakouts have onboard 10kΩ pull-ups on SDA/SCL already — verify with an I2C scanner before adding external 4.7kΩ resistors.

---

## 5. FC-03 — IR photoelectric speed sensor (×2)

| Spec | Value |
|---|---|
| Supply | 3.3–5V (LM393 comparator-based, tolerant of a wide range) |
| Outputs | D0 (digital, thresholded) + A0 (raw analog, unused here) |
| Adjustment | Onboard potentiometer sets detection threshold |

### Pinout (×2 units)

| Unit | VCC | GND | D0 → STM32 |
|---|---|---|---|
| Left encoder | 5V rail | Common GND | PB0 (EXTI0) |
| Right encoder | 5V rail | Common GND | PB1 (EXTI1) |

Match slot count on both encoder discs — mismatched slot counts silently skew tick-to-distance conversion on one side.

---

## 6. NRF24L01 — 2.4GHz radio (manual override link)

| Spec | Value |
|---|---|
| Interface | SPI, up to 10 Mbps |
| Frequency | 2.4–2.525 GHz, 125 channels |
| Data rate | 250 kbps / 1 Mbps / 2 Mbps |
| Range | ~100m (basic), ~1km (PA+LNA + external antenna) |
| Supply | 3.3V strictly — never 5V on any pin |
| Known issue | TX current spikes brown out cheap onboard regulators — add 100–470µF cap across VCC/GND |

### Pinout

| Pin | Connects to |
|---|---|
| VCC | 3.3V rail |
| GND | Common ground |
| SCK | STM32 PA5 |
| MOSI | STM32 PA7 |
| MISO | STM32 PA6 |
| CSN | STM32 PA4 |
| CE | STM32 PA3 |
| IRQ | STM32 PA2 (optional) |

---

## 7. ESP32 — WiFi CSI + MQTT link (confirmed: ESP32-WROOM-32 DevKit)

| Spec | Value |
|---|---|
| Module | ESP32-WROOM-32, WiFi + BT, 802.11 b/g/n |
| Board type | DevKit — micro-USB, onboard USB-serial chip, onboard AMS1117-3.3 regulator |
| Power in | **VIN** (5V) — do not feed 3V3 pin as an input, it's a regulated output |
| Role | Micro-ESPectre CSI capture, ML detector, MQTT publish; receives fused pose from STM32 over UART |

### Pinout

| Pin | Connects to | Notes |
|---|---|---|
| VIN | Dedicated 5V rail | separate buck converter — do NOT share with L298N's onboard reg or the STM32/sensor rail |
| GND | Common ground | |
| UART2 RX (GPIO16) | STM32 PA9 (USART1 TX) | use UART2, not UART0, to avoid clashing with USB-serial flashing lines |
| UART2 TX (GPIO17) | STM32 PA10 (USART1 RX) | |

---

## 8. Power distribution architecture

**Battery pack:** 4×1.5V AA/AAA in series ≈ 6V

| Rail | Fed from | Feeds | Notes |
|---|---|---|---|
| Motor supply | Battery pack, direct | L298N OUT1–4 only | Never shared with logic |
| 5V rail strip | 6V battery pack (via red line) | STM32 (if not USB-powered), FC-03 ×2 | ~1V over nominal 5V spec — fine for LM393-based FC-03, monitor for warmth |
| 3.3V rail strip | STM32's onboard 3.3V pin | MPU9250, NRF24L01 | Uses STM32's regulator, not raw battery |
| ESP32 5V | **Dedicated** separate buck converter | ESP32 VIN only | Isolated from all of the above — WiFi TX bursts (300–500mA) would brown out a shared rail |
| Common GND | — | Every rail and board above | One wire from each rail strip's blue (GND) line back to STM32 GND, tying all islands into a single reference |

### Grounding rule

Every physically separate rail strip, breadboard section, or power source needs **at least one wire back to a single common ground point** (STM32 GND, in this build). Power sources can be separate; ground must not be.

---

## 9. Build phase mapping

| Phase | Covers |
|---|---|
| 1 — CSI baseline validation | ESP32 + Micro-ESPectre, done independently of the above |
| 2 — Odometry hardware | L298N, FC-03 ×2, MPU9250 wiring (this document) |
| 3 — UART pose integration | STM32 ↔ ESP32 link (Section 7) |
| 4 — Backend fusion/visualization | Software, not covered here |
| 5 — Field calibration | Hardware tuning (FC-03 threshold pot, encoder disc alignment) |
| Deferred | Acoustic sensing, multi-AP triangulation |
