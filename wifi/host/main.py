"""
CSI receiver + MVS/ML detection orchestrator (laptop side).

    ESP32 UDP -> CSIReceiver (Scapy sniff) -> per-packet amplitude
                                                     |
                                    13s still-room baseline
                                                     |
                                    NBVI band select + MVS calibrate
                                                     |
                              +----------------------+----------------------+
                              |                                             |
                         MVSDetector                                  MLDetector
                     (NBVI band, adaptive thresh)              (fixed band, needs model.pkl)
                              |                                             |
                              +----------------------+----------------------+
                                                     |
                                          console output (state changes)

Run:
    sudo python main.py --interface wlp2s0
    sudo python main.py --interface wlp2s0 --model model.pkl   # once you've trained one
    sudo python main.py --interface wlp2s0 --skip-calibration  # use DEFAULT_BAND, no adaptive threshold
"""

import argparse
import time
from pathlib import Path
from queue import Empty

from scapy.all import AsyncSniffer

from receiver import CSIReceiver
from csi_dsp import DEFAULT_BAND
from mvs_detector import MVSDetector, MOTION
from ml_detector import MLDetector
import nbvi


def run_calibration(rx, duration_s, window_size):
    """Collect a still-room baseline, then pick a band and MVS threshold.

    Returns (band, mvs_detector) - band is NBVI-selected if it succeeds,
    otherwise DEFAULT_BAND (matching upstream's documented fallback).
    """
    print(f"\n{'-'*60}")
    print(f"Calibration: keep the room EMPTY AND STILL for {duration_s:.0f}s")
    print(f"{'-'*60}")

    baseline_frames = []
    t_end = time.time() + duration_s
    while time.time() < t_end:
        try:
            packet = rx.recv(timeout=1.0)
        except Empty:
            continue
        baseline_frames.append(packet.amplitudes)

    print(f"Collected {len(baseline_frames)} baseline packets.")

    try:
        band = nbvi.select_band(baseline_frames, k=12)
        print(f"NBVI selected band: {band}")
    except Exception as e:
        band = list(DEFAULT_BAND)
        print(f"NBVI selection failed ({e}); falling back to DEFAULT_BAND: {band}")

    mvs = MVSDetector(band=band, window_size=window_size)
    try:
        threshold = mvs.calibrate(baseline_frames)
        print(f"MVS adaptive threshold: {threshold:.4f}")
    except Exception as e:
        print(f"MVS calibration failed ({e}); detector will run uncalibrated "
              f"(reports variance but never flags motion until you fix this).")

    return band, mvs


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
    sniffer = AsyncSniffer(
        iface=args.interface,
        filter=f"udp port {args.port}",
        prn=rx._handle_packet,
        store=False,
    )
    sniffer.start()
    print(f"Listening for CSI on {args.interface}:{args.port} ...")

    if args.skip_calibration:
        band = list(DEFAULT_BAND)
        mvs = MVSDetector(band=band, window_size=args.mvs_window)
        print(f"Skipping calibration - using DEFAULT_BAND: {band}, no adaptive threshold.")
    else:
        band, mvs = run_calibration(rx, args.calibration_seconds, args.mvs_window)

    ml = MLDetector(model_path=args.model, window_size=args.ml_window)

    print(f"\n{'-'*60}")
    print("Live detection - Ctrl+C to stop")
    print(f"{'-'*60}\n")

    last_mvs_state = None
    n_packets = 0

    try:
        while True:
            try:
                packet = rx.recv(timeout=1.0)
            except Empty:
                continue

            n_packets += 1
            mvs_state, mvs_variance = mvs.process(packet.amplitudes)
            ml_result = ml.process(packet.amplitudes)

            if mvs_state != last_mvs_state:
                marker = "!!! MOTION !!!" if mvs_state == MOTION else "idle"
                print(f"[seq={packet.seq}] MVS -> {marker} (variance={mvs_variance:.4f})")
                last_mvs_state = mvs_state

            if ml_result["ready"] and n_packets % 25 == 0:
                if ml.enabled:
                    tag = "MOTION" if ml_result["motion"] else "idle"
                    print(f"[seq={packet.seq}] ML  -> {tag} (p={ml_result['score']:.3f})  "
                          f"| MVS variance={mvs_variance:.4f}, dropped={rx.dropped}")
                else:
                    print(f"[seq={packet.seq}] MVS variance={mvs_variance:.4f}, "
                          f"dropped={rx.dropped} (no ML model loaded)")

    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        sniffer.stop()
        print(f"Total packets: {n_packets}, dropped: {rx.dropped}")


if __name__ == "__main__":
    main()
