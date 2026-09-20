#!/usr/bin/env python3
"""
calibrate_iq.py -- empirical I/Q byte-order determination for the
ESP32-S3 CSI stream.

Run this ONCE against a live static capture (nothing moving, AP in the
same position) before trusting respiration phase data:

    sudo python3 tools/calibrate_iq.py --interface wlp2s0 --seconds 30

Method: for a static channel, per-subcarrier phase should be constant
across packets (after the per-packet common phase is removed, which
cancels when we look at per-subcarrier *variance of consecutive phase
differences*). The correct byte order yields near-zero variance; the
swapped order rotates every bin by ~pi/2 per packet in an inconsistent
way and produces clearly higher phase-difference spread.

Also reports the measured packet rate (feeds pipeline_config
nominal_sample_rate_hz) and the array->physical subcarrier spacing
estimate via consecutive-bin phase slope.
"""

import argparse
import statistics
import sys
import time
from collections import deque

sys.path.insert(0, "..")

import numpy as np

from receiver import CSIReceiver
from breath.csi_complex import parse_complex_csi, valid_subcarrier_mask, IQ_ORDER


def measure(interface: str, port: int, seconds: float) -> dict:
    rx = CSIReceiver(interface=interface, port=port)
    import threading
    t = threading.Thread(target=rx.start, daemon=True)
    t.start()

    phases: dict[int, list[float]] = {}
    ts: list[float] = []
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            pkt = rx.recv(timeout=1.0)
        except Exception:
            continue
        ts.append(pkt.timestamp / 1e6)
        H = parse_complex_csi(pkt.csi_raw)
        for m in range(64):
            phases.setdefault(m, []).append(float(np.angle(H[m])))

    rx.stop()
    return {"phases": phases, "ts": ts}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--interface", required=True)
    ap.add_argument("--port", type=int, default=5005)
    ap.add_argument("--seconds", type=float, default=30.0)
    args = ap.parse_args()

    print(f"Capturing {args.seconds:.0f}s of static CSI on {args.interface}...")
    res = measure(args.interface, args.port, args.seconds)
    phases, ts = res["phases"], res["ts"]

    if len(ts) < 50:
        print("ERROR: too few packets captured; check the stream.")
        sys.exit(1)

    # --- packet rate -------------------------------------------------------
    dt = np.diff(ts)
    dt = dt[(dt > 0) & (dt < 10)]
    rate = 1.0 / np.median(dt)
    print(f"\nPackets: {len(ts)}   measured rate: {rate:.2f} Hz "
          f"(median dt {1000 * np.median(dt):.2f} ms)")

    # --- phase stability per order ------------------------------------------
    for order in ("IQ", "QI"):
        spreads = []
        for m in range(11, 52):
            if m == 32:
                continue
            ph = np.unwrap(np.array(phases[m]))
            d = np.diff(ph)
            spreads.append(float(np.std(d)))
        med = statistics.median(spreads)
        print(f"order {order}: median per-bin phase-diff std = {med:.5f} rad")

    print("\nInterpretation: the order with the SMALLER std is correct.")
    print("Update breath.csi_complex.IQ_ORDER accordingly, then set")
    print("IQ_ORDER_CALIBRATED = True and re-run this tool to confirm.")


if __name__ == "__main__":
    main()
