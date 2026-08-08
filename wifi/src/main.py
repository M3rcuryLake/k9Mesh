import struct
import socket
import network
import time
import esp32
import gc
import os
from src.traffic_generator import TrafficGenerator
import src.config as config

# Gain lock configuration
GAIN_LOCK_PACKETS = 300  # ~3 seconds at 100 Hz

UDP_IP = config.LOCAL_IP     # <-- DYNAMIC LATER
UDP_PORT = 5005

HEADER_FMT = "<IIHBB"
HEADER_SIZE = struct.calcsize(HEADER_FMT)

# Import HT20 constants from config
from src.config import NUM_SUBCARRIERS, EXPECTED_CSI_LEN, SEG_THRESHOLD
from src.utils import to_signed_int8, calculate_median, normalize_ht20_csi_payload

# Global state for calibration mode and performance metrics
class GlobalState:
    def __init__(self):
        self.calibration_mode = False  # Flag to suspend main loop during calibration
        self.loop_time_us = 0  # Last loop iteration time in microseconds
        self.chip_type = None  # Detected chip type (S3, C6, etc.)
        self.current_channel = 0  # Track WiFi channel for change detection
        # CV normalization state (when gain lock is skipped or disabled)
        self.needs_cv_normalization = False


g_state = GlobalState()

def cleanup_wifi(wlan):
    """
    Force cleanup of WiFi/CSI state.

    Handles stale state from previous interrupted runs (e.g., Ctrl+C without proper cleanup).
    Safe to call even if WiFi/CSI is not active.

    Args:
        wlan: WLAN instance
    """
    if not wlan.active():
        return

    print("Forcing WiFi/CSI cleanup...")

    # Disable CSI first (may fail if not enabled, that's ok)
    try:
        wlan.csi_disable()
    except Exception:
        pass

    # Disconnect if connected
    if wlan.isconnected():
        wlan.disconnect()

    # Deactivate interface
    wlan.active(False)
    time.sleep(1)  # Wait for hardware to settle


def print_wifi_status(wlan):
    """Print WiFi connection status with configuration details."""
    ip = wlan.ifconfig()[0]

    # Protocol decode (HT20 only: 802.11b/g/n)
    PROTOCOL_NAMES = {
        network.MODE_11B: 'b',
        network.MODE_11G: 'g',
        network.MODE_11N: 'n',
    }

    proto_val = wlan.config('protocol')
    modes = [name for bit, name in PROTOCOL_NAMES.items() if proto_val & bit]
    protocol_str = '802.11' + '/'.join(modes) if modes else f'0x{proto_val:02x}'

    # Bandwidth decode (HT20 only)
    bw_str = 'HT20' if wlan.config('bandwidth') == wlan.BW_HT20 else 'unknown'

    # Promiscuous
    prom_str = 'ON' if wlan.config('promiscuous') else 'OFF'

    print(f"WiFi connected - IP: {ip}, Protocol: {protocol_str}, Bandwidth: {bw_str}, Promiscuous: {prom_str}")

