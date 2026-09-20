"""
quality.py

Stage 7: per-candidate quality gate.

Three components:
  A. In-band SNR score (energy concentration in respiration band)
  B. Estimator agreement (FFT vs BSSF)
  C. Spectral purity (peak concentration)
  D. Cycle-count penalty (strong reject if < 2-3 cycles)

Components retained for debugging; only candidates passing all gates
proceed to fusion.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional

import numpy as np

from breath.pipeline_config import PipelineConfig
from breath.cscr import CSCRCandidate
from breath.estimators import EstimatorResult, estimator_agreement


class RejectionReason(Enum):
    LARGE_GAP = "LARGE_GAP"
    INTERP_FRACTION_EXCEEDED = "INTERP_FRACTION_EXCEEDED"
    MOTION_SUBFRAMES = "MOTION_SUBFRAMES"
    NO_VALID_CANDIDATES = "NO_VALID_CANDIDATES"
    UNSTABLE_PAIRS = "UNSTABLE_PAIRS"
    TOO_FEW_CYCLES = "TOO_FEW_CYCLES"
    LOW_SNR = "LOW_SNR"
    ESTIMATOR_DISAGREEMENT = "ESTIMATOR_DISAGREEMENT"
    LOW_PURITY = "LOW_PURITY"
    QUALITY_BELOW_THRESHOLD = "QUALITY_BELOW_THRESHOLD"


@dataclass(slots=True)
class QualityResult:
    snr_score: float                 # [0-1] in-band vs out-of-band energy
    agreement_score: float           # [0-1] FFT vs BSSF agreement
    agreement_pass: bool
    spectral_purity: float           # [0-1] peak power / in-band power
    cycle_count: float               # [count] observed respiratory cycles
    cycle_count_score: float         # [0-1] penalty for few cycles
    total_quality: float             # [0-1] geometric mean or weighted
    passed: bool
    rejection_reason: Optional[RejectionReason] = None

    def to_dict(self) -> dict:
        return {
            "snr_score": round(self.snr_score, 3),
            "agreement_score": round(self.agreement_score, 3),
            "agreement_pass": self.agreement_pass,
            "spectral_purity": round(self.spectral_purity, 3),
            "cycle_count": round(self.cycle_count, 2),
            "cycle_count_score": round(self.cycle_count_score, 3),
            "total_quality": round(self.total_quality, 3),
            "passed": self.passed,
            "rejection_reason": self.rejection_reason.value if self.rejection_reason else None,
        }


class QualityGate:
    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg

    def evaluate(self, candidate: CSCRCandidate, fs: float) -> QualityResult:
        # --- A. In-band SNR score ---
        # Use the candidate's pre-computed SSNR (from CSCR bank)
        # Map SSNR in dB to [0,1]: 0 dB -> 0, 20 dB -> 1
        ssnr_db = candidate.ssnr
        snr_score = float(np.clip(ssnr_db / 20.0, 0.0, 1.0))

        # --- B. Estimator agreement ---
        fft_res = EstimatorResult(candidate.fft_brpm, 0.0, 0.0, np.array([]), True, {}) \
                  if candidate.fft_brpm is not None else None
        bssf_res = EstimatorResult(candidate.bssf_brpm, 0.0, 0.0, np.array([]), True, {}) \
                   if candidate.bssf_brpm is not None else None
        if fft_res and bssf_res:
            _, agreement_score, agreement_pass = estimator_agreement(fft_res, bssf_res, self.cfg)
        else:
            agreement_score, agreement_pass = 0.0, False

        # --- C. Spectral purity ---
        purity = self._spectral_purity(candidate.filtered, fs)

        # --- D. Cycle count ---
        if candidate.fft_brpm is not None:
            brpm = candidate.fft_brpm
        elif candidate.bssf_brpm is not None:
            brpm = candidate.bssf_brpm
        else:
            brpm = 0.0
        # Estimate window duration from filtered length
        window_s = len(candidate.filtered) / fs if candidate.filtered is not None else 0.0
        cycle_count = window_s * brpm / 60.0
        # Strong penalty if < min_cycles
        min_cyc = self.cfg.min_cycles
        if cycle_count >= min_cyc:
            cycle_score = 1.0
        elif cycle_count >= min_cyc / 2:
            cycle_score = 0.5
        else:
            cycle_score = 0.1

        # Total quality: geometric mean (one bad kills it)
        total = (snr_score * agreement_score * purity * cycle_score) ** 0.25

        # Determine pass/fail and reason
        passed = True
        reason = None
        if not agreement_pass:
            passed = False
            reason = RejectionReason.ESTIMATOR_DISAGREEMENT
        elif cycle_count < min_cyc:
            passed = False
            reason = RejectionReason.TOO_FEW_CYCLES
        elif snr_score < self.cfg.quality_snr_score_min:
            passed = False
            reason = RejectionReason.LOW_SNR
        elif purity < self.cfg.quality_purity_min:
            passed = False
            reason = RejectionReason.LOW_PURITY
        elif total < self.cfg.quality_min_total:
            passed = False
            reason = RejectionReason.QUALITY_BELOW_THRESHOLD

        return QualityResult(
            snr_score=snr_score,
            agreement_score=agreement_score,
            agreement_pass=agreement_pass,
            spectral_purity=purity,
            cycle_count=cycle_count,
            cycle_count_score=cycle_score,
            total_quality=total,
            passed=passed,
            rejection_reason=reason,
        )

    def _spectral_purity(self, x: np.ndarray, fs: float) -> float:
        """Peak power / total in-band power."""
        if x is None or len(x) < 4:
            return 0.0
        n = len(x)
        X = np.abs(np.fft.rfft(x))
        P = X ** 2
        f = np.fft.rfftfreq(n, 1.0/fs)
        in_band = (f >= self.cfg.gass_band_hz[0]) & (f <= self.cfg.gass_band_hz[1])
        if not in_band.any():
            return 0.0
        P_band = P[in_band]
        if P_band.sum() == 0:
            return 0.0
        return float(P_band.max() / P_band.sum())