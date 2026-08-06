"""
9-feature vector for the ML detector, computed over a sliding window of
per-packet turbulence values (same Normalize -> Hampel -> Low-Pass chain
the MVS detector uses, per ALGORITHMS.md's shared filter pipeline).

Per upstream: "CV normalization is always disabled for ML (raw std only)"
and ML mode uses a *fixed* subcarrier band (csi_dsp.DEFAULT_BAND), not the
NBVI-selected one.

I don't have the exact upstream feature list (their docs mention "9
turbulence-window features, including robust spread" but not the full
enumeration), so this is my best reconstruction, not a guaranteed match
to any of their pretrained weights. Bottom line: you WILL need to train
your own model on your own collected data with train_model.py - don't
expect to load an upstream ESPectre .pkl/.h5 into this and have it work.

Feature order (also used as column order in training data):
    0. mean            - mean turbulence over the window
    1. std              - std of turbulence
    2. mad              - median absolute deviation (robust spread)
    3. iqr               - interquartile range
    4. ptp               - peak-to-peak (max - min)
    5. mean_abs_diff  - mean |first difference| (how fast it's changing)
    6. skew             - skewness
    7. kurtosis        - excess kurtosis
    8. zcr                - zero-crossing rate around the window mean
"""

import math

FEATURE_NAMES = [
    "mean", "std", "mad", "iqr", "ptp",
    "mean_abs_diff", "skew", "kurtosis", "zcr",
]


def _percentile(sorted_values, pct):
    n = len(sorted_values)
    if n == 0:
        return 0.0
    k = (n - 1) * (pct / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_values[int(k)]
    return sorted_values[f] + (sorted_values[c] - sorted_values[f]) * (k - f)


def extract_features(turbulence_window):
    """
    Args:
        turbulence_window: list/deque of scalar turbulence values (already
            Hampel/low-pass filtered), length == window_size.

    Returns:
        list of 9 floats, order matches FEATURE_NAMES.
    """
    values = list(turbulence_window)
    n = len(values)
    if n < 2:
        return [0.0] * 9

    mean = sum(values) / n
    variance = sum((x - mean) ** 2 for x in values) / n
    std = math.sqrt(variance)

    sorted_vals = sorted(values)
    median = sorted_vals[n // 2]
    mad = sorted(abs(x - median) for x in values)[n // 2]

    q75 = _percentile(sorted_vals, 75)
    q25 = _percentile(sorted_vals, 25)
    iqr = q75 - q25

    ptp = sorted_vals[-1] - sorted_vals[0]

    diffs = [abs(values[i + 1] - values[i]) for i in range(n - 1)]
    mean_abs_diff = sum(diffs) / len(diffs) if diffs else 0.0

    denom3 = std ** 3 if std > 1e-9 else 1e-9
    skew = sum((x - mean) ** 3 for x in values) / n / denom3

    denom4 = std ** 4 if std > 1e-9 else 1e-9
    kurtosis = sum((x - mean) ** 4 for x in values) / n / denom4 - 3.0

    signs = [1 if (x - mean) >= 0 else -1 for x in values]
    crossings = sum(1 for i in range(n - 1) if signs[i] != signs[i + 1])
    zcr = crossings / (n - 1)

    return [mean, std, mad, iqr, ptp, mean_abs_diff, skew, kurtosis, zcr]
