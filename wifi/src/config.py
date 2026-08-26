import sys

# WiFi Configuration
WIFI_SSID = "YourSSID"
WIFI_PASSWORD = "YourPassword"
LOCAL_IP = "192.168.x.x"
UDP_PORT = 5005
# WIFI_BSSID = "AA:BB:CC:DD:EE:FF"

# Traffic Generator Configuration
# Generates WiFi traffic to ensure continuous CSI data
TRAFFIC_GENERATOR_RATE = 20  # Default rate (packets per second, recommended: 100)
TRAFFIC_GENERATOR_MODE = "ping"  # Default mode: "ping" or "dns"
PUBLISH_INTERVAL = 100        # Packets between periodic MQTT/log updates
EVALUATION_INTERVAL = 25      # Packets between internal detector evaluations
MOTION_ON_HITS = 3            # Consecutive evaluated hits required for IDLE -> MOTION
MOTION_OFF_HITS = 3           # Consecutive evaluated hits required for MOTION -> IDLE

# CSI Configuration
CSI_BUFFER_SIZE = 8  # Circular buffer size (used to store csi packets until processed)

# Gain Lock Configuration
# Controls AGC/FFT gain locking for stable CSI amplitudes
# Modes: "auto" (skip if signal too strong), "enabled" (always lock), "disabled" (never lock)
GAIN_LOCK_PACKETS = 300  # ~3 seconds at 100 Hz
GAIN_LOCK_MODE = "auto"       # Recommended: "auto" - skips gain lock if AGC < 30
GAIN_LOCK_MIN_SAFE_AGC = 30   # Minimum safe AGC value (below this, gain lock is skipped in auto mode)

# HT20 Constants (64 subcarriers - do not change)
NUM_SUBCARRIERS = 64           # HT20: 64 subcarriers
EXPECTED_CSI_LEN = 128         # 64 SC × 2 bytes (I/Q pairs)

# Optional local overrides (config_local.py is gitignored)
# Skip local overrides only under pytest to keep tests hermetic.
if "pytest" not in sys.modules:
    try:
        import src.config_local as _local
        for _name in dir(_local):
            if _name.isupper():
                globals()[_name] = getattr(_local, _name)
    except ImportError:
        pass
