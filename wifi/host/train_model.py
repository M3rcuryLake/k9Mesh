"""
Train the ML motion detector from data collected with collect_data.py
AND/OR raw .npz files pulled directly from the upstream ESPectre repo
(francescopace/espectre, micro-espectre/data or similar).

Two .npz formats are auto-detected per file:

  1. Your own format (from collect_data.py):
       features, labels, label_name, feature_names, band
     Used as-is.

  2. Upstream's raw format (confirmed via github.com/francescopace/espectre):
       csi_data (n_packets, n_bytes) int8, label (str), chip (str),
       gain_locked (bool), num_subcarriers, collected_at, duration_ms,
       format_version
     Raw CSI is re-extracted through YOUR OWN csi_dsp/ml_features pipeline
     (same math as collect_data.py) so the resulting feature vectors are
     apples-to-apples with your own recordings, rather than trusting
     upstream's separate Keras/TFLite training path (which this project
     intentionally does not use -- this project trains sklearn MLPClassifier
     to match ml_detector.py's model.predict_proba() loader).

     Files with gain_locked=False are skipped (not comparable to your
     gain-locked capture).

Usage:
    # your own data only
    python train_model.py --data "data/*.npz" --out model.pkl

    # mix your own recordings with upstream raw CSI data
    python train_model.py --data "data/*.npz" "espectre/micro-espectre/data/*.npz" --out model.pkl

    # only include specific upstream labels, remapped to your binary scheme
    python train_model.py --data "data/*.npz" "upstream/*.npz" \\
        --label-map baseline=baseline movement=movement walking=movement breathing=movement \\
        --out model.pkl

Uses hidden_layer_sizes=(32, 16), matching upstream ESPectre's documented
9 -> 32 -> 16 -> 1 architecture (sklearn's MLPClassifier infers the 9 input
units from your feature vectors and the 1 output unit from binary labels,
so you only specify the two hidden layers).
"""

import argparse
import glob
import pickle

import numpy as np
from sklearn.model_selection import train_test_split, GroupShuffleSplit
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, confusion_matrix

from csi_dsp import DEFAULT_BAND, HampelFilter, spatial_turbulence
from ml_features import extract_features, FEATURE_NAMES


def _csi_row_to_amplitudes(row_bytes):
    """Same math as receiver.extract_amplitudes(), one raw CSI packet row."""
    n_pairs = len(row_bytes) // 2
    amps = [0.0] * n_pairs
    for i in range(n_pairs):
        q = int(row_bytes[2 * i])
        im = int(row_bytes[2 * i + 1])
        amps[i] = (im * im + q * q) ** 0.5
    return amps


def _extract_features_from_raw_csi(csi_data, band, window_size, stride):
    """Re-run the collect_data.py feature pipeline over raw csi_data rows."""
    hampel = HampelFilter(window=7, threshold=5.0)
    turbulence_window = []
    feature_rows = []
    packets_since_window = 0

    for row in csi_data:
        amps = _csi_row_to_amplitudes(row)
        band_amps = [amps[i] for i in band if i < len(amps)]
        t = spatial_turbulence(band_amps, gain_locked=True)
        t = hampel.filter(t)

        turbulence_window.append(t)
        if len(turbulence_window) > window_size:
            turbulence_window.pop(0)

        packets_since_window += 1
        if len(turbulence_window) == window_size and packets_since_window >= stride:
            packets_since_window = 0
            feature_rows.append(extract_features(turbulence_window))

    return feature_rows


