import os
from datetime import datetime
import json
import time
import threading
import queue
import tempfile
import atexit

import numpy as np
import cv2
import tensorflow as tf
from flask import Flask, jsonify, request, Response, send_file, render_template

import requests
from gtts import gTTS
import pygame

from pre_traitement_image import preprocess_bgr_frame

app = Flask(__name__, template_folder="templates", static_folder="static", static_url_path="/static")

# ======================
# CONFIG
# ======================
MODEL_PATH = "asl_model.h5"
RECEIVED_DIR = "received"
LAST_IMAGE_PATH = os.path.join(RECEIVED_DIR, "last.jpg")
DEBUG_BBOX_PATH = os.path.join(RECEIVED_DIR, "debug_bbox.jpg")
WORD_HISTORY_FILE = "word_history.json"

LABELS_29 = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ") + ["del", "nothing", "space"]

# IMPORTANT: IP réelle de l'ESP32 LCD (vue sur Serial Monitor de l'ESP32 LCD)
LED_ESP32_IP = "192.168.137.200"
LED_ESP32_URL = f"http://{LED_ESP32_IP}/pred"
LED_TIMEOUT_SEC = 1.0

# Anti-spam (évite 10 requêtes / seconde)
SEND_MIN_INTERVAL_SEC = 0.15
_last_sent_token = None
_last_sent_at = 0.0

LAST_RESULT = {
    "ok": False,
    "reason": None,
    "predicted_letter": None,
    "predicted_class_id": None,
    "confidence": None,
    "bytes": 0,
    "saved": None,
    "ts": None,
    "bbox": None,
    "last_spoken_word": "",
}

# ======================
# MANUAL MODE
# ======================
MANUAL_MODE = True
MANUAL_WORD = []
MANUAL_SENTENCE = []
LAST_CONFIRMED_AT = 0.0
CONFIRM_COOLDOWN = 0.6
MIN_CONFIDENCE_TO_CONFIRM = 0.60