def connect_wifi():
    """Connect to WiFi"""

    print(f"Activating WiFi interface...")

    gc.collect()
    wlan = network.WLAN(network.STA_IF)

    # Force cleanup of any stale state from previous interrupted run
    cleanup_wifi(wlan)

    wlan.active(True)
    if not wlan.active():
        raise Exception("WiFi failed to activate")

    # Wait for hardware initialization
    time.sleep(2)

    # Dual-band targets (e.g. ESP32-C5/C6): force 2.4GHz for stable CSI capture.
    try:
        wlan.config(band_mode=wlan.BAND_MODE_2G_ONLY)
    except Exception:
        # Legacy/single-band firmware may not expose band_mode.
        pass

    # Configure WiFi protocol
    # Force WiFi 4 (802.11b/g/n) only to get 64 subcarriers
    wlan.config(protocol=network.MODE_11B | network.MODE_11G | network.MODE_11N)
    wlan.config(bandwidth=wlan.BW_HT20)          # HT20 for stable CSI
    wlan.config(promiscuous=False)               # CSI from connected AP only

    # Enable CSI after WiFi is stable
    wlan.csi_enable(buffer_size=config.CSI_BUFFER_SIZE)

    # Connect (optionally locked to a specific BSSID)
    bssid_hex = getattr(config, 'WIFI_BSSID', None)
    bssid = None
    if bssid_hex:
        # Accept "AABBCCDDEEFF" or "AA:BB:CC:DD:EE:FF"
        bssid_clean = bssid_hex.replace(':', '').replace('-', '')
        if len(bssid_clean) == 12:
            bssid = bytes.fromhex(bssid_clean)
    bssid_info = f" (BSSID: {bssid_hex})" if bssid else ""
    print(f"Connecting to WiFi{bssid_info}...")
    wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD, bssid=bssid)

    # Wait for connection
    timeout = 30
    while not wlan.isconnected() and timeout > 0:
        time.sleep(1)
        timeout -= 1

    if wlan.isconnected():
        print_wifi_status(wlan)
        # Disable power management
        wlan.config(pm=wlan.PM_NONE)
        # Stabilization
        time.sleep(1)
        return wlan
    else:
        raise Exception("Connection timeout")

def run_gain_lock(wlan):
    """
    Run gain lock calibration phase (ESP32-S3, C3, C5, C6 only)

    Collects AGC/FFT gain values from first packets and locks them
    to stabilize CSI amplitudes for consistent motion detection.
    Uses median calculation for robustness against outliers.

    HT20 only: 64 subcarriers.

    Respects config.GAIN_LOCK_MODE:
    - "auto": Lock gain, but skip if signal too strong (AGC < MIN_SAFE_AGC)
    - "enabled": Always force gain lock
    - "disabled": No gain lock, use CV normalization

    Args:
        wlan: WLAN instance with CSI enabled

    Returns:
        tuple: (agc_gain, fft_gain, needs_cv_normalization) where:
            - needs_cv_normalization=True if gain lock was skipped/disabled
    """
    # Check configuration mode
    mode = getattr(config, 'GAIN_LOCK_MODE', 'auto').lower()
    min_safe_agc = getattr(config, 'GAIN_LOCK_MIN_SAFE_AGC', 30)

    # Check platform support
    gain_lock_supported = hasattr(wlan, 'csi_gain_lock_supported') and wlan.csi_gain_lock_supported()

    if not gain_lock_supported:
        print(f"Gain lock: Not supported on this platform")
        print(f"  HT20 mode: {NUM_SUBCARRIERS} subcarriers")
        print("  CV normalization enabled")
        # No hardware gain lock support -> must use CV normalization.
        return None, None, True

    print('')
    print('-'*60)
    print(f'Gain Lock Calibration (~3 seconds) [mode: {mode}]')
    print('-'*60)

    # Collect samples for median calculation
    agc_samples = []
    fft_samples = []
    count = 0

    while count < GAIN_LOCK_PACKETS:
        frame = wlan.csi_read()
        if frame:
            # frame[22] = agc_gain (uint8), frame[23] = fft_gain (int8 as uint8)
            agc_samples.append(frame[22])
            fft_samples.append(to_signed_int8(frame[23]))

            del frame  # Free memory immediately
            count += 1

            # Progress every 25% (with GC to prevent ENOMEM)
            if count == GAIN_LOCK_PACKETS // 4:
                gc.collect()
                print(f"  Gain calibration 25% ({count}/{GAIN_LOCK_PACKETS} packets)")
            elif count == GAIN_LOCK_PACKETS // 2:
                gc.collect()
                print(f"  Gain calibration 50% ({count}/{GAIN_LOCK_PACKETS} packets)")
            elif count == (GAIN_LOCK_PACKETS * 3) // 4:
                gc.collect()
                print(f"  Gain calibration 75% ({count}/{GAIN_LOCK_PACKETS} packets)")

    # Calculate medians (more robust than mean against outliers)
    median_agc = calculate_median(agc_samples)
    median_fft = calculate_median(fft_samples)

    print(f"  HT20 mode: {NUM_SUBCARRIERS} subcarriers")

    # Handle different modes
    if mode == 'disabled':
        # DISABLED mode: no gain lock, use CV normalization
        print(f"Gain baseline: AGC={median_agc}, FFT={median_fft} (no lock, CV normalization enabled)")
        return median_agc, median_fft, True

    # In auto mode, skip gain lock if signal is too strong
    if mode == 'auto' and median_agc < min_safe_agc:
        print(f"WARNING: Signal too strong (AGC={median_agc} < {min_safe_agc}) - skipping gain lock")
        print(f"         Move sensor 2-3 meters from AP for optimal performance")
        print(f"         CV normalization enabled (baseline: AGC={median_agc}, FFT={median_fft})")
        return median_agc, median_fft, True

    # Lock the gain values
    wlan.csi_force_gain(median_agc, median_fft)
    print(f"Gain locked: AGC={median_agc}, FFT={median_fft} (median of {GAIN_LOCK_PACKETS} packets)")

    return median_agc, median_fft, False


