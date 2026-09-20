"""
filters.py

Stage 5b: filtering chain -- Hampel (batch), Savitzky-Golay, physiological bandpass.

All filters are fs-aware: window lengths and cutoffs are computed from the
actual sample rate (measured at runtime, typically 20-50 Hz on current
firmware, not the spec's 100-120 Hz target).

Scipy is a declared dependency (wifi/requirements.txt).
"""

from dataclasses import dataclass

import numpy as np
from scipy.signal import savgol_filter, butter, filtfilt

from breath.pipeline_config import PipelineConfig


@dataclass(slots=True)
class FilterChainResult:
    filtered: np.ndarray        # float[n]
    fs_hz: float


class HampelFilter:
    """Batch Hampel filter (MAD-based outlier rejection) for a 1D signal."""

    def __init__(self, window: int = 7, threshold: float = 5.0):
        self.window = window
        self.threshold = threshold

    def filter(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=float)
        n = len(x)
        if n < self.window:
            return x
        half = self.window // 2
        out = x.copy()
        for i in range(n):
            lo = max(0, i - half)
            hi = min(n, i + half + 1)
            window_vals = x[lo:hi]
            median = np.median(window_vals)
            mad = np.median(np.abs(window_vals - median))
            scaled_mad = 1.4826 * mad * self.threshold
            if abs(x[i] - median) > scaled_mad:
                out[i] = median
        return out


class FilterChain:
    """Hampel -> Savitzky-Golay -> zero-phase bandpass."""

    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg
        self.hampel = HampelFilter(cfg.hampel_window, cfg.hampel_threshold)

    def _sg_params(self, n: int, fs: float) -> tuple[int, int]:
        """Compute legal Savitzky-Golay params for current n and fs."""
        win_s = self.cfg.sg_window_s
        win = int(round(win_s * fs))
        if win % 2 == 0:
            win += 1
        win = max(3, min(win, n - (n % 2 == 0)))
        poly = self.cfg.sg_poly_order
        if poly >= win:
            poly = win - 1
        if poly < 1:
            poly = 1
        return win, poly

    def _bandpass_params(self, fs: float) -> tuple:
        """Butterworth bandpass design."""
        nyq = fs / 2
        low = self.cfg.physiological_band_hz[0] / nyq
        high = self.cfg.physiological_band_hz[1] / nyq
        # Clamp to valid range
        low = max(1e-4, min(low, 0.99))
        high = max(low + 1e-4, min(high, 0.99))
        b, a = butter(self.cfg.bandpass_order, [low, high], btype='bandpass')
        return b, a

    def process(self, x: np.ndarray, fs: float) -> FilterChainResult:
        x = np.asarray(x, dtype=float)

        # 1. Hampel (impulse rejection)
        x = self.hampel.filter(x)

        # 2. Savitzky-Golay (shape-preserving smoothing)
        win, poly = self._sg_params(len(x), fs)
        if len(x) > win:
            x = savgol_filter(x, window_length=win, polyorder=poly)

        # 3. Zero-phase physiological bandpass (needs enough samples for filtfilt)
        b, a = self._bandpass_params(fs)
        min_len = 3 * len(b)  # filtfilt default padlen = 3 * ntaps
        if len(x) > min_len:
            x = filtfilt(b, a, x)
        # else: skip bandpass for very short signals

        return FilterChainResult(filtered=x, fs_hz=fs)