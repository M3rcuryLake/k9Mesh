"""
CSI signal-conditioning primitives, matching Micro-ESPectre's algorithm
definitions (see espectre/micro-espectre/ALGORITHMS.md).

This module is intentionally dependency-light (stdlib `math`/`statistics`
only) so it's trivial to run on any laptop without a numpy/scipy setup,
though numpy would obviously speed it up if you're processing a lot of
packets per second.
"""

from collections import deque
import math
import statistics

# HT20 guard bands / DC (from ALGORITHMS.md)
GUARD_BAND_LOW = 11
GUARD_BAND_HIGH = 52
DC_SUBCARRIER = 32

# Default fixed band used before NBVI calibration has run, or as the
# ML detector's fixed band (matches Micro-ESPectre's ML default).
DEFAULT_BAND = [12, 14, 16, 18, 20, 24, 28, 36, 40, 44, 48, 52]


def valid_subcarrier_indices():
    """Subcarriers excluding guard bands and the DC bin."""
    return [
        i for i in range(GUARD_BAND_LOW, GUARD_BAND_HIGH)
        if i != DC_SUBCARRIER
    ]


def spatial_turbulence(amplitudes_band, gain_locked=True):
    """
    Scalar turbulence for one packet, computed over the selected band.

    gain_locked=True  -> raw std (better sensitivity, matches your
                          firmware since it keeps gain lock).
    gain_locked=False -> coefficient of variation (gain-invariant).
    """
    if len(amplitudes_band) < 2:
        return 0.0
    mean = statistics.fmean(amplitudes_band)
    std = statistics.pstdev(amplitudes_band)
    if gain_locked:
        return std
    return std / mean if mean != 0 else 0.0


class HampelFilter:
    """MAD-based outlier rejection on the scalar turbulence stream.
    Enabled-by-default in Micro-ESPectre: window=7, threshold=5.0 MAD."""

    def __init__(self, window=7, threshold=5.0):
        self.window = window
        self.threshold = threshold
        self.buffer = deque(maxlen=window)

    def filter(self, value):
        self.buffer.append(value)
        if len(self.buffer) < 3:
            return value

        sorted_buf = sorted(self.buffer)
        median = sorted_buf[len(sorted_buf) // 2]

        deviations = sorted(abs(x - median) for x in self.buffer)
        mad = deviations[len(deviations) // 2]

        scaled_mad = 1.4826 * mad * self.threshold
        if abs(value - median) > scaled_mad:
            return median
        return value


class LowPassFilter:
    """1st-order Butterworth IIR. Disabled by default in Micro-ESPectre;
    11 Hz cutoff preserves 0.5-10Hz human motion, removes RF noise >15Hz."""

    def __init__(self, cutoff_hz=11.0, sample_rate_hz=100.0):
        wc = math.tan(math.pi * cutoff_hz / sample_rate_hz)
        k = 1.0 + wc
        self.b0 = wc / k
        self.a1 = (wc - 1.0) / k
        self.x_prev = 0.0
        self.y_prev = 0.0

    def filter(self, x):
        y = self.b0 * x + self.b0 * self.x_prev - self.a1 * self.y_prev
        self.x_prev = x
        self.y_prev = y
        return y


def moving_variance(buffer):
    """Two-pass variance (numerically stable) over a turbulence buffer."""
    n = len(buffer)
    if n == 0:
        return 0.0
    mean = sum(buffer) / n
    return sum((x - mean) ** 2 for x in buffer) / n


def percentile(values, pct):
    """Simple percentile (0-100), sorted-list based. Good enough for
    calibration-time use; not optimized for hot-path calls."""
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * (pct / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] + (s[c] - s[f]) * (k - f)


def calculate_adaptive_threshold(mv_values, pct=95, factor=1.1):
    """P95 x 1.1 by default, matching Micro-ESPectre's 'auto' strategy."""
    return percentile(mv_values, pct) * factor
