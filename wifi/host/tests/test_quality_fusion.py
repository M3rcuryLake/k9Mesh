import numpy as np

from breath.quality import QualityGate, QualityResult, RejectionReason
from breath.fusion import fuse_candidates, MeanFusionBaseline, FusionResult
from breath.pipeline_config import PipelineConfig
from breath.cscr import CSCRCandidate
from breath.estimators import EstimatorResult


def make_candidate(ssnr=15.0, fft_brpm=15.0, bssf_brpm=15.5, filtered_len=400, fs=20.0):
    n = filtered_len
    t = np.arange(n) / fs
    filtered = np.sin(2*np.pi*0.25*t)  # 15 brpm
    c = CSCRCandidate(
        num_idx=12, den_idx=24, physical_pair=(12, 24),
        z=np.exp(1j*np.sin(2*np.pi*0.25*t)).astype(np.complex128),
        ssnr=ssnr, stable=True
    )
    c.filtered = filtered
    c.fft_brpm = fft_brpm
    c.bssf_brpm = bssf_brpm
    return c


def test_quality_gate_passes_good_candidate():
    cfg = PipelineConfig()
    gate = QualityGate(cfg)
    c = make_candidate(ssnr=20.0, fft_brpm=15.0, bssf_brpm=15.2)
    res = gate.evaluate(c, 20.0)
    assert res.passed
    assert res.rejection_reason is None
    assert res.total_quality > 0.5


def test_quality_gate_rejects_low_snr():
    cfg = PipelineConfig(quality_snr_score_min=0.5)
    gate = QualityGate(cfg)
    c = make_candidate(ssnr=5.0)  # snr_score = 5/20 = 0.25 < 0.5
    res = gate.evaluate(c, 20.0)
    assert not res.passed
    assert res.rejection_reason == RejectionReason.LOW_SNR


def test_quality_gate_rejects_disagreement():
    cfg = PipelineConfig(estimator_agreement_threshold_brpm=1.0)
    gate = QualityGate(cfg)
    c = make_candidate(fft_brpm=15.0, bssf_brpm=20.0)  # diff = 5 > 1
    res = gate.evaluate(c, 20.0)
    assert not res.passed
    assert res.rejection_reason == RejectionReason.ESTIMATOR_DISAGREEMENT


def test_quality_gate_cycle_count_penalty():
    cfg = PipelineConfig(min_cycles=3.0)
    gate = QualityGate(cfg)
    # Window ~20s at 15 brpm = 5 cycles -> OK
    c = make_candidate(filtered_len=400, fs=20.0)  # 20s -> 5 cycles
    res = gate.evaluate(c, 20.0)
    assert res.cycle_count >= 3.0

    # Short window: 6s at 15 brpm = 1.5 cycles -> reject
    c2 = make_candidate(filtered_len=120, fs=20.0)  # 6s -> 1.5 cycles
    res2 = gate.evaluate(c2, 20.0)
    assert not res2.passed
    assert res2.rejection_reason == RejectionReason.TOO_FEW_CYCLES


def test_mean_fusion_baseline():
    cfg = PipelineConfig(fusion_method="mean_baseline")
    c1 = make_candidate(ssnr=20.0, fft_brpm=15.0, bssf_brpm=15.2)
    c2 = make_candidate(ssnr=10.0, fft_brpm=16.0, bssf_brpm=15.8)
    c3 = make_candidate(ssnr=5.0)  # low SSNR, but passing
    # Need to set quality passed
    from breath.quality import QualityGate
    gate = QualityGate(cfg)
    for c in [c1, c2, c3]:
        c.quality = gate.evaluate(c, 20.0)
        if c.quality.passed:
            c.filtered = np.sin(2*np.pi*0.25*np.arange(400)/20.0)

    res = fuse_candidates([c1, c2, c3], cfg)
    assert res.method == "mean_baseline"
    assert res.brpm is not None
    assert 14 < res.brpm < 17
    assert res.n_passing >= 1


def test_fusion_empty():
    cfg = PipelineConfig()
    res = fuse_candidates([], cfg)
    assert res.brpm is None
    assert res.n_candidates == 0