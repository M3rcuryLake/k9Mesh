import argparse
import time
import math
import json
import threading
from pathlib import Path
from queue import Empty
import websocket
from receiver import CSIReceiver
from csi_dsp import DEFAULT_BAND
from mvs_detector import MVSDetector, MOTION
from ml_detector import MLDetector
from dead_reckoning import DeadReckoner
import nbvi

# --- Robot chassis constants (from k9Mesh SAR rover hardware) ---
WHEEL_RADIUS_M = 0.03      # 3cm wheels
TICKS_PER_REV = 20         # FC-03 disc: 20 holes, RISING-edge-only counting
WHEELBASE_M = 0.15         # PLACEHOLDER -- measure center-to-center wheel distance and set this
GYRO_FSR_DPS = 250.0       # matches firmware's GYRO_CONFIG (+-250dps)


ws = None

def ws_send(payload):
    global ws
    if ws is None:
        return
    try:
        ws.send(json.dumps(payload))
    except (websocket.WebSocketConnectionClosedException, BrokenPipeError, ConnectionResetError):
        ws = None

def build_json(packet, mvs_state, mvs_variance, mvs_threshold, mvs_conf , ml_result, dropped, band, ml_enabled, pose):
    return {
        "seq": packet.seq,
        "timestamp_us": packet.timestamp,
        "channel": packet.channel,
        "rssi": packet.rssi,
        "dropped": dropped,
        "band": band,
        "mvs": {
            "state": mvs_state,
            "variance": mvs_variance,
            "threshold": mvs_threshold,
            "confidence": mvs_conf,
        },
        "ml": {
            "ready": ml_result["ready"],
            "score": ml_result["score"],
            "detection": ml_result["motion"],
            "enabled": ml_enabled,
        },
        "pose": pose,
    }

def run_calibration(rx, duration_s, window_size, expected_pps=20):
    """Collect a still-room baseline, then pick a band and MVS threshold.

    Returns (band, mvs_detector) - band is NBVI-selected if it succeeds,
    otherwise DEFAULT_BAND (matching upstream's documented fallback).
    """
    print("Waiting for stream to stabilize (first few packets of this session)...\n")

    n_seen = 0
    while n_seen < 50:
        try:
            rx.recv(timeout=1.0)
        except Empty:
            continue
        n_seen += 1
    print(f"Calibration phase for next {duration_s:.0f}s\n")

    # Size generously (duration * expected pps, +50% margin) - add_packet()
    # just stops accepting once full, it won't crash if pps runs higher.
    buffer_capacity = int(duration_s * expected_pps * 1.5) + 50
    cal = nbvi.NBVICalibrator(
        buffer_capacity=buffer_capacity,
        mvs_window_size=window_size,
        gain_locked=True,  # matches this project's GAIN_LOCK_MODE="auto" hardware default
    )

    t_end = time.time() + duration_s
    while time.time() < t_end:
        try:
            packet = rx.recv(timeout=1.0)
        except Empty:
            continue
        cal.add_packet(packet.amplitudes)

    print(f"Collected {cal.get_packet_count()} baseline packets.")

    band, _mv_values = cal.calibrate()
    if band is None:
        band = list(DEFAULT_BAND)
        print(f"NBVI calibration failed; falling back to DEFAULT_BAND: {band}")
    else:
        print(f"NBVI selected band: {band}")

    baseline_frames = cal.get_baseline_frames()
    mvs = MVSDetector(band=band, window_size=window_size, gain_locked=True)
    try:
        threshold = mvs.calibrate(baseline_frames)
        print(f"MVS adaptive threshold: {threshold:.8f}")
    except Exception as e:
        print(f"MVS calibration failed ({e}); detector will run uncalibrated "
              f"(reports variance but never flags motion until you fix this).")

    return band, mvs

def variance_to_confidence(variance, threshold, cap_multiplier=2.0):
    # unwrap single-element arrays/lists, coerce to plain float
    if hasattr(variance, "__len__") and not isinstance(variance, (str, bytes)):
        variance = float(variance[0]) if len(variance) else 0.0
    else:
        variance = float(variance)

    if threshold is None or threshold <= 0:
        return 0.0
    threshold = float(threshold[0]) if hasattr(threshold, "__len__") else float(threshold)

    pct = (variance / (threshold * cap_multiplier)) * 100
    return max(0.0, min(100.0, pct))

def variance_to_confidence_sigmoid(variance, threshold, steepness=6.0):
    if threshold is None or threshold <= 0:
        return 0.0
    x = variance / threshold
    return 100 / (1 + math.exp(-steepness * (x - 1)))  # 50% at variance==threshold

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interface", required=True, help="e.g. wlp2s0")
    ap.add_argument("--port", type=int, default=5005)
    ap.add_argument("--mvs-window", type=int, default=75)
    ap.add_argument("--ml-window", type=int, default=100)
    ap.add_argument("--model", default="model.pkl")
    ap.add_argument("--calibration-seconds", type=float, default=13.0,
                     help="matches upstream's ~13s still-room calibration window")
    ap.add_argument("--skip-calibration", action="store_true",
                     help="skip NBVI/threshold calibration, use DEFAULT_BAND, "
                          "MVS reports variance only (no motion flag)")
    args = ap.parse_args()

    rx = CSIReceiver(interface=args.interface, port=args.port)
    rx_thread = threading.Thread(target=rx.start, daemon=True)
    rx_thread.start()
    print(f"Listening for CSI on {args.interface}:{args.port} ...")

    if args.skip_calibration:
        band = list(DEFAULT_BAND)
        mvs = MVSDetector(band=band, window_size=args.mvs_window, gain_locked=True)
        print(f"Skipping calibration - using DEFAULT_BAND: {band}, no adaptive threshold.")
    else:
        band, mvs = run_calibration(rx, args.calibration_seconds, args.mvs_window)

    ml = MLDetector(model_path=args.model, window_size=args.ml_window)

    dr = DeadReckoner(
        wheel_radius_m=WHEEL_RADIUS_M,
        ticks_per_rev=TICKS_PER_REV,
        wheelbase_m=WHEELBASE_M,
        gyro_fsr_dps=GYRO_FSR_DPS,
    )

    print(f"\n{'-'*60}")
    print("Live detection - Ctrl+C to stop")
    print(f"{'-'*60}\n")

    last_mvs_state = None
    n_packets = 0

    try:
        global ws

        try:
            ws = websocket.create_connection("ws://127.0.0.1:8080")
        except Exception as e:
            print(f"WebSocket connect failed: {e}")


        while True:
            try:
                packet = rx.recv(timeout=1.0)
            except Empty:
                continue

            mvs_state, mvs_variance = mvs.process(packet.amplitudes)
            ml_result = ml.process(packet.amplitudes)
            mvs_confidence = variance_to_confidence(mvs_variance, mvs.threshold)  # no trailing comma

            if packet.odom is not None and packet.odom.fresh:
                dr.update(packet.odom)
            pose = dr.pose

            result = build_json(packet, mvs_state, mvs_variance, mvs.threshold,
                                mvs_confidence, ml_result, rx.dropped, band, ml.enabled, pose)
            print(json.dumps(result))
            ws_send(result)                        # was: print(json.dumps(result))


    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        rx.stop()
        ws.close()
        print(f"Total packets: {n_packets}, dropped: {rx.dropped}")


if __name__ == "__main__":
    main()
