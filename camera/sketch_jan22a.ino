#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClient.h>
#include <HTTPClient.h>

// (optionnel) pour éviter reset brownout sur ESP32-CAM
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ===================== WIFI =====================
const char* ssid = "ESP_NET";
const char* password = "12345678";

// ===================== PC (Flask) =====================
const char* PC_IP = "192.168.137.1";
String flaskPingUrl()   { return String("http://") + PC_IP + ":8000/ping"; }
String flaskUploadUrl() { return String("http://") + PC_IP + ":8000/upload"; }

// ===================== CAMERA PINS (AI Thinker ESP32-CAM) =====================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ===================== FLASH (LED blanche ESP32-CAM AI Thinker) =====================
#define FLASH_PIN 4  // LED flash

// ===================== TIMING =====================
// Plus petit = plus "live" (essaye 400 puis 300 puis 200)
const unsigned long SEND_EVERY_MS = 300;
unsigned long lastSend = 0;

bool wifiReady = false;
bool cameraReady = false;

// ===================== JSON helper =====================
bool extractPredictedLetter(const String& json, char &outLetter) {
  int k = json.indexOf("\"predicted_letter\"");
  if (k < 0) return false;
  int colon = json.indexOf(':', k);
  if (colon < 0) return false;
  int q1 = json.indexOf('\"', colon + 1);
  if (q1 < 0) return false;
  int q2 = json.indexOf('\"', q1 + 1);
  if (q2 < 0) return false;
  String val = json.substring(q1 + 1, q2);
  if (val.length() < 1) return false;
  outLetter = val.charAt(0);
  return true;
}

// ===================== WIFI =====================
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);      // améliore débit / stabilité
  WiFi.begin(ssid, password);

  Serial.print("Connexion WiFi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < 30000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi FAILED");
    wifiReady = false;
    return;
  }
  wifiReady = true;
  Serial.println("✅ WiFi connecté !");
  Serial.print("IP ESP32-CAM: ");
  Serial.println(WiFi.localIP());
}

// ===================== CAMERA =====================
bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;

  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;

  config.pin_xclk  = XCLK_GPIO_NUM;
  config.pin_pclk  = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href  = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn  = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;

  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // ===== Qualité + vitesse (adaptation selon PSRAM) =====
  // - VGA donne meilleure qualité, mais plus lourd.
  // - jpeg_quality plus grand = plus compressé = plus rapide.
  // Ici on vise "un peu live" + image correcte.
  if (psramFound()) {
    Serial.println("✅ PSRAM: OK");
    config.frame_size   = FRAMESIZE_VGA;  // 640x480 (qualité ++)
    config.jpeg_quality = 15;             // 12 = meilleure, 15 = + rapide (bon compromis)
    config.fb_count     = 2;              // plus fluide
  } else {
    Serial.println("⚠️ PSRAM: NOT FOUND");
    config.frame_size   = FRAMESIZE_QVGA; // 320x240 (plus stable sans PSRAM)
    config.jpeg_quality = 15;
    config.fb_count     = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("❌ Camera init failed: 0x%x\n", err);
    return false;
  }

  // ===== Réglages capteur (rendu) =====
  sensor_t * s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 0);   // -2 .. 2
    s->set_contrast(s, 1);     // -2 .. 2 (1 rend souvent l'image + nette)
    s->set_saturation(s, 0);   // -2 .. 2

    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);

    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 1);

    s->set_gain_ctrl(s, 1);
    s->set_agc_gain(s, 0);     // 0 = auto
  }

  Serial.println("✅ Camera OK");
  return true;
}

// ===================== TEST PING =====================
void testPing() {
  if (!wifiReady) return;
  WiFiClient client;
  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(3000);

  String url = flaskPingUrl();
  Serial.print("🔎 TEST /ping: ");
  Serial.println(url);

  if (!http.begin(client, url)) {
    Serial.println("❌ http.begin failed");
    return;
  }

  int code = http.GET();
  String resp = http.getString();
  http.end();

  Serial.print("🔎 /ping code: "); Serial.println(code);
  Serial.print("🔎 /ping resp: "); Serial.println(resp);
}

// ===================== CAPTURE + UPLOAD =====================
void captureAndUpload() {
  if (!wifiReady || !cameraReady) return;

  // Flash ON (LED blanche)
  digitalWrite(FLASH_PIN, HIGH);
  delay(50); // laisse l'exposition se stabiliser un peu

  camera_fb_t * fb = esp_camera_fb_get();

  // Flash OFF
  digitalWrite(FLASH_PIN, LOW);

  if (!fb) {
    Serial.println("❌ Capture failed (fb == NULL). Souvent alim/pins/frame_size.");
    return;
  }

  WiFiClient client;
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(8000);

  String url = flaskUploadUrl();
  Serial.print("📤 Upload -> ");
  Serial.println(url);

  if (!http.begin(client, url)) {
    Serial.println("❌ http.begin failed");
    esp_camera_fb_return(fb);
    return;
  }

  http.addHeader("Content-Type", "image/jpeg");
  int code = http.POST(fb->buf, fb->len);
  String resp = http.getString();
  http.end();

  esp_camera_fb_return(fb);

  Serial.print("📤 /upload code: ");
  Serial.println(code);

  if (resp.length()) {
    Serial.print("📤 /upload resp: ");
    Serial.println(resp);

    char letter;
    if (extractPredictedLetter(resp, letter)) {
      Serial.print("✅ Predicted letter: ");
      Serial.println(letter);
    } else {
      Serial.println("⚠️ JSON sans predicted_letter");
    }
  }
}

void setup() {
  // Optionnel: évite brownout reset (selon alim)
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  delay(400);

  // Flash pin
  pinMode(FLASH_PIN, OUTPUT);
  digitalWrite(FLASH_PIN, LOW);

  connectWiFi();
  cameraReady = initCamera();

  testPing();
}

void loop() {
  if (millis() - lastSend > SEND_EVERY_MS) {
    lastSend = millis();
    captureAndUpload();
  }
}
