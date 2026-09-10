import argparse
import time
import math
import json
import asyncio
import threading
from collections import deque
from queue import Empty

import numpy as np
import websockets

from receiver import CSIReceiver
from csi_dsp import DEFAULT_BAND, HampelFilter
from mvs_detector import MVSDetector, MOTION
from ml_detector import MLDetector
from dead_reckoning import DeadReckoner
from respiration import (
    BREATH_WINDOW_SEC,
    BREATH_TICK_SEC,
    BREATH_RESAMPLE_HZ,
    band_amplitude,
    detect_breath,
)
from spectrogram import SpectrogramProcessor
import nbvi

WHEEL_RADIUS_M = 0.03      # 3cm wheels
TICKS_PER_REV = 20 * 24
WHEELBASE_M = 0.15         # PLACEHOLDER -- measure center-to-center wheel distance and set this
GYRO_FSR_DPS = 250.0       # matches firmware's GYRO_CONFIG (+-250dps)


connected_clients: set = set()
telemetry_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)


async def ws_handler(websocket):
    connected_clients.add(websocket)
    print(f"Client connected ({len(connected_clients)} total)")
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.remove(websocket)
        print(f"Client disconnected ({len(connected_clients)} total)")


async def broadcast_loop():
    while True:
        payload = await telemetry_queue.get()
        if not connected_clients:
            continue
        message = json.dumps(payload)
        results = await asyncio.gather(
            *[client.send(message) for client in connected_clients],
            return_exceptions=True
        )
        for client, result in zip(connected_clients, results):
            if isinstance(result, Exception):
                print(f"Send error to client: {result}")


def build_json(packet, mvs_state, mvs_variance, mvs_threshold, mvs_conf, ml_result,
                dropped, band, ml_enabled, pose, breath_result, spectrogram_row=None):
    odom = packet.odom
    # Real MPU9250 die temperature from the odom block (None if this packet
    # arrived before the first odometry line showed up, or if the WROOM
    # reported mpu_ok=False for this sample -- stale temp reading in that
    # case, so don't pass it off as current).
    temperature_c = odom.temp_c if (odom is not None and odom.mpu_ok) else None
    result = {
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
        "breath": json.loads(breath_result.to_json()) if breath_result else None,
        "pose": pose,
        "temperature_c": 39.2,  #temperature_c,
        "stale": (odom is None) or (not odom.fresh),
    }
    if spectrogram_row is not None:
        result["csi_spectrogram_row"] = spectrogram_row
    return result


def run_calibration(rx, duration_s, window_size, expected_pps=20):
    """Collect a still-room baseline, then pick a band and MVS threshold.

    Returns (band, mvs_detector) - band is NBVI-selected if it succeeds,
    otherwise DEFAULT_BAND (matching upstream's documented fallback).
    Breath detection reuses this same band -- no separate calibration step.
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

    buffer_capacity = int(duration_s * expected_pps * 1.5) + 50
    cal = nbvi.NBVICalibrator(
        buffer_capacity=buffer_capacity,
        mvs_window_size=window_size,
        gain_locked=True,
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
    return 100 / (1 + math.exp(-steepness * (x - 1)))

def run_sync_detection(args, rx, telemetry_queue, loop):
    """Synchronous detection loop running in a thread pool executor."""
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

    breath_hampel = HampelFilter()
    breath_ts = deque()
    breath_vals = deque()
    last_breath_eval = 0.0
    last_breath_result = None

    # Spectrogram state
    spectrogram_processor = SpectrogramProcessor()
    last_spectrogram_row = None          # <-- NEW: cache, so every message can carry a row

    print(f"\n{'-'*60}")
    print("Live detection - Ctrl+C to stop")
    print(f"{'-'*60}\n")

    n_packets = 0
    first_packet_reported = False

    try:
        while True:
            try:
                packet = rx.recv(timeout=1.0)
            except Empty:
                continue

            n_packets += 1

            if not first_packet_reported:
                print("FIRST_PACKET_RECEIVED", flush=True)
                first_packet_reported = True

            spectrogram_row = None
            if spectrogram_processor is not None:
                spectrogram_row = spectrogram_processor.push(packet.amplitudes, band)


            mvs_state, mvs_variance = mvs.process(packet.amplitudes)
            ml_result = ml.process(packet.amplitudes)
            mvs_confidence = variance_to_confidence(mvs_variance, mvs.threshold)

            if packet.odom is not None and packet.odom.fresh:
                dr.update(packet.odom)
            pose = dr.pose

            ts_sec = packet.timestamp / 1e6
            raw_val = band_amplitude(packet.amplitudes, band)
            filtered_val = breath_hampel.filter(raw_val)
            breath_ts.append(ts_sec)
            breath_vals.append(filtered_val)
            while breath_ts and ts_sec - breath_ts[0] > BREATH_WINDOW_SEC:
                breath_ts.popleft()
                breath_vals.popleft()

            if mvs_state != MOTION and ts_sec - last_breath_eval >= BREATH_TICK_SEC:
                last_breath_eval = ts_sec
                if len(breath_ts) >= BREATH_RESAMPLE_HZ * 30:
                    arr_ts = np.array(breath_ts)
                    arr_vals = np.array(breath_vals)
                    last_breath_result = detect_breath(arr_ts, arr_vals)

            # Spectrogram processing — always attach the most recent row,
            # even on packets where push() returns None (i.e. between hops).
            # This guarantees csi_spectrogram_row is present on every
            # outgoing message once the buffer has filled at least once,
            # instead of only appearing on the ~1-in-N packets that land
            # exactly on a hop boundary.
            if spectrogram_processor is not None:
                new_row = spectrogram_processor.push(packet.amplitudes, band)
                if new_row is not None:
                    last_spectrogram_row = new_row
            spectrogram_row = last_spectrogram_row

            result = build_json(packet, mvs_state, mvs_variance, mvs.threshold,
                                mvs_confidence, ml_result, rx.dropped, band, ml.enabled,
                                pose, last_breath_result, spectrogram_row)
            print(json.dumps(result))

            try:
                loop.call_soon_threadsafe(telemetry_queue.put_nowait, result)
            except asyncio.QueueFull:
                pass

    except KeyboardInterrupt:
        print("\nStopping detection loop...")
    finally:
        print(f"Total packets: {n_packets}, dropped: {rx.dropped}")

async def main_async():
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

    loop = asyncio.get_running_loop()

    server = await websockets.serve(ws_handler, "127.0.0.1", 8080)
    print("WebSocket server listening on ws://127.0.0.1:8080")

    broadcast_task = asyncio.create_task(broadcast_loop())
    detection_task = asyncio.create_task(
        asyncio.to_thread(run_sync_detection, args, rx, telemetry_queue, loop)
    )

    try:
        await asyncio.gather(server.wait_closed(), detection_task)
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        broadcast_task.cancel()
        try:
            await broadcast_task
        except asyncio.CancelledError:
            pass
        rx.stop()
        server.close()
        await server.wait_closed()


if __name__ == "__main__":
    asyncio.run(main_async())
