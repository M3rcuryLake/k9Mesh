"""
Simplified NBVI (Narrowband Variance Index) subcarrier selection.

ESPectre's real NBVI evaluates several candidate strategies (Entropy Spaced,
MAD Clustered, Classic Spaced, Classic Clustered) - see ALGORITHMS.md for
the full description. This is NOT a bit-exact reimplementation of that; it's
a simplified single-strategy version (variance-based, spaced selection) that
gets you a reasonable auto-selected band without needing the full candidate
comparison. If NBVI-parity matters for your results, port the real
algorithm from micro-espectre/src/ instead of relying on this.

If this fails or looks wrong, main.py falls back to csi_dsp.DEFAULT_BAND,
matching upstream's documented fallback behavior.
"""

import statistics

from csi_dsp import valid_subcarrier_indices, GUARD_BAND_LOW, GUARD_BAND_HIGH


def select_band(baseline_amplitude_frames, k=12, min_spacing=2):
    """
    Pick k subcarriers from a baseline (idle) recording.

    Args:
        baseline_amplitude_frames: list of amplitude lists (one per packet),
            each length NUM_SUBCARRIERS, collected while the room was still.
        k: number of subcarriers to select (12, matching upstream default).
        min_spacing: minimum index distance enforced between picks, for
            spectral diversity (avoid picking 12 adjacent bins).

    Returns:
        sorted list of k subcarrier indices.
    """
    valid = valid_subcarrier_indices()
    n = len(baseline_amplitude_frames)
    if n < 10:
        raise ValueError("Need more baseline packets to run NBVI selection")

    # Per-subcarrier coefficient of variation across the baseline window -
    # lower CV = more stable = better candidate for motion sensing.
    scores = {}
    for idx in valid:
        try:
            values = [frame[idx] for frame in baseline_amplitude_frames if idx < len(frame)]
        except IndexError:
            continue
        if len(values) < 10:
            continue
        mean = statistics.fmean(values)
        std = statistics.pstdev(values)
        cv = std / mean if mean > 1e-6 else float("inf")
        scores[idx] = cv

    ranked = sorted(scores.items(), key=lambda kv: kv[1])

    selected = []
    for idx, _score in ranked:
        if all(abs(idx - s) >= min_spacing for s in selected):
            selected.append(idx)
        if len(selected) == k:
            break

    if len(selected) < k:
        # Not enough spectrally-diverse candidates; fill in with next-best
        # regardless of spacing rather than returning a short band.
        for idx, _score in ranked:
            if idx not in selected:
                selected.append(idx)
            if len(selected) == k:
                break

    return sorted(selected)
