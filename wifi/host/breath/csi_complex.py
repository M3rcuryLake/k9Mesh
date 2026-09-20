"""
csi_complex.py

Complex-valued CSI parsing for the respiration pipeline.

The existing receiver only ever reduces raw CSI bytes to per-subcarrier
*MAGNITUDE* (see receiver.extract_amplitudes). Respiration sensing needs
both amplitude and phase, so this module parses the same HT20 payload
into complex values WITHOUT touching the legacy path.

Wire format (ESP32-S3 firmware, wifi/src/main.py):
    csi payload = 64 subcarriers x 2 int8 bytes (HT20, one HT-LTF field)
    byte order per subcarrier: see IQ_ORDER below.

IMPORTANT -- IQ_ORDER is calibrated, not assumed:
    The legacy comment in receiver.py claims "[Q0, I0, ...] imaginary
    first" but its variable naming contradicts that. Magnitude is
    invariant to the order; phase is NOT. IQ_ORDER is resolved
    empirically by wifi/host/tools/calibrate_iq.py (static stream =>
    per-subcarrier phase variance ~0 for the correct order). Until that
    calibration has been run against hardware, the default follows
    Espressif's documented convention (I first, Q second) and is flagged
    UNCALIBRATED via IQ_ORDER_CALIBRATED = False.

Subcarrier validity:
    HT20 array layout is 64 bins. Usable bins follow csi_dsp's constants:
        guards:   0-10 and 52-63
        DC:       32
        usable:   11..51 excluding 32  (41 bins)
    The firmware's normalize_ht20_csi_payload() zero-pads short (57-bin)
    payloads into the 64-bin layout; those zeroed bins fall inside the
    guard region, so the usable mask is the same for all remap_tags.
    The zero bins ARE still checked numerically in parse_complex_csi.

Physical subcarrier indices:
    Array indices are NOT physical subcarrier numbers (the remapped
    57-bin case in particular scrambles the mapping). Until a firmware
    calibration pins the array->physical map, physical_index is the
    identity array and PHYSICAL_INDEX_CALIBRATED = False. The CSCR
    stage must treat pair metadata through this map, not raw positions.
"""

from dataclasses import dataclass

import numpy as np

from csi_dsp import GUARD_BAND_LOW, GUARD_BAND_HIGH, DC_SUBCARRIER

NUM_SUBCARRIERS = 64

# "IQ":  I = csi_bytes[2*i],     Q = csi_bytes[2*i + 1]   (Espressif convention)
# "QI":  Q = csi_bytes[2*i],     I = csi_bytes[2*i + 1]
IQ_ORDER = "IQ"

# Set True only after tools/calibrate_iq.py confirms the order against
# a live static capture. Keeps the pipeline honest about what is measured
# versus assumed.
IQ_ORDER_CALIBRATED = False

# Same story for the array -> physical subcarrier map.
PHYSICAL_INDEX_CALIBRATED = False


def _signed_int8_view(csi_bytes) -> np.ndarray:
    """Raw bytes -> int8 view without copying the sign logic per element."""
    return np.frombuffer(bytes(csi_bytes), dtype=np.int8)


def parse_complex_csi(csi_bytes, iq_order: str = IQ_ORDER) -> np.ndarray:
    """Parse a raw HT20 CSI payload into complex64[64].

    Magnitude of the result equals receiver.extract_amplitudes() output
    for the same bytes (order-invariant), so the two representations can
    be cross-checked in tests.
    """
    raw = _signed_int8_view(csi_bytes)
    n_pairs = len(raw) // 2
    if n_pairs == 0:
        return np.zeros(NUM_SUBCARRIERS, dtype=np.complex64)
    if iq_order == "IQ":
        real, imag = raw[0 : 2 * n_pairs : 2].astype(np.float32), raw[1 : 2 * n_pairs : 2].astype(np.float32)
    elif iq_order == "QI":
        imag, real = raw[0 : 2 * n_pairs : 2].astype(np.float32), raw[1 : 2 * n_pairs : 2].astype(np.float32)
    else:
        raise ValueError(f"unknown IQ order: {iq_order!r}")
    csi = (real + 1j * imag).astype(np.complex64)
    if n_pairs < NUM_SUBCARRIERS:
        csi = np.concatenate([csi, np.zeros(NUM_SUBCARRIERS - n_pairs, dtype=np.complex64)])
    return csi


def valid_subcarrier_mask(H: np.ndarray, zero_floor: float = 1e-9) -> np.ndarray:
    """Boolean[64]: True for numerically live, non-guard, non-DC bins.

    Guards/DC are excluded by the HT20 constants; bins whose magnitude is
    effectively zero (e.g. firmware zero-padding for remapped short
    payloads) are excluded as well.
    """
    mask = np.zeros(len(H), dtype=bool)
    mask[GUARD_BAND_LOW:GUARD_BAND_HIGH] = True
    mask[DC_SUBCARRIER] = False
    mask &= np.abs(H) > zero_floor
    return mask


def physical_index_map(n: int = NUM_SUBCARRIERS) -> np.ndarray:
    """Array index -> physical subcarrier number.

    IDENTITY PLACEHOLDER until firmware calibration pins the real map
    (especially for remap_tag='ht57_to_64'). Downstream pair metadata
    goes through this function so a future calibration is a one-line fix.
    """
    return np.arange(n, dtype=np.int32)


@dataclass(slots=True)
class ComplexCSI:
    """Parsed complex CSI for one packet."""
    H: np.ndarray                # complex64[64], array-index order
    valid_mask: np.ndarray       # bool[64]
    physical_index: np.ndarray   # int[64]
    remap_tag: str | None        # None | 'double_ht20' | 'double_ht57_and_remap' | 'ht57_to_64'
    iq_order: str                # "IQ" | "QI"


def build_complex_csi(csi_bytes, remap_tag: str | None, iq_order: str = IQ_ORDER) -> ComplexCSI:
    """Full parse: complex values + validity + metadata for one packet."""
    H = parse_complex_csi(csi_bytes, iq_order=iq_order)
    return ComplexCSI(
        H=H,
        valid_mask=valid_subcarrier_mask(H),
        physical_index=physical_index_map(),
        remap_tag=remap_tag,
        iq_order=iq_order,
    )
