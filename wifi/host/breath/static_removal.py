"""
static_removal.py

Stage 3: static-path removal.

Default method (VALIDATED concept): per-subcarrier complex mean
subtraction. This removes the LOS path, walls, furniture — everything
that is constant over the window.

Optional OR-PCA path (EXPERIMENTAL, flag-gated): low-rank + sparse
decomposition. NOT proven to preserve mm-scale respiration; behind
config.enable_orpca and only for benchmarking.
"""

from dataclasses import dataclass
from typing import Protocol

import numpy as np

from breath.pipeline_config import PipelineConfig
from breath.windowing import CSIWindow


@dataclass(slots=True)
class StaticRemovalResult:
    H_dyn: np.ndarray           # complex64[n_sc, n] dynamic component
    method: str                 # "mean_sub" | "orpca"
    H_static: np.ndarray | None = None  # complex64[n_sc] mean (if mean_sub)


class StaticRemover(Protocol):
    def remove(self, window: CSIWindow) -> StaticRemovalResult: ...


class MeanSubtractionRemover:
    """Per-subcarrier complex mean subtraction (default, validated)."""

    def remove(self, window: CSIWindow) -> StaticRemovalResult:
        H = window.H
        valid = window.valid_mask
        H_mean = np.zeros(H.shape[0], dtype=np.complex64)
        H_mean[valid] = np.mean(H[valid], axis=1)
        H_dyn = H.copy()
        H_dyn[valid] = H[valid] - H_mean[valid, None]
        return StaticRemovalResult(
            H_dyn=H_dyn.astype(np.complex64),
            method="mean_sub",
            H_static=H_mean,
        )


from breath.orpca import ORPCAStaticRemover as _ORPCAStaticRemover


class ORPCAStaticRemover:
    """Experimental OR-PCA (robust PCA) - NOT on the required path.

    Low-rank + sparse decomposition of the CSI matrix. This is the
    experimental preprocessing option mentioned in the plan. It is NOT
    proven to preserve respiration; only validated for gross motion
    separation. Behind config.enable_orpca flag.
    """

    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg
        self._impl = _ORPCAStaticRemover(cfg)

    def remove(self, window: CSIWindow) -> StaticRemovalResult:
        return self._impl.remove(window)


def make_remover(cfg: PipelineConfig) -> StaticRemover:
    if cfg.enable_orpca:
        return ORPCAStaticRemover(cfg)
    return MeanSubtractionRemover()