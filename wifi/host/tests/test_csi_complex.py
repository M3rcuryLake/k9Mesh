import numpy as np

from breath.csi_complex import (
    IQ_ORDER,
    IQ_ORDER_CALIBRATED,
    NUM_SUBCARRIERS,
    build_complex_csi,
    parse_complex_csi,
    valid_subcarrier_mask,
)
from receiver import CSIPacket, extract_amplitudes


def test_parse_matches_magnitude_of_legacy_path():
    rng = np.random.default_rng(7)
    raw = bytes(rng.integers(0, 256, size=128, dtype=np.uint8))
    H = parse_complex_csi(raw)
    amps = extract_amplitudes(raw)
    assert np.allclose(np.abs(H), amps, atol=1e-4)


def test_parse_iq_order_iq():
    raw = bytes([1, 2] * 64)  # I=1, Q=2 under "IQ"
    H = parse_complex_csi(raw, iq_order="IQ")
    assert abs(H[0] - (1 + 2j)) < 1e-6
    # Swapped order rotates every bin by +90 deg (j * conj).
    H_swapped = parse_complex_csi(raw, iq_order="QI")
    assert np.allclose(H_swapped, 1j * np.conj(H))


def test_parse_partial_payload_zero_pads():
    raw = bytes([1, 2] * 10)
    H = parse_complex_csi(raw)
    assert len(H) == NUM_SUBCARRIERS
    assert np.all(H[10:] == 0)


def test_valid_mask_excludes_guards_dc_and_zero_bins():
    H = np.full(NUM_SUBCARRIERS, 5 + 5j)
    H[[0, 5, 32, 60]] = 0
    mask = valid_subcarrier_mask(H)
    assert mask.sum() == 40
    assert not mask[0] and not mask[5] and not mask[32] and not mask[60]
    assert mask[11] and mask[31] and mask[33] and mask[51]


def test_packet_lazy_complex_csi():
    raw = bytes([1, 2] * 64)
    p = CSIPacket(1, 100, 3, -60, 128, raw, extract_amplitudes(raw))
    cc = p.complex_csi()
    assert cc is p.complex_csi()  # cached
    assert np.allclose(np.abs(cc.H), p.amplitudes, atol=1e-4)
    assert cc.remap_tag is None
    assert cc.iq_order == IQ_ORDER


def test_iq_order_flagged_uncalibrated():
    # Guard so nobody downstream trusts phase before running
    # tools/calibrate_iq.py against hardware.
    assert IQ_ORDER_CALIBRATED is False
