"""
projection.py

Stage 5: complex-domain projection.

After CSCR/GASS, each candidate is a complex time series z(k). The
respiration signal may appear primarily in amplitude, phase, or some
rotated combination in the I/Q plane. This module finds the optimal
projection angle θ that maximizes a respiration-band quality metric
(SSNR).

Method: grid search over θ in [0, π) (since projection is symmetric:
θ and θ+π give same line with opposite polarity, which is resolved
later by the fusion sign step). For each θ, project z -> p = Re(z e^{-iθ}),
compute SSNR in the GASS band, pick the max.

Complexity: O(n_angles * n_samples) per candidate. Vectorized over
candidates for speed. Grid step is configurable (default 1°).
"""

from dataclasses import dataclass

import numpy as np

from breath.pipeline_config import PipelineConfig
from breath.cscr import CSCRCandidate


@dataclass(slots=True)
class ProjectionResult:
    candidate: CSCRCandidate
    angle_rad: float           # optimal projection angle
    angle_deg: float
    projected: np.ndarray      # float[n] real-valued projected signal
    ssnr: float                # SSNR at optimal angle
    ssnr_grid: np.ndarray      # SSNR for each angle in grid


class ComplexProjector:
    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg
        self._angles_rad = None
        self._angles_deg = None

    def _angles(self) -> np.ndarray:
        if self._angles_rad is None:
            step = np.deg2rad(self.cfg.projection_angle_step_deg)
            self._angles_rad = np.arange(0, np.pi, step)
            self._angles_deg = np.rad2deg(self._angles_rad)
        return self._angles_rad

    def project(self, candidate: CSCRCandidate, fs_hz: float) -> ProjectionResult:
        """Find optimal projection angle for one CSCR candidate."""
        z = candidate.z
        angles = self._angles()
        n_angles = len(angles)
        n = len(z)

        # Vectorized projection: for each angle, compute p = Re(z * e^{-iθ})
        # z is complex128[n]; angles is float[n_angles]
        # z[:, None] * exp(-1j * angles[None, :]) -> complex128[n, n_angles]
        # Take real part -> float[n, n_angles]
        # Memory: n=200, n_angles=180 -> 36k complex ~ 500KB, fine.
        phases = np.exp(-1j * angles)
        p_all = (z[:, None] * phases[None, :]).real  # [n, n_angles]

        # Compute SSNR for each angle
        ssnr_grid = np.zeros(n_angles)
        for i in range(n_angles):
            ssnr_grid[i] = compute_ssnr_real(p_all[:, i], fs_hz, self.cfg)

        best_idx = int(np.argmax(ssnr_grid))
        best_angle = angles[best_idx]
        projected = p_all[:, best_idx]

        return ProjectionResult(
            candidate=candidate,
            angle_rad=best_angle,
            angle_deg=float(np.rad2deg(best_angle)),
            projected=projected,
            ssnr=float(ssnr_grid[best_idx]),
            ssnr_grid=ssnr_grid,
        )

    def project_batch(self, candidates: list[CSCRCandidate], fs_hz: float) -> list[ProjectionResult]:
        """Project multiple candidates, returning results in same order."""
        if not candidates:
            return []
        # Stack all z into [n_candidates, n_samples]
        # But candidates may have different n_samples (shouldn't in practice).
        # Just loop for simplicity; n_candidates is small (≤32).
        return [self.project(c, fs_hz) for c in candidates]


def compute_ssnr_real(x: np.ndarray, fs: float, cfg: PipelineConfig) -> float:
    """In-band power for projection objective (NOT SSNR ratio - that's amplitude-invariant)."""
    n = len(x)
    if n < 4:
        return -100.0
    X = np.abs(np.fft.rfft(x))
    P = X ** 2
    f = np.fft.rfftfreq(n, 1.0/fs)

    in_band = (f >= cfg.gass_band_hz[0]) & (f <= cfg.gass_band_hz[1])
    in_power = float(P[in_band].sum()) if in_band.any() else 1e-12
    return in_power  # Use power, not ratio