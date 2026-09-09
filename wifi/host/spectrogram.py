"""
CSI spectrogram — raw per-subcarrier amplitude extraction, mapped to RGB.

Step 1: pull the 12 calibrated subcarrier amplitudes from each CSI packet.
Step 2: normalize per-row (min-max across the 12 values) and map each to
an RGB triplet via a heatmap gradient (dark blue -> cyan -> green ->
yellow -> red), matching the reference spectrogram's color style.

No FFT, no filtering, no time-windowing yet — this is still just a
per-packet transform.
"""


# Heatmap color stops (t, (r, g, b)), t in [0, 1]. Matches a
# blue -> cyan -> green -> yellow -> red gradient.
_COLOR_STOPS = [
    (0.00, (0, 0, 60)),      # near-black blue (low signal)
    (0.25, (0, 80, 200)),    # blue
    (0.45, (0, 200, 200)),   # cyan
    (0.60, (0, 220, 80)),    # green
    (0.80, (255, 220, 0)),   # yellow
    (1.00, (255, 30, 0)),    # red (high signal)
]


def _lerp(a, b, t):
    return a + (b - a) * t


def _colormap(t: float) -> list[int]:
    """Map a normalized value t in [0,1] to an [r, g, b] triplet via the
    heatmap gradient above, linearly interpolating between stops."""
    t = max(0.0, min(1.0, t))
    for (t0, c0), (t1, c1) in zip(_COLOR_STOPS, _COLOR_STOPS[1:]):
        if t0 <= t <= t1:
            span = (t1 - t0) or 1e-9
            local_t = (t - t0) / span
            return [
                int(round(_lerp(c0[i], c1[i], local_t)))
                for i in range(3)
            ]
    return list(_COLOR_STOPS[-1][1])  # fallback, shouldn't hit


class SpectrogramProcessor:
    """
    Extracts raw amplitude values for the calibrated band from each CSI
    packet, normalizes them relative to each other (min-max within the
    row), and maps each to an RGB color.
    """

    def __init__(self):
        pass

    def push(self, packet_amplitudes: list[float], band: list[int]) -> list[list[int]]:
        """
        Args:
            packet_amplitudes: Full 64-subcarrier amplitude array from receiver.
            band: Current calibrated band indices (12 subcarriers).

        Returns:
            List of [r, g, b] int triplets (0-255), one per band subcarrier,
            in band order. Length == len(band) (12).
        """
        raw = [packet_amplitudes[i] for i in band]

        lo, hi = min(raw), max(raw)
        span = (hi - lo) or 1e-9  # avoid div-by-zero if all 12 are equal

        return [_colormap((v - lo) / span) for v in raw]
