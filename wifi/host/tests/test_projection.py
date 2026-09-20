import numpy as np

from breath.projection import ComplexProjector, compute_ssnr_real
from breath.pipeline_config import PipelineConfig
from breath.cscr import CSCRCandidate


def test_projection_finds_known_angle():
    cfg = PipelineConfig(projection_angle_step_deg=2.0)
    proj = ComplexProjector(cfg)
    fs = 20.0
    n = 200
    t = np.arange(n) / fs
    # Signal at 30 deg: p = cos(2π*0.25*t), then rotated by 30 deg in I/Q
    theta_true = np.deg2rad(30.0)
    p = np.sin(2*np.pi*0.25*t)
    z = p * np.exp(1j * theta_true)  # complex signal at 30 deg
    c = CSCRCandidate(num_idx=12, den_idx=24, physical_pair=(12,24),
                      z=z.astype(np.complex128), ssnr=0, stable=True)
    res = proj.project(c, fs)
    assert abs(res.angle_deg - 30.0) < 2.5  # within grid step


def test_projection_orthogonal_signals():
    cfg = PipelineConfig(projection_angle_step_deg=2.0)
    proj = ComplexProjector(cfg)
    fs = 20.0
    n = 200
    t = np.arange(n) / fs
    # Pure imaginary (90 deg) -> projection at 90 should be max
    z = 1j * np.sin(2*np.pi*0.25*t)
    c = CSCRCandidate(num_idx=12, den_idx=24, physical_pair=(12,24),
                      z=z.astype(np.complex128), ssnr=0, stable=True)
    res = proj.project(c, fs)
    # 90° or 90°±180° -> angle in [0,180) so 90°
    assert abs(res.angle_deg - 90.0) < 2.5


def test_projection_batch():
    cfg = PipelineConfig(projection_angle_step_deg=5.0)
    proj = ComplexProjector(cfg)
    fs = 20.0
    n = 200
    t = np.arange(n) / fs
    c1 = CSCRCandidate(12, 24, (12,24), (np.sin(2*np.pi*0.25*t) * np.exp(1j*0.3)).astype(np.complex128), 0, True)
    c2 = CSCRCandidate(14, 26, (14,26), (np.sin(2*np.pi*0.25*t) * np.exp(1j*1.2)).astype(np.complex128), 0, True)
    res = proj.project_batch([c1, c2], fs)
    assert len(res) == 2
    assert res[0].projected.shape == (n,)
    assert res[1].projected.shape == (n,)