def get_chip_type():
    """Extract short chip type from os.uname().machine."""
    machine = os.uname().machine.upper()
    # Check for specific variants first
    for variant in ['S3', 'S2', 'C3', 'C5', 'C6']:
        if variant in machine:
            return variant
    # Fallback to ESP32 base
    if 'ESP32' in machine:
        return 'ESP32'
    return machine


def main():
    print("CSI Streamer")

    g_state.chip_type = get_chip_type()
    print("Chip:", g_state.chip_type)

    wlan = connect_wifi()

    traffic_gen = TrafficGenerator(
        mode=config.TRAFFIC_GENERATOR_MODE
    )

    if not traffic_gen.start(config.TRAFFIC_GENERATOR_RATE):
        raise RuntimeError("Failed to start traffic generator")

    run_gain_lock(wlan)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    DEST = (UDP_IP, UDP_PORT)
    print("Streaming to", DEST)
    HEADER_SIZE = struct.calcsize(HEADER_FMT)
    TX_SIZE = HEADER_SIZE + EXPECTED_CSI_LEN
    tx_buffer = bytearray(TX_SIZE)

    seq = 0
    ht57_remap_buffer = bytearray(EXPECTED_CSI_LEN)

    try:
        while True:
            frame = wlan.csi_read()
            if frame is None:
                continue

            csi_data, raw_len, remap_tag = normalize_ht20_csi_payload(
                frame[5],
                EXPECTED_CSI_LEN,
                remap_buffer=ht57_remap_buffer
            )

            if csi_data is None:
                continue

            timestamp = time.ticks_us()
            channel = frame[1]
            rssi = frame[0]

            struct.pack_into(
                HEADER_FMT,
                tx_buffer,
                0,
                seq,
                timestamp,
                channel,
                rssi & 0xff,
                EXPECTED_CSI_LEN
            )

            tx_buffer[
                HEADER_SIZE:
                HEADER_SIZE + EXPECTED_CSI_LEN
            ] = csi_data

            print(len(tx_buffer))
            print(DEST)
            sock.sendto(tx_buffer, DEST)
            heap_info = esp32.idf_heap_info(esp32.HEAP_DATA)
            time.sleep_ms(20)

            # Each item is a 4-tuple: (total_bytes, free_bytes, largest_free_block, min_free_ever)
            for i, h in enumerate(heap_info):
                print(f"Heap region {i}:")
                print(f"  Total bytes:        {h[0]}")
                print(f"  Free bytes:         {h[1]}")
                print(f"  Largest free block: {h[2]}")
                print(f"  Min free ever:      {h[3]}")

            if (seq & 0x3F) == 0:
                print(
                    "SEQ:",
                    seq,
                    "Heap:",
                    gc.mem_free()
                )

            seq += 1

    except KeyboardInterrupt:
        print("Stopping")

    finally:
        traffic_gen.stop()
        cleanup_wifi(wlan)
        sock.close()

if __name__ == '__main__':
    main()
