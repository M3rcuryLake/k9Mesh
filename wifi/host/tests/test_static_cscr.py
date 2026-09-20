import numpy as np

from breath.static_removal import MeanSubtractionRemover, StaticRemovalResult
from breath.cscr import CSCRBank, compute_ssnr, window_valid_mask
from breath.pipeline_config import PipelineConfig
from breath.windowing import CSIWindow


def make_window_with_tone(brpm=15.0, fs=20.0, n=200):
    t = np.arange(n) / fs
    f = brpm / 60.0
    # Static + dynamic on some subcarriers
    H = np.zeros((64, n), dtype=np.complex64)
    for sc in range(11, 51):
        if sc == 32: continue
        static_phase = np.random.uniform(0, 2*np.pi)
        static_mag = np.random.uniform(20, 80)
        # Add respiration modulation on half the subcarriers
        if sc % 2 == 0:
            H[sc] = static_mag * np.exp(1j * (static_phase + 0.2 * np.sin(2*np.pi*f*t)))
        else:
            H[sc] = static_mag * np.exp(1j * static_phase) * np.ones(n)
    valid_mask = np.ones(64, dtype=bool)
    valid_mask[:11]=False; valid_mask[52:]=False; valid_mask[32]=False
    return CSIWindow(
        t=t, H=H, valid_mask=valid_mask,
        original_mask=np.ones(n, dtype=bool), interp=None
    )


def test_mean_subtraction_removes_static():
    cfg = PipelineConfig()
    remover = MeanSubtractionRemover()
    w = make_window_with_tone()
    res = remover.remove(w)
    assert res.method == "mean_sub"
    assert res.H_dyn.shape == w.H.shape
    # Static subcarriers should have ~zero dynamic component
    static_mask = np.zeros(64, dtype=bool)
    for sc in range(11, 51):
        if sc == 32: continue
        if sc % 2 == 1:  # these had no dynamic
            static_mask[sc] = True
    dyn_mag = np.abs(res.H_dyn[static_mask]).mean()
    assert dyn_mag < 1.0  # noise floor


def test_mean_subtraction_preserves_dynamic():
    cfg = PipelineConfig()
    remover = MeanSubtractionRemover()
    w = make_window_with_tone()
    res = remover.remove(w)
    # Dynamic subcarriers should retain the tone
    dyn_mask = np.zeros(64, dtype=bool)
    for sc in range(11, 51):
        if sc == 32: continue
        if sc % 2 == 0:
            dyn_mask[sc] = True
    dyn_mag = np.abs(res.H_dyn[dyn_mask]).std()
    assert dyn_mag > 0.5  # modulation depth


def test_cscr_bank_basic():
    cfg = PipelineConfig()
    w = make_window_with_tone(n=200)
    remover = MeanSubtractionRemover()
    static_res = remover.remove(w)
    physical_idx = np.arange(64)
    fs = 20.0
    bank = CSCRBank.build(static_res, cfg, physical_idx, fs_hz=fs)
    assert len(bank.candidates) > 0
    for c in bank.candidates:
        assert c.num_idx != c.den_idx
        assert c.z.shape[0] == 200
        assert c.ssnr > -100
        assert c.stable


def test_cscr_denominator_floor():
    # Floor is fraction of median DYNAMIC magnitude (after mean subtraction).
    # With floor=0, all pairs stable. With huge floor, some should become unstable.
    w = make_window_with_tone()
    remover = MeanSubtractionRemover()
    static_res = remover.remove(w)
    physical_idx = np.arange(64)
    fs = 20.0

    cfg_low = PipelineConfig(cscr_denominator_floor_frac=0.0)
    bank_low = CSCRBank.build(static_res, cfg_low, physical_idx, fs_hz=fs)
    n_low = len(bank_low.candidates)

    cfg_high = PipelineConfig(cscr_denominator_floor_frac=1e6)  # effectively infinite
    bank_high = CSCRBank.build(static_res, cfg_high, physical_idx, fs_hz=fs)
    n_high = len(bank_high.candidates)

    # High floor should reject at least as many pairs
    assert n_high <= n_low


def test_ssnr_detects_tone():
    cfg = PipelineConfig()
    n = 200
    fs = 20.0
    t = np.arange(n) / fs
    # Pure tone at 15 brpm = 0.25 Hz (in estimator band 0.167-0.5)
    z = np.exp(1j * 0.5 * np.sin(2*np.pi*0.25*t))  # phase mod
    ssnr = compute_ssnr(z, fs, cfg)
    assert ssnr > 10  # significant in-band

    # Out-of-band tone at 40 brpm = 0.667 Hz
    z2 = np.exp(1j * 0.5 * np.sin(2*np.pi*0.667*t))
    ssnr2 = compute_ssnr(z2, fs, cfg)
    assert ssnr2 < ssnr  # out-of-band power reduces SSNR