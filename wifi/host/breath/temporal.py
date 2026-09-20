"""
temporal.py

Stage 9: temporal fusion across windows.

Kalman-style scalar tracker (state = brpm, variance = brpm^2).
Consumes ONLY FusionResult; rejected/missing windows propagate
prediction with variance growth.
"""

from dataclasses import dataclass

import numpy as np

from breath.pipeline_config import PipelineConfig
from breath.fusion import FusionResult


@dataclass(slots=True)
class TemporalState:
    brpm: float          # current rate estimate
    var: float           # variance [brpm^2]
    n_accepted: int      # consecutive accepted measurements
    status: str          # "initializing" | "tracking" | "lost"


class TemporalFusion:
    """Kalman filter for respiration rate."""

    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg
        self.state = TemporalState(brpm=0.0, var=100.0, n_accepted=0, status="initializing")

    def update(self, fusion: FusionResult | None) -> TemporalState:
        """Process one window's fusion result."""
        if fusion is None or fusion.brpm is None or fusion.confidence < self.cfg.temporal_min_confidence:
            # No measurement: predict with variance growth
            self.state.var += self.cfg.temporal_process_noise_brpm2
            self.state.n_accepted = 0
            self.state.status = "tracking" if self.state.n_accepted == 0 and self.state.brpm > 0 else "initializing"
            return self.state

        z = fusion.brpm
        R = 1.0 / max(fusion.confidence, 0.01)  # measurement variance from confidence
        P = self.state.var

        # Kalman gain
        K = P / (P + R)

        # Update
        self.state.brpm = self.state.brpm + K * (z - self.state.brpm)
        self.state.var = (1 - K) * P + self.cfg.temporal_process_noise_brpm2
        self.state.n_accepted += 1
        self.state.status = "tracking"

        return self.state

    def reset(self) -> None:
        self.state = TemporalState(brpm=0.0, var=100.0, n_accepted=0, status="initializing")