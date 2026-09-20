"""
estimators.py

Stage 6: dual respiration estimation per candidate.

Estimator A: FFT (frequency-domain peak search) -- ported from
the legacy detect_breath() with improvements.

Estimator B: BSSF (Box-Slope-Sum-Function) time-domain breath counting.
NOT an FFT wrapper -- operates on waveform shape to find breath onsets.

Agreement: |brpm_fft - brpm_bssf| vs configurable threshold.
"""

from dataclasses import dataclass

import numpy as np
from scipy.signal import find_peaks

from breath.pipeline_config import PipelineConfig


@dataclass(slots=True)
class EstimatorResult:
    brpm: float | None                  # [brpm] or None if failed
    peak_freq_hz: float                 # [Hz] FFT peak (FFT only)
    cycles: float                       # [count] window_s * brpm/60
    onset_times: np.ndarray             # [s] BSSF only
    valid: bool
    diagnostics: dict


class FFTEstimator:
    """FFT-based respiration rate estimator."""

    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg

    def estimate(self, x: np.ndarray, fs: float) -> EstimatorResult:
        n = len(x)
        if n < 4:
            return EstimatorResult(None, 0.0, 0.0, np.array([]), False, {})

        # Window and FFT
        win = np.hanning(n)
        X = np.fft.rfft(x * win)
        P = np.abs(X) ** 2
        f = np.fft.rfftfreq(n, 1.0/fs)

        # Search band
        f_lo, f_hi = self.cfg.estimator_band_hz
        in_band = (f >= f_lo) & (f <= f_hi)
        if not in_band.any():
            return EstimatorResult(None, 0.0, 0.0, np.array([]), False, {"reason": "empty_band"})

        f_band = f[in_band]
        P_band = P[in_band]

        # Peak
        peak_idx = int(np.argmax(P_band))
        peak_f = float(f_band[peak_idx])
        peak_power = float(P_band[peak_idx])

        # Local noise floor (exclude peak ±guard)
        guard = self.cfg.fft_guard_bins
        noise_bins = self.cfg.fft_noise_bins
        global_peak_idx = int(np.argmin(np.abs(f - peak_f)))
        lo = max(0, global_peak_idx - noise_bins)
        hi = min(len(P), global_peak_idx + noise_bins + 1)
        noise_region = P[lo:hi].copy()
        pk_local = global_peak_idx - lo
        nl = max(0, pk_local - guard)
        nh = min(len(noise_region), pk_local + guard + 1)
        noise_region[nl:nh] = np.nan
        noise_power = float(np.nanmedian(noise_region)) + 1e-12

        snr = peak_power / noise_power
        snr_db = 10.0 * np.log10(snr)

        # SNR gate
        if snr_db < self.cfg.fft_snr_min_db:
            return EstimatorResult(None, peak_f, 0.0, np.array([]), False,
                                   {"snr_db": snr_db, "reason": "snr_gate"})

        brpm = peak_f * 60.0
        cycles = (f_hi + f_lo) / 2 * 60.0  # rough

        return EstimatorResult(brpm, peak_f, brpm * n / fs / 60.0, np.array([]),
                               True, {"snr_db": snr_db, "peak_power": peak_power})


class BSSFEstimator:
    """Time-domain breath-onset estimator (Box-Slope-Sum-Function concept).

    Steps:
    1. Compute slope/derivative of filtered signal
    2. Moving-window sum of squared slope energy
    3. Find ALL peaks in slope energy (candidate breath onsets)
    4. Compute inter-onset intervals, filter to physiological range
    5. Rate = valid_cycles / window_duration * 60
    """

    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg

    def estimate(self, x: np.ndarray, fs: float) -> EstimatorResult:
        n = len(x)
        if n < fs * 5:  # need at least ~5s
            return EstimatorResult(None, 0.0, 0.0, np.array([]), False,
                                   {"reason": "too_short"})

        # 1. Slope (first difference, normalized by dt)
        dt = 1.0 / fs
        slope = np.diff(x) / dt  # length n-1

        # 2. Moving-window slope energy (sum of squared slope)
        win_len = int(round(0.5 * fs))  # 0.5s window
        if win_len < 3:
            win_len = 3
        if win_len % 2 == 0:
            win_len += 1
        slope2 = slope ** 2
        kernel = np.ones(win_len)
        slope_energy = np.convolve(slope2, kernel, mode='same')

        # 3. Find ALL prominent peaks in slope energy
        # Prominence threshold: at least 0.5 * std of slope_energy
        prom = np.std(slope_energy) * 0.5
        peaks, _ = find_peaks(slope_energy, prominence=prom)

        if len(peaks) < 2:
            return EstimatorResult(None, 0.0, 0.0, np.array([]), False,
                                   {"reason": "too_few_peaks", "n_peaks": len(peaks)})

        onset_times = peaks / fs

        # 4. Inter-onset intervals, filter to physiological bounds
        # BSSF detects zero-crossings (half-breaths), so intervals ~1/f.
        # Allow half-breath intervals: 1/(2*f_hi) to 1/f_lo
        intervals = np.diff(onset_times)
        f_lo, f_hi = self.cfg.physiological_band_hz
        t_lo = 1.0 / (f_hi * 2.0)  # half-breath min period (e.g. 33 brpm -> 0.9s)
        t_hi = 1.0 / f_lo          # full-breath max period (e.g. 6 brpm -> 10s)
        valid_intervals = intervals[(intervals >= t_lo) & (intervals <= t_hi)]

        if len(valid_intervals) < 2:
            return EstimatorResult(None, 0.0, float(len(intervals)), onset_times,
                                   False, {"reason": "too_few_valid_intervals",
                                           "n_intervals": len(intervals),
                                           "n_valid": len(valid_intervals)})

        # 5. Rate from valid intervals (median half-breath interval -> full brpm)
        avg_interval = float(np.median(valid_intervals))
        # If median interval corresponds to half-breaths, divide by 2
        # Heuristic: if rate > f_hi*1.5, assume half-breaths
        half_brpm = 60.0 / avg_interval
        if half_brpm > f_hi * 60 * 1.2:
            brpm = half_brpm / 2.0
        else:
            brpm = half_brpm

        # Final bounds check
        if not (f_lo * 60 <= brpm <= f_hi * 60):
            return EstimatorResult(None, 0.0, float(len(valid_intervals)), onset_times,
                                   False, {"reason": "out_of_bounds", "brpm": brpm})

        return EstimatorResult(brpm, 0.0, float(len(valid_intervals)), onset_times,
                               True, {"n_intervals": len(intervals),
                                      "n_valid": len(valid_intervals),
                                      "avg_interval_s": avg_interval})


def estimator_agreement(fft_res: EstimatorResult, bssf_res: EstimatorResult,
                        cfg: PipelineConfig) -> tuple[float | None, float | None, bool]:
    """Returns (abs_diff, score, pass) where score in [0,1]."""
    if fft_res.brpm is None or bssf_res.brpm is None:
        return None, 0.0, False
    diff = abs(fft_res.brpm - bssf_res.brpm)
    score = float(np.clip(1.0 - diff / cfg.estimator_agreement_threshold_brpm, 0.0, 1.0))
    passed = diff <= cfg.estimator_agreement_threshold_brpm
    return diff, score, passed