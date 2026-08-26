from dataclasses import dataclass, field
from queue import Queue
import math
import socket
import struct


# seq(u32), timestamp_us(u32), channel(u16), rssi(i8 SIGNED), payload_len(u8)
# Must match the ESP32 firmware's HEADER_FMT exactly.
HEADER_FMT = "<IIHbB"
HEADER_SIZE = struct.calcsize(HEADER_FMT)

# ticksL(i32), ticksR(i32), ax,ay,az,gx,gy,gz(i16 x6), mpu_ok(u8)
# Must match the ESP32 firmware's ODOM_FMT exactly. The firmware does NOT
# send a "fresh" bit on the wire -- odometry updates at ~10Hz while CSI can
# arrive faster, so the same odom block gets repeated across several CSI
# packets. We derive freshness here by diffing against the previous sample.
# Wire layout is [header][odom_block][csi_data], matching main.py.
ODOM_FMT = "<iihhhhhhB"
ODOM_SIZE = struct.calcsize(ODOM_FMT)

NUM_SUBCARRIERS = 64  # HT20


@dataclass(slots=True)
class OdomSample:
    ticks_l: int
    ticks_r: int
    ax: int
    ay: int
    az: int
    gx: int
    gy: int
    gz: int
    mpu_ok: bool
    fresh: bool  # False if this is a repeat of the last sample sent (odom is slower than CSI rate)


def extract_amplitudes(csi_bytes: bytes) -> list[float]:
    """
    Convert raw HT20 CSI bytes into per-subcarrier amplitude.

    Espressif format is [Q0, I0, Q1, I1, ...] int8 pairs (imaginary first,
    real second, per subcarrier). |H| = sqrt(I^2 + Q^2).

    Returns a list of length NUM_SUBCARRIERS (or fewer, if csi_bytes is
    short -- callers should check len() before indexing a fixed band).
    """
    n_pairs = len(csi_bytes) // 2
    amps = [0.0] * n_pairs
    for i in range(n_pairs):
        q = csi_bytes[2 * i]
        im = csi_bytes[2 * i + 1]
        # bytes are unsigned 0-255 on the wire; normalize_ht20_csi_payload()
        # on the ESP32 side already packs them as int8 range, so re-sign here
        if q > 127:
            q -= 256
        if im > 127:
            im -= 256
        amps[i] = math.sqrt(im * im + q * q)
    return amps


@dataclass(slots=True)
class CSIPacket:
    seq: int
    timestamp: int
    channel: int
    rssi: int
    length: int
    csi_raw: bytes
    amplitudes: list = field(default_factory=list)
    odom: OdomSample | None = None


class CSIReceiver:
    def __init__(self, interface, port=5005, queue_size=2048):
        self.port = port
        self.interface = interface
        self.queue = Queue(maxsize=queue_size)

        # Simple loss tracking (not thread-safe-critical, just diagnostic)
        self._last_seq = None
        self.dropped = 0
        self.received = 0

        # Last raw odom tuple seen (sans freshness), used to detect repeats
        # across packets since the firmware doesn't send a freshness bit.
        self._last_odom_raw = None

        self._sock = None
        self._running = False

    def _handle_datagram(self, payload):
        if len(payload) < HEADER_SIZE + ODOM_SIZE:
            return

        seq, ts, channel, rssi, length = struct.unpack(
            HEADER_FMT, payload[:HEADER_SIZE]
        )

        # Odom block sits right after the header; CSI payload follows it.
        odom_offset = HEADER_SIZE
        csi_offset = HEADER_SIZE + ODOM_SIZE

        odom_bytes = payload[odom_offset:csi_offset]
        odom_fields = struct.unpack(ODOM_FMT, odom_bytes)
        ticks_l, ticks_r, ax, ay, az, gx, gy, gz, mpu_ok = odom_fields

        fresh = odom_fields != self._last_odom_raw
        self._last_odom_raw = odom_fields

        odom = OdomSample(ticks_l, ticks_r, ax, ay, az, gx, gy, gz,
                           bool(mpu_ok), fresh)

        csi_raw = payload[csi_offset:csi_offset + length]
        if len(csi_raw) < length:
            # Truncated packet (fragmentation/loss mid-payload) - skip it
            return

        if self._last_seq is not None:
            gap = (seq - self._last_seq) & 0xFFFFFFFF
            if gap > 1:
                self.dropped += gap - 1
        self._last_seq = seq
        self.received += 1

        amplitudes = extract_amplitudes(csi_raw)

        packet = CSIPacket(seq, ts, channel, rssi, length, csi_raw, amplitudes, odom)

        try:
            self.queue.put_nowait(packet)
        except Exception:
            # Queue full - drop rather than block the sniffer callback
            pass

    def start(self):
        """Blocking UDP recv loop. Run in a background thread if you need
        the main thread free (see main.py)."""
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if self.interface:
            try:
                self._sock.setsockopt(
                    socket.SOL_SOCKET, socket.SO_BINDTODEVICE,
                    self.interface.encode() + b"\0",
                )
            except (AttributeError, OSError) as e:
                # SO_BINDTODEVICE is Linux-only and needs root; fall back to
                # binding all interfaces if it's unavailable/unprivileged.
                print(f"SO_BINDTODEVICE failed ({e}); binding 0.0.0.0 instead")
        self._sock.bind(("0.0.0.0", self.port))

        self._running = True
        while self._running:
            try:
                payload, _addr = self._sock.recvfrom(65535)
            except OSError:
                break  # socket closed via stop()
            self._handle_datagram(payload)

    def stop(self):
        self._running = False
        if self._sock is not None:
            self._sock.close()

    def recv(self, timeout=None):
        return self.queue.get(timeout=timeout)
