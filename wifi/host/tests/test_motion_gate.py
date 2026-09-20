import numpy as np

from breath.motion_gate import MotionGate
from breath.pipeline_config import PipelineConfig
from breath.windowing import CSIWindow


def make_window(H, fs=20.0):
    n = H.shape[1]
    t = np.arange(n) / fs
    valid_mask = np.ones(H.shape[0], dtype=bool)
    valid_mask[:11] = False
    valid_mask[52:] = False
    valid_mask[32] = False
    return CSIWindow(
        t=t,
        H=H,
        valid_mask=valid_mask,
        original_mask=np.ones(n, dtype=bool),
        interp=None,
    )


def test_motion_gate_static_passes():
    cfg = PipelineConfig(motion_phase_threshold_rad=2.0)
    gate = MotionGate(cfg)
    # Static: constant phase per subcarrier
    H = np.exp(1j * np.random.uniform(0, 2*np.pi, 64))[:, None] * np.ones((1, 100))
    H = H.astype(np.complex64)
    w = make_window(H)
    res = gate.process(w)
    assert res.window_valid
    assert res.n_invalid == 0


def test_motion_gate_dynamic_fails():
    cfg = PipelineConfig(motion_phase_threshold_rad=2.0)
    gate = MotionGate(cfg)
    # Simulate motion: phase changes >2 rad within 1s subframe.
    # At 20 Hz, need per-sample delta >2/20 = 0.1 rad/sample.
    # Use a fast phase ramp: 5 rad/s = 0.25 rad/sample peak.
    t = np.arange(100) / 20.0
    sweep = 5.0 * t  # 5 rad/s linear ramp -> 0.25 rad/sample
    H = np.ones((64, 100), dtype=np.complex64)
    for sc in range(11, 51):
        if sc == 32: continue
        H[sc] = np.exp(1j * sweep)
    w = make_window(H)
    res = gate.process(w)
    assert res.n_invalid > 0
    assert not res.window_valid
    assert res.rejection_reason == "MOTION_SUBFRAMES"


def test_motion_gate_short_window():
    cfg = PipelineConfig(motion_phase_threshold_rad=2.0)
    gate = MotionGate(cfg)
    H = np.ones((64, 5), dtype=np.complex64)
    w = make_window(H, fs=20.0)
    res = gate.process(w)
    assert not res.window_valid
    assert res.rejection_reason == "INSUFFICIENT_DATA"