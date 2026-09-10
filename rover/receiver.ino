/*
  Rui Santos
  Complete project details at https://RandomNerdTutorials.com/esp-now-esp32-arduino-ide/

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files.

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.
*/

#include <esp_now.h>
#include <WiFi.h>
#include <Wire.h>

// L298N pins
#define ENA 25  // left PWM
#define IN1 26
#define IN2 27
#define IN3 14
#define IN4 4
#define ENB 33  // right PWM

// PWM config (Arduino-ESP32 core >=3.0 ledc API; use ledcSetup/ledcAttachPin
// instead if you're on core 2.x)
#define PWM_FREQ 5000
#define PWM_RES  8  // 0-255

// FC-03 encoders
#define ENCODER_L 34
#define ENCODER_R 35
volatile long ticksL = 0;
volatile long ticksR = 0;
volatile int8_t dirL = 1;  // set by setMotor() from commanded speed sign
volatile int8_t dirR = 1;
void IRAM_ATTR onEncoderL() { ticksL += dirL; }
void IRAM_ATTR onEncoderR() { ticksR += dirR; }

// MPU9250 (I2C)
#define MPU_SDA 21
#define MPU_SCL 22
#define MPU_ADDR 0x68  // AD0 low; use 0x69 if AD0 tied high

int16_t ax, ay, az, gx, gy, gz;
int16_t rawTemp = 0;
float tempC = 0.0f;
bool mpuOk = false;

// MPU-9250 datasheet conversion (Register Map sec. 4.18): 21 degC at
// TEMP_OUT = 0, sensitivity 333.87 LSB/degC (some earlier MPU-60x0-derived
// code uses the 340/36.53 constants -- those are for the MPU6050, not the
// 9250, and will read several degrees off).
float tempRawToC(int16_t raw) {
  return (raw / 333.87f) + 21.0f;
}

bool mpuInit() {
  Wire.begin(MPU_SDA, MPU_SCL, 400000);
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);  // PWR_MGMT_1
  Wire.write(0x00);  // wake up, clock = internal
  if (Wire.endTransmission() != 0) return false;

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1C);  // ACCEL_CONFIG
  Wire.write(0x00);  // +-2g
  Wire.endTransmission();

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1B);  // GYRO_CONFIG
  Wire.write(0x00);  // +-250 dps
  Wire.endTransmission();

  return true;
}

// Reject samples where any axis pegs at the int16 rail (0x7FFF/0x8000) --
// on a real ±2g/±250dps MPU9250 that only happens on bus corruption, never
// from genuine motion, since it needs every one of 16 bits to read as
// stuck-high or a clean 0xFF/0x00 byte pair.
bool isSaturated(int16_t v) {
  return v == 32767 || v == -32768;
}

bool mpuRead() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);  // ACCEL_XOUT_H
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, 14) != 14) return false;

  int16_t nax = (Wire.read() << 8) | Wire.read();
  int16_t nay = (Wire.read() << 8) | Wire.read();
  int16_t naz = (Wire.read() << 8) | Wire.read();
  int16_t ntemp = (Wire.read() << 8) | Wire.read();
  int16_t ngx = (Wire.read() << 8) | Wire.read();
  int16_t ngy = (Wire.read() << 8) | Wire.read();
  int16_t ngz = (Wire.read() << 8) | Wire.read();

  if (isSaturated(nax) || isSaturated(nay) || isSaturated(naz) ||
      isSaturated(ntemp) ||
      isSaturated(ngx) || isSaturated(ngy) || isSaturated(ngz)) {
    return false;  // bogus sample -- drain any leftover bus state and bail
  }

  ax = nax; ay = nay; az = naz;
  rawTemp = ntemp;
  tempC = tempRawToC(ntemp);
  gx = ngx; gy = ngy; gz = ngz;
  return true;
}

// UART2 to S3 (odometry out)
#define UART_TX 17
#define UART_RX 16
HardwareSerial S3Link(2);  // UART2
unsigned long lastUartSend = 0;

// Structure to receive data
// Must match the sender structure
typedef struct struct_message {
  int16_t x;
  int16_t y;
  bool stop;
} struct_message;

struct_message myData;

void setMotor(int enaPwm, int in1, int in2, int speed, volatile int8_t* dir) {
  // speed: -255..255
  bool fwd = speed >= 0;
  digitalWrite(in1, fwd);
  digitalWrite(in2, !fwd);
  ledcWrite(enaPwm, constrain(abs(speed), 0, 255));
  *dir = fwd ? 1 : -1;
}

void OnDataRecv(const esp_now_recv_info_t * info, const uint8_t *incomingData, int len) {
  memcpy(&myData, incomingData, sizeof(myData));

  int left = 0, right = 0;

  if (myData.stop) {
    left = 0;
    right = 0;
  } else {
    // Arcade mixing: y = throttle, x = turn
    left  = constrain(myData.y + myData.x, -255, 255);
    right = constrain(myData.y - myData.x, -255, 255);
  }

  setMotor(ENA, IN1, IN2, left, &dirL);
  setMotor(ENB, IN3, IN4, right, &dirR);

  Serial.printf("x=%d y=%d stop=%d -> L=%d R=%d\n", myData.x, myData.y, myData.stop, left, right);
}

void setup() {
  Serial.begin(115200);

  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);

  ledcAttach(ENA, PWM_FREQ, PWM_RES);
  ledcAttach(ENB, PWM_FREQ, PWM_RES);

  pinMode(ENCODER_L, INPUT);
  pinMode(ENCODER_R, INPUT);
  attachInterrupt(digitalPinToInterrupt(ENCODER_L), onEncoderL, RISING);
  attachInterrupt(digitalPinToInterrupt(ENCODER_R), onEncoderR, RISING);

  S3Link.begin(115200, SERIAL_8N1, UART_RX, UART_TX);

  mpuOk = mpuInit();
  if (!mpuOk) Serial.println("MPU9250 init failed");

  WiFi.mode(WIFI_STA);

  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }

  esp_now_register_recv_cb(OnDataRecv);
}

void loop() {
  if (millis() - lastUartSend >= 100) {  // 10Hz, matches STM32 odometry rate
    lastUartSend = millis();
    noInterrupts();
    long l = ticksL, r = ticksR;
    interrupts();

    mpuOk = mpuRead();  // always retry; don't latch dead forever
    if (!mpuOk) Serial.println("MPU9250 read failed");

    // Added tempC (1 decimal place) as a new trailing field. If the S3-side
    // parser expects a fixed field count, update it to read this field too.
    S3Link.printf("%ld,%ld,%d,%d,%d,%d,%d,%d,%.1f,%d\n",
                  l, r, ax, ay, az, gx, gy, gz, tempC, mpuOk ? 1 : 0);
    Serial.printf("ticksL=%ld ticksR=%ld ax=%d ay=%d az=%d gx=%d gy=%d gz=%d tempC=%.1f mpuOk=%d\n",
                   l, r, ax, ay, az, gx, gy, gz, tempC, mpuOk ? 1 : 0);
  }
}
