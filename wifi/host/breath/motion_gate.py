"""
motion_gate.py

Stage 2: phase-based gross-motion rejection.

The ESP32-S3 CSI phase is corrupted by packet-dependent common phase
errors (CPE), but these affect ALL subcarriers approximately equally.
Gross physical motion (rover vibration, large objects moving) induces
additional phase variation that is NOT common-mode and shows up as
excess phase change on individual subcarriers.

Strategy: split the window into ~1s subframes. For each subframe,
compute the unwrapped phase of each valid subcarrier across time and
take the maximum absolute phase delta. If > threshold_rad (configurable
2.0), the subframe is flagged invalid. A window with too many invalid
subframes is MOTION_REJECTED.

This runs BEFORE static-path removal (mean subtraction), because the
static removal would destroy the absolute phase reference we need.
"""

from dataclasses import dataclass

import numpy as np

from breath.pipeline_config import PipelineConfig
from breath.windowing import CSIWindow


@dataclass(slots=True)
class MotionGateResult:
    subframe_valid: np.ndarray       # bool[n_subframes]
    max_phase_delta: np.ndarray      # [rad] per subframe
    threshold_rad: float             # [rad]
    n_invalid: int
    window_valid: bool
    rejection_reason: str | None = None


class MotionGate:
    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg

    def process(self, window: CSIWindow) -> MotionGateResult:
        """Split window into subframes and gate on per-subframe phase delta.

        Args:
            window: CSIWindow with H [n_sc, n_samples], uniform grid t [s]
        """
        cfg = self.cfg
        t = window.t
        H = window.H
        valid_mask = window.valid_mask

        if len(t) < 2:
            return MotionGateResult(
                subframe_valid=np.array([], dtype=bool),
                max_phase_delta=np.array([]),
                threshold_rad=cfg.motion_phase_threshold_rad,
                n_invalid=0,
                window_valid=False,
                rejection_reason="INSUFFICIENT_DATA",
            )

        fs = 1.0 / np.median(np.diff(t))
        subframe_len = int(round(cfg.subframe_duration_s * fs))
        if subframe_len < 2:
            subframe_len = 2

        n_subframes = len(t) // subframe_len
        if n_subframes == 0:
            return MotionGateResult(
                subframe_valid=np.array([False]),
                max_phase_delta=np.array([0.0]),
                threshold_rad=cfg.motion_phase_threshold_rad,
                n_invalid=1,
                window_valid=False,
                rejection_reason="INSUFFICIENT_DATA",
            )

        # Use valid subcarriers that have meaningful magnitude (exclude
        # near-zero bins that would have garbage phase)
        mag = np.abs(H)
        active = valid_mask & (np.median(mag, axis=1) > 1e-3)
        if not active.any():
            return MotionGateResult(
                subframe_valid=np.zeros(n_subframes, dtype=bool),
                max_phase_delta=np.zeros(n_subframes),
                threshold_rad=cfg.motion_phase_threshold_rad,
                n_invalid=n_subframes,
                window_valid=False,
                rejection_reason="NO_VALID_SUBCARRIERS",
            )

        subframe_valid = np.zeros(n_subframes, dtype=bool)
        max_deltas = np.zeros(n_subframes)

        for i in range(n_subframes):
            lo = i * subframe_len
            hi = (i + 1) * subframe_len
            H_sub = H[active][:, lo:hi]

            # Unwrap phase per subcarrier across time
            phase = np.angle(H_sub)
            phase_u = np.unwrap(phase, axis=1)

            # Cumulative phase change per subcarrier: max - min over time
            # Then take max across subcarriers.
            if phase_u.size == 0:
                phase_range = 0.0
            else:
                per_sc_range = np.max(phase_u, axis=1) - np.min(phase_u, axis=1)
                phase_range = float(np.max(per_sc_range))
            max_deltas[i] = phase_range

            subframe_valid[i] = phase_range <= cfg.motion_phase_threshold_rad

        n_invalid = int((~subframe_valid).sum())
        invalid_fraction = n_invalid / n_subframes if n_subframes else 1.0
        window_valid = invalid_fraction <= cfg.max_invalid_subframe_fraction

        reason = None
        if not window_valid:
            reason = "MOTION_SUBFRAMES"

        return MotionGateResult(
            subframe_valid=subframe_valid,
            max_phase_delta=max_deltas,
            threshold_rad=cfg.motion_phase_threshold_rad,
            n_invalid=n_invalid,
            window_valid=window_valid,
            rejection_reason=reason,
        )