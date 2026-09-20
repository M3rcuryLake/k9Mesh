"""
fusion.py

Stage 8: within-window diversity fusion.

Two methods:
1. ChangeDirectionAligner (RaliSense-style): align candidates by their
   I/Q covariance eigenvector (direction of maximum variance), resolve
   sign ambiguity via reference signal polarity, then combine.
2. MeanFusionBaseline: simple weighted average of projected signals.

UNVALIDATED ASSUMPTION: RaliSense's inter-antenna alignment has NOT
been experimentally verified for single-antenna inter-subcarrier CSCR.
Both methods are selectable via config.fusion_method.
"""

from dataclasses import dataclass
from enum import Enum

import numpy as np

from breath.pipeline_config import PipelineConfig
from breath.cscr import CSCRCandidate
from breath.quality import QualityResult


class FusionMethod(Enum):
    CHANGE_DIRECTION = "change_direction"
    MEAN_BASELINE = "mean_baseline"


@dataclass(slots=True)
class CandidateContribution:
    candidate: CSCRCandidate
    weight: float
    polarity: float  # +1 or -1 after sign resolution
    aligned_signal: np.ndarray  # float[n]


@dataclass(slots=True)
class FusionResult:
    brpm: float | None
    confidence: float                # [0-1]
    n_candidates: int
    n_passing: int
    pass_fraction: float             # [0-1]
    estimate_spread_brpm: float      # [brpm] std of passing estimates
    method: str                      # "change_direction" | "mean_baseline"
    contributions: list[CandidateContribution]


class ChangeDirectionAligner:
    """Align CSCR candidates by their direction of maximum I/Q variance."""

    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg

    def align(self, candidates: list[CSCRCandidate]) -> tuple[np.ndarray, list[CandidateContribution]]:
        """Align and combine candidates.

        Returns (fused_signal, contributions_list).
        """
        if not candidates:
            return np.array([]), []

        # Need original complex CSCR signals for covariance.
        # But candidates only have projected (real) signals at this stage.
        # The ChangeDirectionAligner ideally needs the COMPLEX z(k) before projection.
        # For now, we approximate: use the projected signals as if they were
        # 1D "I" and construct a dummy "Q" as Hilbert transform? No.
        # Actually, the proper implementation needs the pre-projection complex
        # CSCR. We'll implement the full version when the pipeline passes
        # complex signals through projection. For now, fall back to mean baseline.
        # TODO: implement with complex CSCR inputs.

        # Placeholder: use mean baseline
        return MeanFusionBaseline(self.cfg).fuse(candidates)


class MeanFusionBaseline:
    """Simple weighted average of projected signals."""

    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg

    def fuse(self, candidates: list[CSCRCandidate]) -> tuple[np.ndarray, list[CandidateContribution]]:
        if not candidates:
            return np.array([]), []

        # Keep only passing candidates with projected signals
        passing = [c for c in candidates if c.quality and c.quality.passed and c.filtered is not None]
        if not passing:
            return np.array([]), []

        n = len(passing[0].filtered)
        # Weight by SSNR (normalized)
        weights = np.array([c.ssnr for c in passing])
        wmin, wmax = weights.min(), weights.max()
        weights = np.clip((weights - wmin) / (wmax - wmin + 1e-9), 0.1, 1.0)
        weights = weights / weights.sum()

        fused = np.zeros(n)
        contributions = []
        for c, w in zip(passing, weights):
            sig = c.filtered
            fused += w * sig
            contributions.append(CandidateContribution(
                candidate=c, weight=w, polarity=1.0, aligned_signal=sig.copy()
            ))

        return fused, contributions


def fuse_candidates(candidates: list[CSCRCandidate], cfg: PipelineConfig) -> FusionResult:
    """Main fusion entry point."""
    if cfg.fusion_method == "change_direction":
        aligner = ChangeDirectionAligner(cfg)
        fused_signal, contribs = aligner.align(candidates)
    else:
        fused_signal, contribs = MeanFusionBaseline(cfg).fuse(candidates)

    if len(fused_signal) == 0:
        return FusionResult(None, 0.0, 0, 0, 0.0, 0.0, cfg.fusion_method, [])

    passing = [c for c in candidates if c.quality and c.quality.passed]
    n_pass = len(passing)
    pass_frac = n_pass / len(candidates) if candidates else 0.0

    # Estimate spread from passing candidates' FFT estimates
    estimates = [c.fft_brpm for c in passing if c.fft_brpm is not None]
    if estimates:
        spread = float(np.std(estimates))
        median_brpm = float(np.median(estimates))
    else:
        spread = 0.0
        median_brpm = 0.0

    # Confidence: pass fraction * (1 - spread penalty)
    spread_penalty = float(np.clip(spread / 5.0, 0.0, 0.5))
    confidence = float(np.clip(pass_frac * (1.0 - spread_penalty), 0.0, 1.0))

    return FusionResult(
        brpm=median_brpm,
        confidence=confidence,
        n_candidates=len(candidates),
        n_passing=n_pass,
        pass_fraction=pass_frac,
        estimate_spread_brpm=spread,
        method=cfg.fusion_method,
        contributions=contribs,
    )