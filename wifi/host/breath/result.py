"""
result.py

Stage 10: final result contract with backward-compatible JSON.

Top-level `breath` object in telemetry keeps legacy fields:
  - rate_bpm (number|null)
  - snr (number|null)
  - confidence (0-100)

Additive new fields (all nullable) for diagnostics and UI.
"""

from dataclasses import dataclass, asdict
from enum import Enum
from typing import Optional, Any

import json
import numpy as np


class BreathingStatus(Enum):
    BREATHING_DETECTED = "breathing_detected"
    NO_BREATHING_DETECTED = "no_breathing_detected"
    INSUFFICIENT_SIGNAL = "insufficient_signal"
    INSUFFICIENT_DATA = "insufficient_data"
    MOTION_REJECTED = "motion_rejected"
    DROPOUT_REJECTED = "dropout_rejected"


class RejectionReason(Enum):
    LARGE_GAP = "large_gap"
    INTERP_FRACTION_EXCEEDED = "interp_fraction_exceeded"
    MOTION_SUBFRAMES = "motion_subframes"
    NO_VALID_CANDIDATES = "no_valid_candidates"
    UNSTABLE_PAIRS = "unstable_pairs"
    TOO_FEW_CYCLES = "too_few_cycles"
    LOW_SNR = "low_snr"
    ESTIMATOR_DISAGREEMENT = "estimator_disagreement"
    LOW_PURITY = "low_purity"
    QUALITY_BELOW_THRESHOLD = "quality_below_threshold"


@dataclass
class RespirationResult:
    # --- Legacy fields (EXACT semantics as before) ---
    rate_bpm: Optional[float] = None          # None if no estimate; frontend shows '—'
    snr: Optional[float] = None               # SNR in dB
    confidence: float = 0.0                   # 0-100 scale (frontend alarm at >50)

    # --- Additive diagnostics (nullable) ---
    status: Optional[str] = None              # BreathingStatus value
    rejection_reason: Optional[str] = None    # RejectionReason value
    usable_window_s: Optional[float] = None
    observed_cycles: Optional[float] = None
    fft_estimate_brpm: Optional[float] = None
    bssf_estimate_brpm: Optional[float] = None
    estimator_agreement: Optional[float] = None
    n_candidates: Optional[int] = None
    n_passing: Optional[int] = None
    pass_fraction: Optional[float] = None
    estimate_spread_brpm: Optional[float] = None
    fusion_method: Optional[str] = None
    regime_flag: Optional[str] = None
    temporal: Optional[dict] = None
    quality: Optional[dict] = None
    confidence_components: Optional[dict] = None

    def to_json(self) -> str:
        """Serialize to JSON with legacy fields at top level."""
        d = {}
        # Legacy fields first (for backward compatibility)
        d["rate_bpm"] = round(self.rate_bpm, 1) if self.rate_bpm is not None else None
        d["snr"] = round(self.snr, 1) if self.snr is not None else None
        d["confidence"] = round(self.confidence, 1)

        # Additive fields - convert enums to strings
        if self.status is not None:
            d["status"] = self.status.value if hasattr(self.status, 'value') else self.status
        if self.rejection_reason is not None:
            d["rejection_reason"] = self.rejection_reason.value if hasattr(self.rejection_reason, 'value') else self.rejection_reason
        if self.usable_window_s is not None:
            d["usable_window_s"] = round(self.usable_window_s, 1)
        if self.observed_cycles is not None:
            d["observed_cycles"] = round(self.observed_cycles, 1)
        if self.fft_estimate_brpm is not None:
            d["fft_estimate_brpm"] = round(self.fft_estimate_brpm, 1)
        if self.bssf_estimate_brpm is not None:
            d["bssf_estimate_brpm"] = round(self.bssf_estimate_brpm, 1)
        if self.estimator_agreement is not None:
            d["estimator_agreement"] = round(self.estimator_agreement, 1)
        if self.n_candidates is not None:
            d["n_candidates"] = self.n_candidates
        if self.n_passing is not None:
            d["n_passing"] = self.n_passing
        if self.pass_fraction is not None:
            d["pass_fraction"] = round(self.pass_fraction, 2)
        if self.estimate_spread_brpm is not None:
            d["estimate_spread_brpm"] = round(self.estimate_spread_brpm, 1)
        if self.fusion_method is not None:
            d["fusion_method"] = self.fusion_method
        if self.regime_flag is not None:
            d["regime_flag"] = self.regime_flag
        if self.temporal is not None:
            d["temporal"] = self.temporal
        if self.quality is not None:
            d["quality"] = self.quality
        if self.confidence_components is not None:
            d["confidence_components"] = self.confidence_components

        # Compact JSON
        return json.dumps(d, separators=(",", ":"), allow_nan=False)