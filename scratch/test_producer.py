#!/usr/bin/env python3
"""
K9Mesh Micro-ESPectre Live Telemetry Producer
---------------------------------------------
Transmits live deterministic Micro-ESPectre CSI transport packets
to the K9Mesh Electron WebSocketTelemetrySource (ws://127.0.0.1:8080).

Standard Backend Schema:
{
  "seq": 11708,
  "timestamp_us": 959410021,
  "channel": 5,
  "rssi": -61,
  "dropped": 6,
  "band": [11, 13, 15, 17, 20, 22, 24, 26, 28, 46, 49, 51],
  "mvs": {
    "state": "motion",
    "variance": 0.00029454899195013005,
    "threshold": 0.00017719074199497816,
    "confidence": 83.1163605484755
  },
  "ml": {
    "ready": true,
    "score": null,
    "motion": null,
    "enabled": false
  }
}
"""

import argparse
import asyncio
import json
import signal
import sys
import time
import websockets

DEFAULT_WS_URI = "ws://127.0.0.1:8080"


def generate_micro_espectre_packet(seq: int, motion_mode: bool = True) -> dict:
    """Generates the authoritative Phase 10 Micro-ESPectre live sensing packet."""
    now_us = int(time.time() * 1_000_000)
    
    return {
        "seq": seq,
        "timestamp_us": now_us,
        "channel": 5,
        "rssi": -61,
        "channel": 11,
        "rssi": -30,
        "dropped": 4,
        "band": [11, 13, 15, 17, 20, 22, 24, 26, 28, 46, 49, 51],
        "mvs": {
            "state": "STABLE",
            "variance": 0.0055,
            "threshold": 0.0011,
            "confidence": 99.8877
        },
        "ml": {
            "ready": True,
            "score": None,
            "motion": None,
            "enabled": True
        }
    }


async def stream_telemetry(uri: str, rate_hz: float, max_count: int | None, motion_mode: bool):
    interval_s = 1.0 / rate_hz
    seq = 11708
    running = True

    print("==================================================================")
    print(" K9Mesh Micro-ESPectre Live Telemetry Producer (Phase 10)")
    print("==================================================================")
    print(f"[*] Target WebSocket URI:  {uri}")
    print(f"[*] Frequency:             {rate_hz} Hz ({interval_s * 1000:.1f} ms interval)")
    print(f"[*] Motion State:          {'MOTION (83.1% Conf)' if motion_mode else 'STABLE (12.5% Conf)'}")
    print(f"[*] Packet Target:         {max_count if max_count else 'Continuous Stream (Ctrl+C to exit)'}")
    print("==================================================================\n")

    while running:
        try:
            print(f"[*] Connecting to {uri}...")
            async with websockets.connect(uri) as ws:
                print(f"[+] Successfully connected to K9Mesh Ground Control Station!\n")
                
                while running:
                    packet = generate_micro_espectre_packet(seq, motion_mode)
                    payload = json.dumps(packet)
                    await ws.send(payload)
                    
                    if seq % 10 == 8 or seq <= 11712:
                        print(f"  -> [TX] Seq #{seq:05d} | State: {packet['mvs']['state']:<6} | Conf: {packet['mvs']['confidence']:.1f}% | RSSI: {packet['rssi']} dBm")
                    
                    seq += 1
                    if max_count is not None and (seq - 11708) >= max_count:
                        print(f"\n[+] Reached target packet count ({max_count}). Producer exiting cleanly.")
                        return

                    await asyncio.sleep(interval_s)

        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError) as e:
            print(f"[-] Connection unavailable ({e.__class__.__name__}). Retrying in 1.0s...")
            await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            print("\n[*] Received shutdown signal. Closing client.")
            break
        except Exception as e:
            print(f"[-] Transport error: {e}. Retrying in 1.0s...")
            await asyncio.sleep(1.0)


def main():
    parser = argparse.ArgumentParser(description="K9Mesh Micro-ESPectre Live Telemetry Producer")
    parser.add_argument("--uri", default=DEFAULT_WS_URI, help="WebSocket URI (default: ws://127.0.0.1:8080)")
    parser.add_argument("--rate-hz", type=float, default=10.0, help="Transmission frequency in Hz (default: 10.0)")
    parser.add_argument("--count", type=int, default=None, help="Total packets to send before exit (default: continuous)")
    parser.add_argument("--stable", action="store_true", help="Transmit stable (no motion) CSI telemetry")
    args = parser.parse_args()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    task = loop.create_task(stream_telemetry(args.uri, args.rate_hz, args.count, not args.stable))

    def handle_sigint():
        print("\n[*] Termination requested (CTRL+C).")
        task.cancel()

    if sys.platform != "win32":
        loop.add_signal_handler(signal.SIGINT, handle_sigint)
        loop.add_signal_handler(signal.SIGTERM, handle_sigint)

    try:
        loop.run_until_complete(task)
    except (KeyboardInterrupt, asyncio.CancelledError):
        print("[+] Telemetry producer terminated cleanly.")
    finally:
        loop.close()


if __name__ == "__main__":
    main()
