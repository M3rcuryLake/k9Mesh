import numpy as np

from breath.gass import GASSOptimizer, heuristic_select, gass_optimize
from breath.pipeline_config import PipelineConfig
from breath.cscr import CSCRCandidate


def test_heuristic_select():
    cfg = PipelineConfig(cscr_max_candidates=2)  # cap at 2
    candidates = [
        CSCRCandidate(12, 24, (12, 24), np.zeros(100), ssnr=10.0, stable=True),  # 2nd best
        CSCRCandidate(14, 26, (14, 26), np.zeros(100), ssnr=20.0, stable=True),  # 1st best
        CSCRCandidate(16, 28, (16, 28), np.zeros(100), ssnr=5.0, stable=True),   # 3rd best
    ]
    weights = heuristic_select(type('Bank', (), {'candidates': candidates})(), cfg)
    # Sorted by SSNR: index 1 (20), index 0 (10), index 2 (5) -> top 2 get 0.5 each
    assert weights[0] == 0.5  # 2nd best
    assert weights[1] == 0.5  # 1st best
    assert weights[2] == 0.0  # 3rd best


def test_gass_optimizer_basic():
    cfg = PipelineConfig(enable_gass=True, gass_population=10, gass_generations=5,
                         gass_seed=42)
    n = 5
    fs = 20.0
    # Create signals with known SSNR ordering
    t = np.arange(200) / fs
    signals = []
    for i in range(n):
        # Signal 2 has strongest in-band energy
        if i == 2:
            s = 2.0 * np.sin(2 * np.pi * 0.25 * t)
        else:
            s = 0.5 * np.sin(2 * np.pi * 0.25 * t) + 0.5 * np.random.randn(200)
        signals.append(s.astype(float))

    opt = GASSOptimizer(cfg, fs, n)
    w = opt._rng.dirichlet([0.5] * n)
    ind = type('Ind', (), {'weights': w, 'fitness': -np.inf, 'age': 0})()
    # Test fitness eval
    fit = opt._fitness(w, signals)
    assert fit > -100


def test_gass_warm_start():
    cfg = PipelineConfig(enable_gass=True, gass_population=8, gass_generations=3,
                         gass_seed=123)
    n = 4
    fs = 20.0
    # Good candidate gets weight 1.0 in warm start
    warm = np.array([0.0, 1.0, 0.0, 0.0])

    signals = []
    t = np.arange(200) / fs
    for i in range(n):
        if i == 1:
            s = 2.0 * np.sin(2 * np.pi * 0.25 * t)  # strong in-band
        else:
            s = 0.1 * np.random.randn(200)  # noise
        signals.append(s.astype(float))

    opt = GASSOptimizer(cfg, fs, n)
    pop = opt._initialize_population(warm)
    assert len(pop) == cfg.gass_population
    # First individual should be warm start (normalized)
    assert np.isclose(pop[0].weights[1], 1.0, atol=1e-3)


def test_gass_optimize_end_to_end():
    cfg = PipelineConfig(enable_gass=True, gass_population=12, gass_generations=5,
                         gass_seed=42)
    n = 3
    fs = 20.0

    t = np.arange(200) / fs
    candidates = []
    for i in range(n):
        sig = np.sin(2 * np.pi * 0.25 * t) if i == 1 else 0.1 * np.random.randn(200)
        c = CSCRCandidate(12 + i * 2, 24 + i * 2, (12 + i * 2, 24 + i * 2),
                          np.exp(1j * sig).astype(np.complex128),
                          ssnr=10.0 if i == 1 else 0.0, stable=True)
        c.filtered = sig.astype(float)
        candidates.append(c)

    class MockBank:
        def __init__(self):
            self.candidates = candidates

    bank = MockBank()
    weights = gass_optimize(bank, cfg, fs_hz=fs)

    assert len(weights) == n
    assert np.isclose(sum(weights), 1.0, atol=1e-3)
    # Candidate 1 should get highest weight
    assert weights[1] > weights[0]
    assert weights[1] > weights[2]