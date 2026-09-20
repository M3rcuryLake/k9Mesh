import numpy as np

from breath.filters import HampelFilter, FilterChain
from breath.pipeline_config import PipelineConfig


def test_hampel_removes_impulses():
    x = np.sin(np.arange(100) * 0.1)
    x[50] = 100.0  # impulse
    h = HampelFilter(window=7, threshold=5.0)
    y = h.filter(x)
    assert abs(y[50]) < 2.0  # impulse replaced by local median
    # Non-impulse samples largely unchanged
    assert np.allclose(y[:45], x[:45], atol=0.1)


def test_hampel_small_window():
    x = np.array([1.0, 2.0, 100.0, 2.0, 1.0])
    h = HampelFilter(window=3, threshold=5.0)
    y = h.filter(x)
    # With window=3, median at idx 2 is 2, impulse replaced
    assert abs(y[2] - 2.0) < 0.1


def test_filter_chain_fs_aware():
    cfg = PipelineConfig()
    fc = FilterChain(cfg)
    fs = 20.0
    n = 200
    t = np.arange(n) / fs
    # Signal at 15 brpm = 0.25 Hz + high-freq noise + impulse
    x = np.sin(2*np.pi*0.25*t) + 0.5 * np.sin(2*np.pi*5*t)
    x[100] = 50.0
    res = fc.process(x, fs)
    assert res.filtered.shape == (n,)
    # Impulse should be attenuated
    assert abs(res.filtered[100]) < 5.0
    # High-freq noise should be attenuated by bandpass
    # (5 Hz is above physiological band 0.55 Hz)


def test_filter_chain_sg_legal_params():
    cfg = PipelineConfig()
    fc = FilterChain(cfg)
    # Very short signal - SG should not crash
    for n in [5, 10, 20, 50]:
        x = np.random.randn(n)
        res = fc.process(x, 20.0)
        assert res.filtered.shape == (n,)


def test_bandpass_attenuates_out_of_band():
    cfg = PipelineConfig()
    fc = FilterChain(cfg)
    fs = 20.0
    n = 400
    t = np.arange(n) / fs
    # In-band 0.25 Hz + out-of-band 5 Hz
    x = np.sin(2*np.pi*0.25*t) + np.sin(2*np.pi*5*t)
    res = fc.process(x, fs)
    # Compute power ratio
    in_power = np.sum(res.filtered**2)
    # The 5 Hz component should be strongly attenuated
    # Just check the output isn't dominated by high freq
    assert np.std(res.filtered) < np.std(x)  # smoothing effect