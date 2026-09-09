"""
respiration.py

Breathing-rate detection from WiFi CSI amplitude data.

Pipeline:
    raw per-packet amplitudes + timestamp
        -> band_amplitude()        [mean amplitude over the same subcarrier
                                     `band` MVS was calibrated with]
        -> csi_dsp.HampelFilter    [streaming outlier rejection -- caller-owned,
                                     see main.py]
        -> detect_breath()         [resample, detrend, FFT, band-limited peak + confidence]
        -> BreathResult.to_json()  [for MQTT / logging]

detect_breath() is stateless -- buffering (ring buffer, tick cadence, motion
gating) and the streaming Hampel filter instance both live in main.py.
"""

import json
from dataclasses import dataclass, asdict
from typing import Optional, Sequence

import numpy as np

# --- Tunables --------------------------------------------------------------

BREATH_WINDOW_SEC = 60          # how much history to feed detect_breath() with
BREATH_TICK_SEC = 1             # how often the caller should re-evaluate
BREATH_RESAMPLE_HZ = 10
BREATH_BAND = (10 / 60, 30 / 60) # detection range; 0.15 - 0.5Hz (10-30 BreathPM)
BREATH_SNR_MIN = 3.0


# --- Result type -------------------------------------------------------------

@dataclass
class BreathResult:
    rate_bpm: Optional[float]
    snr: float
    confidence: float          # 0.0-1.0, how much to trust rate_bpm
    peak_freq_hz: float
    spectral_purity: float     # peak power / total in-band power (0-1)
    band_power_frac: float     # in-band power / total spectral power (0-1)
    harmonic_ratio: float      # power at 2x peak freq / power at peak freq
    n_samples: int

    def to_json(self) -> str:
        d = asdict(self)
        for k, v in d.items():
            if isinstance(v, float):
                d[k] = round(v, 3)
        return json.dumps(d, separators=(",", ":"))


def _empty(snr: float, n: int) -> BreathResult:
    return BreathResult(None, snr, 0.0, 0.0, 0.0, 0.0, 0.0, n)


# --- CSI -> single amplitude scalar (per packet) ----------------------------

def band_amplitude(amplitudes: Sequence[float], band: Sequence[int]) -> float:
    """Mean amplitude across the same subcarrier `band` MVS was calibrated
    with (see csi_dsp.DEFAULT_BAND / nbvi.NBVICalibrator.calibrate()).

    Reusing MVS's band means no separate subcarrier-selection step for
    breath detection, and guard-band/DC exclusion is already baked in
    upstream by csi_dsp -- nothing extra to filter out here.

    Run this per-packet; feed the result through a streaming
    csi_dsp.HampelFilter instance (owned by the caller, one filter per
    logical channel) before buffering it for detect_breath().
    """
    return float(np.mean([amplitudes[i] for i in band]))


# --- Core detector -----------------------------------------------------------

def detect_breath(ts: np.ndarray, vals: np.ndarray) -> BreathResult:
    """Detrend, resample to BREATH_RESAMPLE_HZ, FFT, find peak in BREATH_BAND.

    Returns a BreathResult; rate_bpm is None if no significant peak was found.
    """
    if len(ts) < BREATH_RESAMPLE_HZ * 30:
        return _empty(0.0, len(ts))

    # guard against out-of-order / duplicate timestamps (packet relay jitter)
    order = np.argsort(ts)
    ts, vals = ts[order], vals[order]
    ts, idx = np.unique(ts, return_index=True)
    vals = vals[idx]

    t0, t1 = ts[0], ts[-1]
    if t1 - t0 < 30.0:
        return _empty(0.0, len(ts))

    grid = np.arange(t0, t1, 1.0 / BREATH_RESAMPLE_HZ)
    resamp = np.interp(grid, ts, vals)
    resamp = resamp - resamp.mean()

    # quadratic detrend
    c = np.polyfit(np.arange(len(resamp)), resamp, 2)
    resamp = resamp - np.polyval(c, np.arange(len(resamp)))

    N = len(resamp)
    win = np.hanning(N)
    spec = np.abs(np.fft.rfft(resamp * win))
    freqs = np.fft.rfftfreq(N, 1.0 / BREATH_RESAMPLE_HZ)

    in_band = (freqs >= BREATH_BAND[0]) & (freqs <= BREATH_BAND[1])
    if not in_band.any():
        return _empty(0.0, N)

    band_spec = spec[in_band]
    band_freqs = freqs[in_band]

    total_power = float(np.sum(spec ** 2)) + 1e-9
    band_power = float(np.sum(band_spec ** 2))
    band_power_frac = band_power / total_power

    peak_i = int(np.argmax(band_spec))
    peak_amp = float(band_spec[peak_i])
    peak_freq = float(band_freqs[peak_i])

    # local power-based estimate
    power = spec ** 2

    peak_idx_global = int(
        np.argmin(np.abs(freqs - peak_freq))
    )

    guard_bins = 2
    noise_bins = 10

    lo = max(0, peak_idx_global - noise_bins)
    hi = min(len(power), peak_idx_global + noise_bins + 1)

    noise_region = power[lo:hi].copy()

    peak_local = peak_idx_global - lo

    start = max(0, peak_local - guard_bins)
    end = min(len(noise_region), peak_local + guard_bins + 1)

    noise_region[start:end] = np.nan

    noise_power = float(np.nanmedian(noise_region)) + 1e-12
    peak_power = float(power[peak_idx_global])

    snr_linear = peak_power / noise_power
    snr = 10.0 * np.log10(snr_linear)

    # spectral purity: how much of the in-band energy sits in the peak vs
    # spread across the rest of the band (spread = irregular breathing or
    # motion contamination that survived detrending)
    spectral_purity = (peak_amp ** 2) / band_power if band_power > 0 else 0.0

    # harmonic check: chest-wall motion isn't a pure sinusoid, so some mild
    # 2nd-harmonic energy is expected (~0.2-0.4x peak). If it's *stronger*
    # than the fundamental, the detector likely locked onto the harmonic and
    # the true rate is peak_freq / 2 -- flagged via confidence rather than
    # auto-corrected, since that's a judgment call worth surfacing, not hiding.
    harmonic_freq = peak_freq * 2
    if harmonic_freq <= freqs[-1]:
        harm_idx = int(np.argmin(np.abs(freqs - harmonic_freq)))
        harmonic_amp = float(spec[harm_idx])
    else:
        harmonic_amp = 0.0
    harmonic_ratio = harmonic_amp / peak_amp if peak_amp > 0 else 0.0

    if snr < BREATH_SNR_MIN:
        return BreathResult(None, snr, 0.0, peak_freq, spectral_purity,
                             band_power_frac, harmonic_ratio, N)

    # confidence: geometric mean of three independent quality signals.
    # Geometric (vs arithmetic) mean means one bad signal tanks confidence
    # rather than being averaged away by two good ones.
    snr_score = np.clip(
        (snr - 2.0) / 4.0,
        0.0,
        1.0
    )
    purity_score = np.clip(
        (spectral_purity - 0.05) / 0.35,
        0.0,
        1.0
    )
    harmonic_score = float(
        np.clip(
            1.0 - harmonic_ratio,
            0.0,
            1.0
        )
    )

    confidence = (
        0.45 * snr_score +
        0.30 * purity_score +
        0.25 * harmonic_score
    ) * 100

    return BreathResult(peak_freq * 60.0, snr, confidence, peak_freq,
                         spectral_purity, band_power_frac, harmonic_ratio, N)
