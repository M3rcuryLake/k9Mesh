HT20_CSI_LEN = 128
HT20_CSI_LEN_SHORT = 114
HT20_CSI_LEN_SHORT_DOUBLE = 228
HT20_CSI_SHORT_LEFT_PAD = 8
HT20_CSI_SHORT_COPY_END = HT20_CSI_SHORT_LEFT_PAD + HT20_CSI_LEN_SHORT
HT20_CSI_SHORT_RIGHT_PAD = HT20_CSI_LEN - HT20_CSI_SHORT_COPY_END
HT20_CSI_SHORT_LEFT_ZEROS = b"\x00" * HT20_CSI_SHORT_LEFT_PAD
HT20_CSI_SHORT_RIGHT_ZEROS = b"\x00" * HT20_CSI_SHORT_RIGHT_PAD


def normalize_ht20_csi_payload(csi_data, expected_len=128, chip_type=None, remap_buffer=None):
    """
    Normalize CSI payload length to HT20 expected layout.

    Handles:
    - Doubled HT payload (2x expected): keep first HT-LTF block
    - Doubled short HT payload (228 bytes): collapse to 114 bytes
    - Short HT payload (114 bytes): remap to 128 bytes with guard padding

    Args:
        csi_data: Raw CSI payload (bytes/bytearray)
        expected_len: Target HT20 payload length (default: 128)
        chip_type: Optional chip hint ('C5', 'ESP32-C5', etc.)
        remap_buffer: Optional pre-allocated bytearray(expected_len) reused by caller

    Returns:
        tuple: (normalized_payload, raw_len, remap_tag)
            - normalized_payload: bytes-like object or None if unsupported length
            - raw_len: original payload length
            - remap_tag: None | 'double_ht20' | 'double_ht57_and_remap' | 'ht57_to_64'
    """
    raw_len = len(csi_data)
    input_len = raw_len

    # STBC workaround: two HT-LTF blocks, keep first 64 SC (HT20).
    if raw_len == expected_len * 2:
        return csi_data[:expected_len], input_len, 'double_ht20'

    if raw_len == expected_len:
        return csi_data, input_len, None

    # Best-effort fallback for short HT estimates:
    # - 228 bytes can represent 2 x 114-byte short HT blocks (collapse to first block)
    # - 114 bytes represents 57 complex samples that we remap to HT20 (128 bytes)
    if expected_len != HT20_CSI_LEN:
        return None, input_len, None

    short_double_collapsed = False
    if raw_len == HT20_CSI_LEN_SHORT_DOUBLE:
        csi_data = csi_data[:HT20_CSI_LEN_SHORT]
        raw_len = HT20_CSI_LEN_SHORT
        short_double_collapsed = True

    if raw_len == HT20_CSI_LEN_SHORT:
        if remap_buffer is None or len(remap_buffer) != expected_len:
            remap_buffer = bytearray(expected_len)

        # Clear left/right guard bins and copy payload in the middle.
        remap_buffer[:HT20_CSI_SHORT_LEFT_PAD] = HT20_CSI_SHORT_LEFT_ZEROS
        remap_buffer[HT20_CSI_SHORT_COPY_END:] = HT20_CSI_SHORT_RIGHT_ZEROS
        remap_buffer[HT20_CSI_SHORT_LEFT_PAD:HT20_CSI_SHORT_COPY_END] = csi_data
        if short_double_collapsed:
            return remap_buffer, input_len, 'double_ht57_and_remap'
        return remap_buffer, input_len, 'ht57_to_64'

    return None, input_len, None


def to_signed_int8(value):
    return value if value < 128 else value - 256


def calculate_median(values):
    if not values:
        return 0
    values.sort()
    n = len(values)
    if n % 2 == 0:
        return (values[n // 2 - 1] + values[n // 2]) // 2
    return values[n // 2]
