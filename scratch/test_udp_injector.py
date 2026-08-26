import socket
import struct
import time
import math
import random

# HEADER_FMT: seq(u32), ts(u32), chan(u16), rssi(i8), len(u8)
HEADER_FMT = "<IIHbB"
# ODOM_FMT: ticksL(i32), ticksR(i32), ax,ay,az,gx,gy,gz(i16 x6), mpu_ok(u8)
ODOM_FMT = "<iihhhhhhB"

PORT = 5005
DEST = ("127.0.0.1", PORT)

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

print("Starting UDP injection to port 5005...")

seq = 0
start_time = time.time()

# Calibration needs ~13 seconds of data at 20pps (260 packets), plus 50 packets to stabilize.
# So around 350 packets total for calibration, then more for the live run.
# NBVI requires "quiet room" data: variance must be low, meaning CSI amplitudes should be mostly constant with some small noise.
base_amplitudes = [random.randint(50, 150) for _ in range(64)]

try:
    while True:
        # Generate some synthetic CSI (quiet/low variance)
        csi_bytes = bytearray(128)
        for i in range(64):
            # Q and I values such that sqrt(Q^2 + I^2) is around base_amplitudes[i]
            amp = base_amplitudes[i] + random.uniform(-2, 2)
            # just make Q = amp, I = 0 for simplicity (ensure fit in int8)
            q = int(amp)
            if q > 127: q = 127
            if q < -128: q = -128
            # pack as Q0, I0 ...
            # To represent signed int8 in struct/bytes:
            q_byte = q & 0xFF
            csi_bytes[2*i] = q_byte
            csi_bytes[2*i + 1] = 0 # I = 0

        ts = int((time.time() - start_time) * 1e6)
        
        # Pack header
        header = struct.pack(HEADER_FMT, seq, ts, 1, -50, 128)
        
        # Pack odom (fake movement over time)
        ticks_l = seq
        ticks_r = seq
        odom = struct.pack(ODOM_FMT, ticks_l, ticks_r, 0, 0, 0, 0, 0, 0, 1)
        
        payload = header + odom + csi_bytes
        sock.sendto(payload, DEST)
        
        seq += 1
        time.sleep(0.05) # ~20 pps
        if seq % 50 == 0:
            print(f"Sent {seq} packets...")

except KeyboardInterrupt:
    print("Stopped UDP injection.")
finally:
    sock.close()
