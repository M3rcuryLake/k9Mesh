import numpy as np

from breath.windowing import (
    unwrap_timestamps,
    normalize_timestamps,
    TimestampNormalizer,
    WindowManager,
    CSIWindow,
    InterpolationMetadata,
)
from breath.pipeline_config import PipelineConfig


def test_unwrap_wrap():
    ts = np.array([4294967290, 4294967295, 2, 5], dtype=np.uint32)
    t = unwrap_timestamps(ts)
    assert np.all(np.diff(t) > 0)
    assert abs(t[2] - t[1] - 3e-6) < 1e-9


def test_normalize_backward_and_duplicates():
    t_raw = np.array([10, 11, 11, 13, 12, 14], dtype=np.int64)
    t_clean, keep, nb, nd = normalize_timestamps(t_raw)
    assert list(t_clean) == [1e-5, 1.1e-5, 1.3e-5, 1.4e-5]
    assert nb == 1
    assert nd == 1
    assert keep[2] == False  # duplicate
    assert keep[4] == False  # backward


def test_timestamp_normalizer_uniform_grid():
    cfg = PipelineConfig()
    tn = TimestampNormalizer(cfg)
    for i in range(20):
        tn.add(int(1000000 + i * 50000), np.ones(64, dtype=np.complex64))
    w = tn.drain()
    assert w is not None
    assert w.t.shape[0] == w.H.shape[1] == 20
    assert w.interp.fs_nominal > 19.9 and w.interp.fs_nominal < 20.1
    assert w.interp.interp_fraction == 0.0


def test_timestamp_normalizer_large_gap():
    cfg = PipelineConfig(large_gap_threshold_s=0.5, interp_rejection_fraction=0.1)
    tn = TimestampNormalizer(cfg)
    # normal 20 Hz, then a 2s gap, then more
    for i in range(10):
        tn.add(int(1000000 + i * 50000), np.ones(64, dtype=np.complex64))
    for i in range(10):
        tn.add(int(3000000 + i * 50000), np.ones(64, dtype=np.complex64))
    w = tn.drain()
    assert w is not None
    assert w.interp.n_large_gaps == 1
    # max_gap_s is measured on raw timestamps, gap = 3.0 - 1.45 = 1.55s
    assert w.interp.max_gap_s > 1.5
    # interpolation across the gap should NOT happen -> large_gap_fraction > 0
    assert w.interp.large_gap_fraction > 0.15
    # trust_ok depends on large_gap_fraction > interp_rejection_fraction
    assert w.interp.trust_ok is False
    assert w.interp.rejection_reason == "INTERP_FRACTION_EXCEEDED"


def test_window_manager_accumulation_and_cut():
    cfg = PipelineConfig(max_window_s=30.0)
    tn = TimestampNormalizer(cfg)
    wm = WindowManager(cfg)

    base = 1000000
    for i in range(400):
        tn.add(int(base + i * 50000), np.ones(64, dtype=np.complex64))
        if i % 50 == 0:
            w = tn.drain()
            if w:
                wm.push(w)

    w = wm.cut(10.0)
    assert w is not None
    assert w.t.shape[0] >= 200  # ~10s at 20 Hz
    assert abs(w.t[-1] - w.t[0] - 10.0) < 0.5


def test_window_manager_insufficient_data():
    cfg = PipelineConfig()
    wm = WindowManager(cfg)
    tn = TimestampNormalizer(cfg)
    for i in range(5):
        tn.add(int(1000000 + i * 50000), np.ones(64, dtype=np.complex64))
    w = tn.drain()
    if w:
        wm.push(w)
    w_cut = wm.cut(10.0)
    assert w_cut is None


def test_interpolation_does_not_cross_large_gaps():
    cfg = PipelineConfig(large_gap_threshold_s=0.3, interp_rejection_fraction=0.2)
    tn = TimestampNormalizer(cfg)
    # 5 samples, 0.7s gap, 5 samples, 0.6s gap, 5 samples
    # both gaps > 0.3s -> both flagged
    t0 = 1000000
    for i in range(5):
        tn.add(int(t0 + i * 100000), np.ones(64, dtype=np.complex64))
    for i in range(5):
        tn.add(int(t0 + 1100000 + i * 100000), np.ones(64, dtype=np.complex64))
    for i in range(5):
        tn.add(int(t0 + 2100000 + i * 100000), np.ones(64, dtype=np.complex64))
    w = tn.drain()
    assert w is not None
    # both 0.7s and 0.6s gaps > 0.3s threshold -> 2 large gaps
    assert w.interp.n_large_gaps == 2