#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ====== WiFi ======
const char* HOTSPOT_SSID = "ESP_NET";
const char* HOTSPOT_PASS = "12345678";

// ====== LEDs ======
#define LED_GREEN 13
#define LED_RED   12

// ====== BUZZER (ACTIF) ======
#define BUZZER_PIN 27

// ====== I2C ======
#define I2C_SDA 21
#define I2C_SCL 22

// ⚠️ change 0x3F -> 0x27 si besoin
LiquidCrystal_I2C lcd(0x3F, 16, 2);

WebServer server(80);

// ---------------- Helpers ----------------
void setLED(bool greenOn, bool redOn) {
  digitalWrite(LED_GREEN, greenOn ? HIGH : LOW);
  digitalWrite(LED_RED,   redOn   ? HIGH : LOW);
}

void lcdShow(const String& l1, const String& l2 = "") {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(l1);
  lcd.setCursor(0, 1); lcd.print(l2);
}

String prettyToken(String tok) {
  tok.trim();
  String low = tok; low.toLowerCase();

  if (low == "space") return "SPACE";
  if (low == "del") return "DEL";
  if (low == "nothing" || low == "") return "No sign";

  if (tok.length() == 1) {
    char c = tok[0];
    if (c >= 'a' && c <= 'z') c -= 32;
    return String(c);
  }
  return tok;
}

// ---------------- BUZZER (ACTIF) ----------------
void buzzerInit() {
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
}

void buzzerBeep(int ms = 150) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);
}

// ---------------- UI states ----------------
void showWaiting() {
  setLED(false, true);
  lcdShow("WAITING...", "No sign");
}

void showDetected(String tok) {
  setLED(true, false);
  lcdShow("DETECTED:", prettyToken(tok));

  // ✅ bip seulement pour une lettre A..Z
  tok.trim();
  if (tok.length() == 1) {
    char c = tok[0];
    if (c >= 'a' && c <= 'z') c -= 32;
    if (c >= 'A' && c <= 'Z') buzzerBeep(150);
  }
}

// ---------------- Endpoint ----------------
void handlePred() {
  if (!server.hasArg("l")) {
    server.send(400, "text/plain", "Missing arg l");
    return;
  }

  String tok = server.arg("l");
  tok.trim();

  // normalisation
  String low = tok; low.toLowerCase();
  if (tok.length() == 1) {
    char c = tok[0];
    if (c >= 'a' && c <= 'z') c -= 32;
    tok = String(c);
  } else {
    tok = low;  // "space", "del", "nothing"
  }

  Serial.print("📩 Recu /pred?l=");
  Serial.println(tok);

  if (tok == "nothing" || tok == "") showWaiting();
  else showDetected(tok);

  server.send(200, "text/plain", "OK");
}

// ---------------- WiFi ----------------
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(HOTSPOT_SSID, HOTSPOT_PASS);

  Serial.print("Connexion WiFi");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("✅ WiFi CONNECTE");
    Serial.print("📌 IP ESP32 LCD: ");
    Serial.println(WiFi.localIP());

    lcdShow("WIFI OK", WiFi.localIP().toString());
    delay(1200);
    showWaiting();
  } else {
    Serial.println("❌ WiFi FAILED");
    lcdShow("WIFI FAILED", "Check SSID/PASS");
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);

  // LCD
  Wire.begin(I2C_SDA, I2C_SCL);
  lcd.init();
  lcd.backlight();

  // BUZZER
  buzzerInit();

  // ✅ Test buzzer au démarrage
  buzzerBeep(150);
  delay(150);
  buzzerBeep(150);

  showWaiting();

  // WiFi
  connectWiFi();

  // Server
  server.on("/pred", handlePred);
  server.begin();

  Serial.println("✅ Serveur OK: http://<IP_ESP32_LCD>/pred?l=A");
}

void loop() {
  server.handleClient();
}
