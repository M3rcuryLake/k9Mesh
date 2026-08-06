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
from sklearn.model_selection import train_test_split
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

    feats, labels = [], []
    for p in paths:
        d = np.load(p, allow_pickle=True)
        feats.append(d["features"])
        labels.append(d["labels"])
        print(f"  {p}: {len(d['labels'])} windows, label={d['label_name']}")

    return np.concatenate(feats), np.concatenate(labels)


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
    X, y = load_dataset(args.data)
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

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=args.test_size, stratify=y, random_state=42
    )

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
