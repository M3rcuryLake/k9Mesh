"""
Train the ML motion detector from data collected with collect_data.py.

Usage:
    python train_model.py --data "data/*.npz" --out model.pkl

Uses hidden_layer_sizes=(32, 16), matching upstream ESPectre's documented
9 -> 32 -> 16 -> 1 architecture (sklearn's MLPClassifier infers the 9 input
units from your feature vectors and the 1 output unit from binary labels,
so you only specify the two hidden layers).
"""

import argparse
import glob
import pickle

import numpy as np
from sklearn.model_selection import GroupShuffleSplit
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, confusion_matrix


def load_dataset(patterns):
    paths = []
    for p in patterns:
        matched = glob.glob(p)
        paths.extend(matched if matched else [p])
    paths = sorted(set(paths))
    if not paths:
        raise SystemExit(f"No files matched: {patterns}")

    feats, labels, groups = [], [], []
    for p in paths:
        d = np.load(p, allow_pickle=True)
        file_features = d["features"]
        file_labels = d["labels"]
        if len(file_features) != len(file_labels):
            raise SystemExit(f"{p}: features and labels have different lengths")
        if file_features.ndim != 2 or file_features.shape[1] != 9:
            raise SystemExit(f"{p}: expected an N x 9 feature matrix")
        feats.append(file_features)
        labels.append(file_labels)
        # Windows in one capture overlap and share the same room/session
        # conditions. Keep each recording wholly in train or test.
        groups.append(np.full(len(file_labels), p, dtype=object))
        print(f"  {p}: {len(d['labels'])} windows, label={d['label_name']}")

    return np.concatenate(feats), np.concatenate(labels), np.concatenate(groups)


def grouped_split(X, y, groups, test_size):
    """Hold out complete recordings and require both classes on each side."""
    recordings_per_class = {
        label: len(set(groups[y == label])) for label in np.unique(y)
    }
    if len(recordings_per_class) < 2 or min(recordings_per_class.values()) < 2:
        raise SystemExit(
            "Need at least two independent recording files per class for a "
            "grouped train/test split. Collect more runs; splitting overlapping "
            "windows from the same run leaks session conditions into evaluation."
        )

    best = None
    for seed in range(100):
        splitter = GroupShuffleSplit(
            n_splits=1, test_size=test_size, random_state=seed
        )
        train_idx, test_idx = next(splitter.split(X, y, groups))
        if len(np.unique(y[train_idx])) < 2 or len(np.unique(y[test_idx])) < 2:
            continue
        distance = abs(len(test_idx) / len(y) - test_size)
        if best is None or distance < best[0]:
            best = (distance, train_idx, test_idx)

    if best is None:
        raise SystemExit(
            "Could not make a grouped split containing both classes in train "
            "and test. Add independent recordings for each class."
        )
    return best[1], best[2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="+", required=True,
                     help="npz file(s) or glob pattern(s), e.g. 'data/*.npz'")
    ap.add_argument("--out", default="model.pkl")
    ap.add_argument("--hidden", type=int, nargs="+", default=[32, 16],
                     help="hidden layer sizes, default matches upstream 32->16")
    ap.add_argument("--test-size", type=float, default=0.2)
    args = ap.parse_args()

    print("Loading dataset(s)...")
    X, y, groups = load_dataset(args.data)
    n_movement = int(y.sum())
    n_baseline = int((y == 0).sum())
    print(f"Total: {len(y)} windows ({n_movement} movement / {n_baseline} baseline)")

    if len(np.unique(y)) < 2:
        raise SystemExit(
            "Need BOTH baseline and movement data to train a classifier - "
            "collect_data.py both labels first."
        )
    if min(n_movement, n_baseline) < 20:
        print("WARNING: fewer than 20 windows in one class - model will "
              "likely be unreliable. Collect more data before trusting this.")

    train_idx, test_idx = grouped_split(X, y, groups, args.test_size)
    X_train, X_test = X[train_idx], X[test_idx]
    y_train, y_test = y[train_idx], y[test_idx]
    print(f"Grouped split: {len(set(groups[train_idx]))} train recordings, "
          f"{len(set(groups[test_idx]))} test recordings")

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
