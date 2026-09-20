import numpy as np

from breath.estimators import FFTEstimator, BSSFEstimator, estimator_agreement
from breath.pipeline_config import PipelineConfig


def test_fft_estimator_on_tone():
    cfg = PipelineConfig()
    est = FFTEstimator(cfg)
    fs = 20.0
    n = 400
    t = np.arange(n) / fs
    # 15 brpm = 0.25 Hz
    x = np.sin(2*np.pi*0.25*t)
    res = est.estimate(x, fs)
    assert res.valid
    assert res.brpm is not None
    assert abs(res.brpm - 15.0) < 1.5  # within FFT resolution


def test_fft_estimator_rejects_noise():
    cfg = PipelineConfig(fft_snr_min_db=10.0)
    est = FFTEstimator(cfg)
    fs = 20.0
    n = 400
    rng = np.random.default_rng(42)
    x = rng.standard_normal(n) * 0.1  # noise only
    res = est.estimate(x, fs)
    assert not res.valid


def test_bssf_estimator_on_tone():
    cfg = PipelineConfig()
    est = BSSFEstimator(cfg)
    fs = 20.0
    n = 600  # 30s at 20 Hz
    t = np.arange(n) / fs
    # Simulate breathing: sinusoid with some shape
    x = np.sin(2*np.pi*0.25*t) + 0.3 * np.sin(2*np.pi*0.5*t)  # 15 brpm + harmonic
    res = est.estimate(x, fs)
    assert res.valid
    assert res.brpm is not None
    assert 10 < res.brpm < 25
    assert len(res.onset_times) >= 2


def test_bssf_rejects_out_of_bounds():
    cfg = PipelineConfig()
    est = BSSFEstimator(cfg)
    fs = 20.0
    n = 400
    t = np.arange(n) / fs
    # 60 brpm = 1 Hz -> zero-crossings at 0.5s intervals, below BSSF's
    # minimum half-breath interval (0.9s). Should reject as too few valid.
    x = np.sin(2*np.pi*1.0*t)
    res = est.estimate(x, fs)
    assert not res.valid
    assert res.diagnostics.get("reason") == "too_few_valid_intervals"


def test_estimator_agreement():
    cfg = PipelineConfig(estimator_agreement_threshold_brpm=4.0)
    from breath.estimators import EstimatorResult
    fft_r = EstimatorResult(16.0, 0.267, 8.0, np.array([]), True, {})
    bssf_r = EstimatorResult(17.5, 0.0, 8.5, np.array([]), True, {})
    diff, score, passed = estimator_agreement(fft_r, bssf_r, cfg)
    assert diff == 1.5
    assert passed

    # Disagreement
    bssf_r2 = EstimatorResult(25.0, 0.0, 12.0, np.array([]), True, {})
    diff2, score2, passed2 = estimator_agreement(fft_r, bssf_r2, cfg)
    assert diff2 == 9.0
    assert not passed2