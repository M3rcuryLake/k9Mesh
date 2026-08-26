import json
import time
import websocket

# Connect to the local GCS WebSocket Server
ws = websocket.create_connection("ws://127.0.0.1:8080")

def send_telemetry(snr, confidence, rate_bpm=18.5, has_breath_key=True):
    payload = {
        "seq": 1000,
        "timestamp_us": 123456789,
        "channel": 1,
        "rssi": -45,
        "dropped": 0,
        "band": [11, 15, 18, 19, 28, 31, 36, 37, 40, 41, 45, 51],
        "mvs": {
            "state": "idle",
            "variance": 0.01,
            "threshold": 0.02,
            "confidence": 30.0
        },
        "ml": {
            "ready": True,
            "score": None,
            "detection": None,
            "enabled": False
        },
        "pose": {
            "x": 3.8,
            "y": 0.0,
            "theta_deg": 45.0
        },
        "gps_lat": 43.6532,
        "gps_lon": -79.3832
    }
    
    if has_breath_key:
        payload["breath"] = {
            "rate_bpm": rate_bpm,
            "snr": snr,
            "confidence": confidence,
            "peak_freq_hz": 0.3,
            "spectral_purity": 0.9,
            "band_power_frac": 0.8,
            "harmonic_ratio": 0.1,
            "n_samples": 300
        }

    ws.send(json.dumps(payload))
    time.sleep(1)

print("Starting GCS UI Boundary Tests for Breath Telemetry...")

print("Test A: No breath key")
send_telemetry(snr=0, confidence=0, has_breath_key=False)

print("Test B: breath.rate_bpm = null")
send_telemetry(snr=0, confidence=0, rate_bpm=None)

print("Test C: Valid breath rate")
send_telemetry(snr=0, confidence=0, rate_bpm=16.5)

print("Test D: SNR <= 3 (snr=2, conf=60) -> NO REGION")
send_telemetry(snr=2, confidence=60)

print("Test E: SNR > 3 but conf <= 50 (snr=5, conf=40) -> NO REGION")
send_telemetry(snr=5, confidence=40)

print("Test F: SNR > 3 AND conf > 50 (snr=5, conf=80) -> YES REGION")
send_telemetry(snr=5, confidence=80)

print("Test G: Confidence = 50 exactly (snr=5, conf=50) -> NO REGION")
send_telemetry(snr=5, confidence=50)

print("Test H: SNR = 3 exactly (snr=3, conf=80) -> NO REGION")
send_telemetry(snr=3, confidence=80)

print("Test I: Confidence = 100 (snr=10, conf=100) -> YES REGION MAX OPACITY")
send_telemetry(snr=10, confidence=100)

print("Tests completed.")
ws.close()
