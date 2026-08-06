"""
CSI UDP receiver.

Parses packets sent by the ESP32 acquisition node (main.py on the ESP32
side) and turns them into CSIPacket objects with per-subcarrier amplitude
already extracted, ready for the DSP pipeline.

IMPORTANT: HEADER_FMT here must exactly match the ESP32 firmware's
HEADER_FMT. If you change one, change both.
"""

from dataclasses import dataclass, field
from queue import Queue
import math
import struct

from scapy.all import sniff
from scapy.layers.inet import UDP


# seq(u32), timestamp_us(u32), channel(u16), rssi(i8 SIGNED), payload_len(u8)
# Must match the ESP32 firmware's HEADER_FMT exactly.
HEADER_FMT = "<IIHbB"
HEADER_SIZE = struct.calcsize(HEADER_FMT)

NUM_SUBCARRIERS = 64  # HT20


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


class CSIReceiver:
    def __init__(self, interface, port=5005, queue_size=2048):
        self.port = port
        self.interface = interface
        self.queue = Queue(maxsize=queue_size)

        # Simple loss tracking (not thread-safe-critical, just diagnostic)
        self._last_seq = None
        self.dropped = 0
        self.received = 0

    def _handle_packet(self, pkt):
        if UDP not in pkt:
            return

        udp = pkt[UDP]
        if udp.dport != self.port:
            return

        payload = bytes(udp.payload)
        if len(payload) < HEADER_SIZE:
            return

        seq, ts, channel, rssi, length = struct.unpack(
            HEADER_FMT, payload[:HEADER_SIZE]
        )

        csi_raw = payload[HEADER_SIZE:HEADER_SIZE + length]
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

        packet = CSIPacket(seq, ts, channel, rssi, length, csi_raw, amplitudes)

        try:
            self.queue.put_nowait(packet)
        except Exception:
            # Queue full - drop rather than block the sniffer callback
            pass

    def start(self):
        """Blocking sniff loop. Prefer AsyncSniffer + this as prn if you
        need the main thread free (see main.py)."""
        sniff(
            iface=self.interface,
            prn=self._handle_packet,
            store=False,
            filter=f"udp port {self.port}",
        )

    def recv(self, timeout=None):
        return self.queue.get(timeout=timeout)
