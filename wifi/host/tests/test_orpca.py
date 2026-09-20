import numpy as np

from breath.orpca import orpca_admm, ORPCAStaticRemover
from breath.pipeline_config import PipelineConfig
from breath.windowing import CSIWindow


def test_orpca_admm_runs():
    """Basic smoke test that ADMM runs without error."""
    m, n = 20, 100
    rng = np.random.default_rng(42)
    X = rng.standard_normal((m, n)) + 1j * rng.standard_normal((m, n))

    L_est, S_est = orpca_admm(X, max_iter=10, tol=1e-2)
    assert L_est.shape == X.shape
    assert S_est.shape == X.shape
    # Reconstruction should be approximately X
    recon = L_est + S_est
    rel_err = np.linalg.norm(recon - X) / np.linalg.norm(X)
    assert rel_err < 0.5  # loose bound for short run


def test_orpca_static_remover():
    cfg = PipelineConfig()
    remover = ORPCAStaticRemover(cfg)

    # Create window with static + dynamic
    m, n = 30, 200
    rng = np.random.default_rng(42)
    t = np.arange(n) / 20.0
    H = np.zeros((m, n), dtype=np.complex64)
    for i in range(m):
        static = rng.standard_normal() + 1j * rng.standard_normal()
        dynamic = 0.1 * np.sin(2 * np.pi * 0.25 * t)  # 15 brpm
        H[i] = static + dynamic

    valid = np.ones(m, dtype=bool)
    window = CSIWindow(
        t=t,
        H=H,
        valid_mask=valid,
        original_mask=np.ones(n, dtype=bool),
        interp=None,
    )

    res = remover.remove(window)
    assert res.method == "orpca"
    assert res.H_dyn.shape == H.shape
    # NOTE: OR-PCA is NOT validated for respiration preservation.
    # Dense coherent signals (like respiration across subcarriers) get
    # absorbed into the low-rank component. This test only checks
    # that the method runs and returns correct shape.
    assert res.H_static is not None