# ======================
# WORD HISTORY
# ======================
class WordHistory:
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.history = []
        self.load()

    def add(self, word: str):
        if not word:
            return
        self.history.append({
            "word": word,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "letter_count": len(word),
        })
        self.history = self.history[-50:]
        self.save()

    def last(self, n=10):
        return self.history[-n:] if self.history else []

    def save(self):
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(self.history, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print("❌ Failed to save history:", e)

    def load(self):
        try:
            if os.path.exists(self.filepath):
                with open(self.filepath, "r", encoding="utf-8") as f:
                    self.history = json.load(f) or []
                print(f"📖 Loaded {len(self.history)} words from history")
        except Exception as e:
            print("❌ Failed to load history:", e)
            self.history = []

word_history = WordHistory(WORD_HISTORY_FILE)

# ======================
# TTS
# ======================
class TTSSystem:
    def __init__(self):
        pygame.mixer.init()
        self.speech_queue = queue.Queue()
        self.is_speaking = False
        self.volume = 0.8
        threading.Thread(target=self._speech_worker, daemon=True).start()
        print("✅ TTS System initialized")

    def _speech_worker(self):
        while True:
            try:
                text = self.speech_queue.get(timeout=1)
                if text:
                    self._speak(text)
                self.speech_queue.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                print(f"❌ TTS error: {e}")

    def _speak(self, text: str):
        try:
            self.is_speaking = True
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                temp_file = tmp.name

            gTTS(text=text, lang="en", slow=False).save(temp_file)

            pygame.mixer.music.load(temp_file)
            pygame.mixer.music.set_volume(self.volume)
            pygame.mixer.music.play()

            while pygame.mixer.music.get_busy():
                time.sleep(0.1)

            try:
                os.unlink(temp_file)
            except:
                pass

            self.is_speaking = False
            print(f"🔊 Finished speaking: {text}")
        except Exception as e:
            print(f"❌ Speech error: {e}")
            self.is_speaking = False

    def speak(self, text: str):
        if not self.is_speaking:
            self.speech_queue.put(text)
            print(f"🔊 Queued for speech: {text}")
            return True
        return False

    def set_volume(self, volume: float):
        self.volume = max(0.0, min(1.0, volume))
        if pygame.mixer.get_init():
            pygame.mixer.music.set_volume(self.volume)

tts_system = TTSSystem()

# ======================
# LOAD MODEL
# ======================
if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(f"❌ Model not found: {MODEL_PATH}")

print("⏳ Loading model:", MODEL_PATH)
model = tf.keras.models.load_model(MODEL_PATH, compile=False)
print("✅ Model loaded. input:", model.input_shape, "output:", model.output_shape)

NUM_CLASSES = int(model.output_shape[-1])
CLASS_NAMES = LABELS_29 if NUM_CLASSES == 29 else [f"class_{i}" for i in range(NUM_CLASSES)]
print("✅ Using", len(CLASS_NAMES), "labels")

# ======================
# UTILS
# ======================
def now_iso():
    return datetime.now().isoformat(timespec="seconds")

def ensure_dirs():
    os.makedirs(RECEIVED_DIR, exist_ok=True)

def save_last(jpg_bytes: bytes) -> str:
    ensure_dirs()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    path = os.path.join(RECEIVED_DIR, f"esp32_{ts}.jpg")
    with open(path, "wb") as f:
        f.write(jpg_bytes)
    with open(LAST_IMAGE_PATH, "wb") as f:
        f.write(jpg_bytes)
    return path

def decode_jpeg_to_bgr(raw: bytes):
    nparr = np.frombuffer(raw, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

def predict(x: np.ndarray):
    probs = np.asarray(model.predict(x, verbose=0))[0]
    cid = int(np.argmax(probs))
    conf = float(probs[cid])
    label = CLASS_NAMES[cid] if 0 <= cid < len(CLASS_NAMES) else f"class_{cid}"
    return label, cid, conf

def save_debug_bbox(bgr: np.ndarray, bbox):
    if bgr is None or bbox is None:
        return
    ensure_dirs()
    x1, y1, x2, y2 = bbox
    dbg = bgr.copy()
    cv2.rectangle(dbg, (x1, y1), (x2, y2), (0, 255, 0), 2)
    cv2.imwrite(DEBUG_BBOX_PATH, dbg)

def set_last_result(**kwargs):
    LAST_RESULT.update({
        "ok": kwargs.get("ok", False),
        "reason": kwargs.get("reason"),
        "predicted_letter": kwargs.get("predicted_letter"),
        "predicted_class_id": kwargs.get("predicted_class_id"),
        "confidence": kwargs.get("confidence"),
        "bytes": kwargs.get("bytes", 0),
        "saved": kwargs.get("saved"),
        "ts": kwargs.get("ts", now_iso()),
        "bbox": kwargs.get("bbox"),
        "last_spoken_word": kwargs.get("last_spoken_word", LAST_RESULT.get("last_spoken_word", "")),
    })

def get_uploaded_jpeg_bytes():
    if "image" in request.files:
        return request.files["image"].read()
    return request.get_data(cache=False)

def manual_word_str():
    return "".join([c for c in MANUAL_WORD if c])

def manual_sentence_str():
    return " ".join([w for w in MANUAL_SENTENCE if w])

# ======================
# SEND TO ESP32 LCD
# ======================
def send_to_led_esp32(token: str, force: bool = False):
    """
    Envoie la prédiction à l'ESP32 LCD:
      http://ESP32_IP/pred?l=A | nothing | space | del
    """
    global _last_sent_token, _last_sent_at

    if not token:
        token = "nothing"

    now = time.time()
    if not force:
        # throttle: trop de requêtes => l'ESP32 peut rater
        if (now - _last_sent_at) < SEND_MIN_INTERVAL_SEC:
            return False
        # évite d'envoyer toujours la même lettre
        if token == _last_sent_token:
            return False

    try:
        url = LED_ESP32_URL
        r = requests.get(url, params={"l": token}, timeout=LED_TIMEOUT_SEC)
        _last_sent_token = token
        _last_sent_at = now
        print(f"📟 LCD -> GET {r.url}  status={r.status_code}")
        return True
    except Exception as e:
        print("⚠️ ESP32 LCD unreachable:", e)
        return False

# ======================
# ROUTES
# ======================
@app.get("/")
def home():
    return render_template("index.html", manual_mode=MANUAL_MODE)

@app.get("/ping")
def ping():
    return jsonify(ok=True, msg="pong", time=now_iso(), lcd_target=LED_ESP32_URL)

# Test manuel de l'ESP32 LCD depuis le navigateur
@app.get("/test_led")
def test_led():
    tok = request.args.get("l", "A")
    ok = send_to_led_esp32(tok, force=True)
    return jsonify(success=ok, sent=tok, url=LED_ESP32_URL)

@app.get("/last_json")
def last_json():
    result = dict(LAST_RESULT)
    result["manual_word"] = manual_word_str()
    result["manual_sentence"] = manual_sentence_str()
    result["cooldown"] = CONFIRM_COOLDOWN
    result["min_confidence"] = MIN_CONFIDENCE_TO_CONFIRM
    result["num_classes"] = NUM_CLASSES
    result["manual_mode"] = MANUAL_MODE
    return jsonify(result)

@app.get("/set_volume")
def set_volume():
    volume = request.args.get("volume", "80")
    try:
        vol = int(volume) / 100.0
        tts_system.set_volume(vol)
        return jsonify(success=True, volume=vol)
    except Exception as e:
        return jsonify(success=False, error=str(e)), 500

# ======================
# CAMERA / MODEL
# ======================
@app.post("/upload")
def upload():
    raw = get_uploaded_jpeg_bytes()
    if not raw:
        set_last_result(ok=False, reason="no_data", bytes=0, saved=None, bbox=None)
        send_to_led_esp32("nothing", force=True)
        return jsonify(ok=False, reason="no_data"), 400

    bgr = decode_jpeg_to_bgr(raw)
    if bgr is None:
        set_last_result(ok=False, reason="decode_failed", bytes=len(raw), saved=None, bbox=None)
        send_to_led_esp32("nothing", force=True)
        return jsonify(ok=False, reason="decode_failed"), 400

    saved = save_last(raw)

    try:
        x, bbox = preprocess_bgr_frame(bgr)
    except Exception as e:
        set_last_result(ok=False, reason=f"preprocess_error:{e}", bytes=len(raw), saved=saved, bbox=None)
        send_to_led_esp32("nothing", force=True)
        return jsonify(ok=False, reason="preprocess_error", detail=str(e), saved=saved), 500

    if bbox is not None:
        save_debug_bbox(bgr, bbox)

    if x is None:
        set_last_result(ok=False, reason="no_hand", bytes=len(raw), saved=saved, bbox=bbox)
        send_to_led_esp32("nothing")  # pas force, ok
        return jsonify(ok=False, reason="no_hand", bytes=len(raw), saved=saved, bbox=bbox), 200

    try:
        label, cid, conf = predict(x)
    except Exception as e:
        set_last_result(ok=False, reason=f"predict_error:{e}", bytes=len(raw), saved=saved, bbox=bbox)
        send_to_led_esp32("nothing", force=True)
        return jsonify(ok=False, reason="predict_error", detail=str(e), saved=saved), 500

    set_last_result(
        ok=True,
        reason=None,
        predicted_letter=label,
        predicted_class_id=cid,
        confidence=conf,
        bytes=len(raw),
        saved=saved,
        bbox=bbox,
    )

    # Envoie vers LCD
    send_to_led_esp32(label)

    return jsonify(
        ok=True,
        predicted_letter=label,
        predicted_class_id=cid,
        confidence=conf,
        bbox=bbox,
        bytes=len(raw),
        saved=saved,
        manual_word=manual_word_str(),
        manual_sentence=manual_sentence_str(),
        manual_mode=MANUAL_MODE,
    ), 200

@app.get("/last")
def last():
    if not os.path.exists(LAST_IMAGE_PATH):
        img = np.zeros((240, 320, 3), dtype=np.uint8)
        cv2.putText(img, "Waiting for ESP32...", (30, 120),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        _, buffer = cv2.imencode(".jpg", img)
        return Response(buffer.tobytes(), mimetype="image/jpeg")
    return send_file(LAST_IMAGE_PATH, mimetype="image/jpeg")

@app.get("/debug_bbox")
def debug_bbox():
    if not os.path.exists(DEBUG_BBOX_PATH):
        return Response("No debug bbox yet", mimetype="text/plain", status=404)
    return send_file(DEBUG_BBOX_PATH, mimetype="image/jpeg")

@app.get("/word_history.json")
def get_word_history():
    return jsonify(word_history.last(10))

# ======================
# MANUAL ROUTES 
# ======================
@app.get("/manual_add")
def manual_add():
    global LAST_CONFIRMED_AT

    now = time.time()
    if now - LAST_CONFIRMED_AT < CONFIRM_COOLDOWN:
        return jsonify(success=False, error="cooldown", cooldown=CONFIRM_COOLDOWN - (now - LAST_CONFIRMED_AT)), 429

    if not LAST_RESULT.get("ok") or not LAST_RESULT.get("predicted_letter"):
        return jsonify(success=False, error="no_letter_detected"), 400

    letter = LAST_RESULT["predicted_letter"]
    conf = float(LAST_RESULT.get("confidence") or 0.0)

    if letter in ["nothing", "space", "del"]:
        return jsonify(success=False, error=f"invalid_label:{letter}"), 400

    if conf < MIN_CONFIDENCE_TO_CONFIRM:
        return jsonify(success=False, error="low_confidence", confidence=conf, min_confidence=MIN_CONFIDENCE_TO_CONFIRM), 400

    MANUAL_WORD.append(letter)
    LAST_CONFIRMED_AT = now
    return jsonify(success=True, letter=letter, word=manual_word_str())

@app.get("/manual_delete")
def manual_delete():
    if MANUAL_WORD:
        removed = MANUAL_WORD.pop()
        return jsonify(success=True, removed=removed, word=manual_word_str())
    return jsonify(success=False, error="empty"), 400

@app.get("/manual_clear")
def manual_clear():
    MANUAL_WORD.clear()
    return jsonify(success=True, word="")

@app.get("/manual_speak")
def manual_speak():
    word = manual_word_str().strip()
    if not word:
        return jsonify(success=False, error="empty_word"), 400
    tts_system.speak(word)
    LAST_RESULT["last_spoken_word"] = word
    word_history.add(word)
    return jsonify(success=True, word=word)

@app.get("/manual_space")
def manual_space():
    word = manual_word_str().strip()
    if not word:
        return jsonify(success=False, error="empty_word"), 400

    MANUAL_SENTENCE.append(word)
    tts_system.speak(word)
    LAST_RESULT["last_spoken_word"] = word
    word_history.add(word)
    MANUAL_WORD.clear()

    return jsonify(success=True, word=word, sentence=manual_sentence_str())

@app.get("/manual_speak_sentence")
def manual_speak_sentence():
    sentence = manual_sentence_str().strip()
    if not sentence:
        return jsonify(success=False, error="empty_sentence"), 400
    tts_system.speak(sentence)
    return jsonify(success=True, sentence=sentence)

@app.get("/manual_clear_sentence")
def manual_clear_sentence():
    MANUAL_SENTENCE.clear()
    return jsonify(success=True, sentence="")

# ======================
# CLEANUP
# ======================
def cleanup():
    print("\n🔄 Cleaning up...")
    try:
        if pygame.mixer.get_init():
            pygame.mixer.music.stop()
            pygame.mixer.quit()
    except:
        pass
    word_history.save()
    print("✅ Cleanup complete")

atexit.register(cleanup)

if __name__ == "__main__":
    print("✅ Interface: http://127.0.0.1:8000")
    print("✅ Sending predictions to ESP32 LCD:", LED_ESP32_URL)
    app.run(host="0.0.0.0", port=8000, debug=True, threaded=True)
