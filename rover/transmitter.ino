#include <esp_now.h>
#include <WiFi.h>

// REPLACE WITH YOUR RECEIVER MAC Address
uint8_t broadcastAddress[] = {0xe0, 0x8c, 0xfe, 0xe5, 0xec, 0x5c};  // Receiver MAC

// Joystick pins (ADC1, WiFi-safe)
#define PIN_VRX 34
#define PIN_VRY 35
#define PIN_SW  32

// Structure to send data
// Must match the receiver structure
typedef struct struct_message {
  int16_t x;     // -255..255, turn
  int16_t y;     // -255..255, throttle
  bool stop;      // deadman/button
} struct_message;

struct_message myData;

esp_now_peer_info_t peerInfo;

int centerX = 2048;
int centerY = 2048;

void calibrateCenter() {
  long sumX = 0, sumY = 0;
  const int N = 50;
  for (int i = 0; i < N; i++) {
    sumX += analogRead(PIN_VRX);
    sumY += analogRead(PIN_VRY);
    delay(5);
  }
  centerX = sumX / N;
  centerY = sumY / N;
  Serial.printf("Calibrated center: X=%d Y=%d\n", centerX, centerY);
}

// callback when data is sent
void OnDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  Serial.print("\r\nLast Packet Send Status:\t");
  Serial.println(status == ESP_NOW_SEND_SUCCESS ? "Delivery Success" : "Delivery Fail");
}

void setup() {
  // Init Serial Monitor
  Serial.begin(115200);

  pinMode(PIN_SW, INPUT_PULLUP);

  Serial.println("Calibrating, don't touch joystick...");
  calibrateCenter();

  // Set device as a Wi-Fi Station
  WiFi.mode(WIFI_STA);

  // Init ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }

  // Once ESPNow is successfully Init, we will register for Send CB to
  // get the status of Trasnmitted packet
  esp_now_register_send_cb(esp_now_send_cb_t(OnDataSent));

  // Register peer
  memcpy(peerInfo.peer_addr, broadcastAddress, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;

  // Add peer
  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("Failed to add peer");
    return;
  }
}

void loop() {
  // Raw ADC 0..4095, joystick center ~2048
  int rawX = analogRead(PIN_VRX);
  int rawY = analogRead(PIN_VRY);

  // Map relative to calibrated center, deadzone around center
  int x, y;
  if (rawX >= centerX) x = map(rawX, centerX, 4095, 0, 255);
  else                 x = map(rawX, 0, centerX, -255, 0);

  if (rawY >= centerY) y = map(rawY, centerY, 4095, 0, 255);
  else                 y = map(rawY, 0, centerY, -255, 0);

  if (abs(x) < 30) x = 0;
  if (abs(y) < 30) y = 0;

  myData.x = x;
  myData.y = y;
  myData.stop = (digitalRead(PIN_SW) == LOW);

  esp_err_t result = esp_now_send(broadcastAddress, (uint8_t *) &myData, sizeof(myData));

  if (result == ESP_OK) {
    Serial.printf("Sent x=%d y=%d stop=%d\n", myData.x, myData.y, myData.stop);
  } else {
    Serial.println("Error sending the data");
  }
  delay(50);  // 20Hz, was 2000ms demo delay
}
