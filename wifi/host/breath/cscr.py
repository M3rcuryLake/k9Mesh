"""
cscr.py

Stage 4: Single-antenna CSCR (CSI Complex Subcarrier Ratio) candidate bank.

For a single antenna, the diversity is across subcarriers. CSCR pairs
two subcarriers and takes their complex ratio:

    CSCR(m1, m2, k) = H_dyn(m1, k) / H_dyn(m2, k)

The ratio cancels common hardware phase corruption (approximately
linear in physical subcarrier index).

Implementation requirements:
- complex division with denominator floor (exclude unstable pairs)
- retain amplitude and phase
- physical subcarrier indices (not array positions) for pair metadata
- candidate cap via SSNR pre-ranking
"""

from dataclasses import dataclass, field

import numpy as np

from breath.pipeline_config import PipelineConfig
from breath.static_removal import StaticRemovalResult
from breath.estimators import EstimatorResult


@dataclass(slots=True)
class CSCRCandidate:
    num_idx: int                    # array index of numerator
    den_idx: int                    # array index of denominator
    physical_pair: tuple[int, int]  # physical subcarrier numbers
    z: np.ndarray                   # complex128[n] time series (H1/H2)
    ssnr: float                     # [dB] in-band / out-of-band energy
    stable: bool                    # denominator magnitude > floor
    weight: float = 1.0
    # Filled downstream:
    projected: np.ndarray | None = None      # float[n] after projection
    filtered: np.ndarray | None = None       # float[n] after filter chain
    fft_brpm: float | None = None
    bssf_brpm: float | None = None
    agreement_brpm: float | None = None
    agreement_score: float | None = None
    agreement_pass: bool | None = None
    quality: 'QualityResult | None' = None
    projected_angle_deg: float | None = None
    fft_res: 'EstimatorResult | None' = None
    bssf_res: 'EstimatorResult | None' = None


@dataclass(slots=True)
class CSCRBank:
    candidates: list[CSCRCandidate]
    cfg: PipelineConfig
    fs_hz: float = 0.0

    @classmethod
    def build(cls, static_res: StaticRemovalResult, cfg: PipelineConfig, physical_index: np.ndarray, fs_hz: float = 0.0) -> 'CSCRBank':
        """Build candidate bank from dynamically cleaned CSI."""
        H_dyn = static_res.H_dyn
        valid = window_valid_mask(H_dyn)
        active = np.nonzero(valid)[0]

        if len(active) < 2:
            return cls(candidates=[], cfg=cfg, fs_hz=fs_hz)

        # Denominator floor
        mag = np.abs(H_dyn)
        denom_floor = cfg.cscr_denominator_floor_frac * np.median(mag[valid])

        # Generate pairs with stride
        stride = cfg.cscr_pair_stride
        pairs = []
        for i, m1 in enumerate(active):
            for m2 in active[i+1::stride]:
                pairs.append((m1, m2))

        candidates = []
        for m1, m2 in pairs:
            denom = H_dyn[m2]
            num = H_dyn[m1]
            denom_mag = np.abs(denom)
            stable = bool(np.all(denom_mag > denom_floor))
            if not stable:
                continue
            with np.errstate(divide='ignore', invalid='ignore'):
                z = (num / denom).astype(np.complex128)

            ssnr = compute_ssnr(z, fs_hz, cfg)
            candidates.append(CSCRCandidate(
                num_idx=m1,
                den_idx=m2,
                physical_pair=(physical_index[m1], physical_index[m2]),
                z=z,
                ssnr=ssnr,
                stable=stable,
            ))

        # Pre-rank by SSNR, keep top-K
        candidates.sort(key=lambda c: c.ssnr, reverse=True)
        candidates = candidates[:cfg.cscr_max_candidates]

        return cls(candidates=candidates, cfg=cfg, fs_hz=fs_hz)


def window_valid_mask(H: np.ndarray) -> np.ndarray:
    """Valid bins: not guard/DC, magnitude > 0."""
    mask = np.ones(H.shape[0], dtype=bool)
    mask[:11] = False
    mask[52:] = False
    mask[32] = False
    mask &= np.abs(H).mean(axis=1) > 1e-9
    return mask


def compute_ssnr(z: np.ndarray, fs: float, cfg: PipelineConfig) -> float:
    """SSNR = in-band power / out-of-band power.

    In-band: gass_band_hz (default 0.167-0.5 Hz)
    Out-of-band: gass_out_of_band_hz (default >0.5 Hz)
    """
    n = len(z)
    if n < 4:
        return -100.0
    # z is complex: use full fft, keep positive frequencies
    Z = np.abs(np.fft.fft(z))
    P = Z ** 2
    f = np.fft.fftfreq(n, 1.0/fs)
    # Positive frequencies only
    pos = f >= 0
    f = f[pos]
    P = P[pos]

    in_band = (f >= cfg.gass_band_hz[0]) & (f <= cfg.gass_band_hz[1])
    out_band = (f > cfg.gass_out_of_band_hz[0]) & (f <= fs/2)

    in_power = float(P[in_band].sum()) if in_band.any() else 1e-12
    out_power = float(P[out_band].sum()) if out_band.any() else 1e-12

    if out_power <= 0:
        return 100.0
    return 10.0 * np.log10(in_power / out_power + 1e-12)