def load_dataset(patterns, label_map=None, band=None, window_size=100, stride=25):
    """
    Returns (X, y, groups) where groups[i] identifies which source file
    window i came from, for session-level (not window-level) splitting.
    """
    band = band or list(DEFAULT_BAND)
    label_map = label_map or {}

    paths = []
    for p in patterns:
        matched = glob.glob(p)
        paths.extend(matched if matched else [p])
    paths = sorted(set(paths))
    if not paths:
        raise SystemExit(f"No files matched: {patterns}")

    feats, labels, groups = [], [], []

    for group_id, p in enumerate(paths):
        d = np.load(p, allow_pickle=True)

        if "features" in d.files:
            # Your own collect_data.py format - use directly.
            X = d["features"]
            label_name = str(d["label_name"])
            if label_name not in ("baseline", "movement"):
                print(f"  SKIP {p} (unrecognized label_name={label_name!r})")
                continue
            y_val = 1 if label_name == "movement" else 0
            y = np.full(len(X), y_val, dtype=np.int64)
            feats.append(X)
            labels.append(y)
            groups.extend([group_id] * len(X))
            print(f"  {p}: {len(X)} windows (own format), label={label_name}")

        elif "csi_data" in d.files:
            # Upstream raw-CSI format - re-extract through our own pipeline.
            src_label = str(d["label"])
            mapped = label_map.get(src_label, src_label if src_label in ("baseline", "movement") else None)
            if mapped is None:
                print(f"  SKIP {p} (label={src_label!r} not in --label-map and not baseline/movement)")
                continue
            if "gain_locked" in d.files and not bool(d["gain_locked"]):
                print(f"  SKIP {p} (gain_locked=False, not comparable to gain-locked capture)")
                continue

            rows = _extract_features_from_raw_csi(d["csi_data"], band, window_size, stride)
            if not rows:
                print(f"  SKIP {p} (not enough packets for a full window: "
                      f"{len(d['csi_data'])} packets, need {window_size})")
                continue

            X = np.array(rows, dtype=np.float32)
            y_val = 1 if mapped == "movement" else 0
            y = np.full(len(X), y_val, dtype=np.int64)
            feats.append(X)
            labels.append(y)
            groups.extend([group_id] * len(X))
            chip = str(d["chip"]) if "chip" in d.files else "?"
            print(f"  {p}: {len(X)} windows (upstream raw, chip={chip}) "
                  f"label={src_label!r}->{mapped!r}")

        else:
            print(f"  SKIP {p} (unrecognized .npz format: keys={d.files})")
            continue

    if not feats:
        raise SystemExit("No usable data loaded - check labels/gain_locked/format above.")

    return np.concatenate(feats), np.concatenate(labels), np.array(groups)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="+", required=True,
                     help="npz file(s) or glob pattern(s); accepts your own "
                          "collect_data.py format and upstream raw csi_data format, mixed")
    ap.add_argument("--out", default="model.pkl")
    ap.add_argument("--hidden", type=int, nargs="+", default=[32, 16],
                     help="hidden layer sizes, default matches upstream 32->16")
    ap.add_argument("--test-size", type=float, default=0.2)
    ap.add_argument("--label-map", nargs="*", default=[],
                     help="src=dst pairs for upstream raw files with non-standard "
                          "label strings, e.g. walking=movement breathing=movement")
    ap.add_argument("--band", type=int, nargs="+", default=None,
                     help="subcarrier band used when re-extracting upstream raw "
                          "CSI files, default = DEFAULT_BAND (must match your own "
                          "collect_data.py band for the two sources to be comparable)")
    ap.add_argument("--window-size", type=int, default=100,
                     help="must match collect_data.py's --window-size for consistency")
    ap.add_argument("--stride", type=int, default=25)
    ap.add_argument("--no-group-split", action="store_true",
                     help="fall back to plain random window-level split instead of "
                          "session-level (grouped by source file) split. Not "
                          "recommended: overlapping windows from the same run will "
                          "leak between train/test and inflate reported accuracy.")
    args = ap.parse_args()

    label_map = dict(kv.split("=", 1) for kv in args.label_map)

    print("Loading dataset(s)...")
    X, y, groups = load_dataset(
        args.data, label_map=label_map, band=args.band,
        window_size=args.window_size, stride=args.stride,
    )
    n_movement = int(y.sum())
    n_baseline = int((y == 0).sum())
    n_sessions = len(set(groups.tolist()))
    print(f"Total: {len(y)} windows from {n_sessions} source files "
          f"({n_movement} movement / {n_baseline} baseline)")

    if len(np.unique(y)) < 2:
        raise SystemExit(
            "Need BOTH baseline and movement data to train a classifier."
        )
    if min(n_movement, n_baseline) < 20:
        print("WARNING: fewer than 20 windows in one class - model will "
              "likely be unreliable. Collect more data before trusting this.")

    if args.no_group_split:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=args.test_size, stratify=y, random_state=42
        )
    else:
        # Session-level split: entire source files go to train OR test, never
        # both, so overlapping windows from one run don't leak across the split.
        gss = GroupShuffleSplit(n_splits=1, test_size=args.test_size, random_state=42)
        train_idx, test_idx = next(gss.split(X, y, groups))
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]
        print(f"Session-level split: {len(set(groups[train_idx].tolist()))} files train, "
              f"{len(set(groups[test_idx].tolist()))} files test")

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    model = MLPClassifier(
        hidden_layer_sizes=tuple(args.hidden),
        activation="relu",
        max_iter=2000,
        random_state=42,
        early_stopping=True,
    )
    model.fit(X_train_s, y_train)

    y_pred = model.predict(X_test_s)
    print("\nClassification report:")
    print(classification_report(y_test, y_pred, target_names=["baseline", "movement"]))
    print("Confusion matrix (rows=true, cols=predicted):")
    print(confusion_matrix(y_test, y_pred))

    with open(args.out, "wb") as f:
        pickle.dump({"model": model, "scaler": scaler}, f)
    print(f"\nSaved model to {args.out}")


if __name__ == "__main__":
    main()
