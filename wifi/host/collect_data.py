"""
Collect labeled CSI data for ML training.

Run on the laptop while the ESP32 acquisition node is streaming CSI. Keep
the room in ONE state (still, or moving/breathing) for the full duration
of each run - label matches the whole run, there's no in-run relabeling.

Usage:
    # baseline: room empty and still
    sudo python collect_data.py --interface wlp2s0 --label baseline --duration 120 --out data/baseline_01.npz

    # movement: person walking through the sensed area
    sudo python collect_data.py --interface wlp2s0 --label movement --duration 60 --out data/movement_01.npz

Collect several runs of each label, ideally at different distances/angles
from the sensor, before training - a handful of 60-120s runs per class is
a reasonable starting point, not a hard requirement.

Note: `sudo` is only needed for SO_BINDTODEVICE (binding the UDP socket to
a specific --interface). If that fails without root, CSIReceiver falls
back to binding all interfaces (0.0.0.0), so plain `python` still works
as long as only one NIC could plausibly be receiving the stream.
"""

import argparse
import threading
import time
from pathlib import Path
from queue import Empty

import numpy as np

from receiver import CSIReceiver
from csi_dsp import DEFAULT_BAND, HampelFilter, spatial_turbulence
from ml_features import extract_features, FEATURE_NAMES


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interface", required=True, help="e.g. wlp2s0")
    ap.add_argument("--port", type=int, default=5005)
    ap.add_argument("--label", required=True, choices=["baseline", "movement"])
    ap.add_argument("--duration", type=float, default=60.0, help="seconds")
    ap.add_argument("--window-size", type=int, default=100)
    ap.add_argument("--stride", type=int, default=25,
                     help="emit a training window every N packets (overlap = window_size - stride)")
    ap.add_argument("--band", type=int, nargs="+", default=None,
                     help="override subcarrier indices, default = ML fixed band")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    band = args.band or list(DEFAULT_BAND)

    rx = CSIReceiver(interface=args.interface, port=args.port)
    rx_thread = threading.Thread(target=rx.start, daemon=True)
    rx_thread.start()

    hampel = HampelFilter(window=7, threshold=5.0)
    turbulence_window = []

    feature_rows = []
    packets_since_window = 0
    n_packets = 0

    t_end = time.time() + args.duration
    print(f"Collecting '{args.label}' for {args.duration:.0f}s "
          f"on {args.interface}:{args.port} (band={band}) ...")
    print("Ctrl+C to stop early (partial data is still saved).")

    try:
        while time.time() < t_end:
            try:
                packet = rx.recv(timeout=1.0)
            except Empty:
                continue

            n_packets += 1
            band_amps = [packet.amplitudes[i] for i in band if i < len(packet.amplitudes)]
            t = spatial_turbulence(band_amps, gain_locked=True)
            t = hampel.filter(t)

            turbulence_window.append(t)
            if len(turbulence_window) > args.window_size:
                turbulence_window.pop(0)

            packets_since_window += 1
            if len(turbulence_window) == args.window_size and packets_since_window >= args.stride:
                packets_since_window = 0
                feats = extract_features(turbulence_window)
                feature_rows.append(feats)

            if n_packets % 200 == 0:
                print(f"  {n_packets} packets received, "
                      f"{len(feature_rows)} windows so far, dropped={rx.dropped}")

    except KeyboardInterrupt:
        print("\nStopped early.")
    finally:
        rx.stop()

    if not feature_rows:
        print("No full windows collected - check the receiver is actually "
              "getting packets (confirm the ESP32 node is streaming to "
              "--port, and --interface is correct; run with sudo if "
              "SO_BINDTODEVICE binding to that interface is needed).")
        return

    X = np.array(feature_rows, dtype=np.float32)
    y = np.full(len(feature_rows), 1 if args.label == "movement" else 0, dtype=np.int64)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out_path, features=X, labels=y, label_name=args.label,
              feature_names=FEATURE_NAMES, band=band)

    print(f"\nSaved {len(feature_rows)} windows ({args.label}) to {out_path}")
    print(f"  total packets: {n_packets}, dropped (per receiver seq tracking): {rx.dropped}")


if __name__ == "__main__":
    main()
