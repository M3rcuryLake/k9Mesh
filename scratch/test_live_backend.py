import asyncio
import json
import time
import sys
import argparse
import websockets

DEMO_STATES = [
    {
        "rssi": -61,
        "channel": 5,
        "dropped": 0,
        "variance": 0.0010,
        "threshold": 0.0020,
        "confidence": 25.0
    },
    {
        "rssi": -40,
        "channel": 11,
        "dropped": 2,
        "variance": 0.0080,
        "threshold": 0.0030,
        "confidence": 65.0
    },
    {
        "rssi": -75,
        "channel": 6,
        "dropped": 5,
        "variance": 0.0200,
        "threshold": 0.0040,
        "confidence": 95.0
    },
    {
        "rssi": -30,
        "channel": 1,
        "dropped": 0,
        "variance": 0.0030,
        "threshold": 0.0010,
        "confidence": 99.8877
    }
]

async def stream_telemetry(uri: str, rate_hz: float, demo_mode: bool):
    seq = 1000
    demo_index = 0
    demo_last_change = time.time()
    demo_state = DEMO_STATES[0]

    while True:
        try:
            async with websockets.connect(uri, max_size=1024 * 1024) as websocket:
                print(f"[TEST-BACKEND] Connected to {uri}")
                if demo_mode:
                    print(f"[TEST-BACKEND] DEMO STATE {demo_index + 1}")
                    print(f"[TEST-BACKEND] rssi={demo_state['rssi']} channel={demo_state['channel']} dropped={demo_state['dropped']} confidence={demo_state['confidence']}")

                while True:
                    now = time.time()
                    
                    if demo_mode:
                        if now - demo_last_change >= 3.0:
                            demo_index = (demo_index + 1) % len(DEMO_STATES)
                            demo_state = DEMO_STATES[demo_index]
                            demo_last_change = now
                            print(f"\n[TEST-BACKEND] DEMO STATE {demo_index + 1}")
                            print(f"[TEST-BACKEND] rssi={demo_state['rssi']} channel={demo_state['channel']} dropped={demo_state['dropped']} confidence={demo_state['confidence']}")
                    
                    rssi = demo_state['rssi'] if demo_mode else -61
                    channel = demo_state['channel'] if demo_mode else 5
                    dropped = demo_state['dropped'] if demo_mode else 0
                    variance = demo_state['variance'] if demo_mode else 0.00035
                    threshold = demo_state['threshold'] if demo_mode else 0.00018
                    confidence = demo_state['confidence'] if demo_mode else 83.116

                    packet = {
                        "seq": seq,
                        "timestamp_us": int(now * 1_000_000),
                        "channel": channel,
                        "rssi": rssi,
                        "dropped": dropped,
                        "band": [11, 13, 15, 17, 20, 22, 24, 26, 28, 46, 49, 51],
                        "mvs": {
                            "state": "motion",
                            "variance": variance,
                            "threshold": threshold,
                            "confidence": confidence
                        },
                        "ml": {
                            "ready": True,
                            "enabled": True
                        }
                    }

                    await websocket.send(json.dumps(packet))
                    
                    if not demo_mode:
                        if seq % 10 == 0:
                            print(f"[TEST-BACKEND] seq={seq} rssi={rssi} channel={channel} variance={variance} confidence={confidence}")
                    
                    seq += 1
                    await asyncio.sleep(1.0 / rate_hz)

        except (websockets.exceptions.ConnectionClosedError, ConnectionRefusedError):
            print(f"[TEST-BACKEND] Connection lost/refused to {uri}. Retrying in 1s...")
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            print("[TEST-BACKEND] Shutting down...")
            break
        except Exception as e:
            print(f"[TEST-BACKEND] Error: {e}")
            await asyncio.sleep(1)

def main():
    parser = argparse.ArgumentParser(description="K9Mesh Live Backend Test Producer")
    parser.add_argument("--demo", action="store_true", help="Cycle through distinct demo states to prove UI reactivity")
    parser.add_argument("--rate-hz", type=float, default=10.0, help="Transmission rate in Hz")
    parser.add_argument("--uri", type=str, default="ws://127.0.0.1:8080", help="WebSocket URI")
    
    args = parser.parse_args()

    print(f"Starting K9Mesh Live Backend Emulator")
    print(f"Target: {args.uri}")
    print(f"Rate:   {args.rate_hz} Hz")
    print(f"Mode:   {'DEMO (Data Provenance)' if args.demo else 'DEFAULT (Continuous)'}")
    print("Press Ctrl+C to stop.")

    try:
        asyncio.run(stream_telemetry(args.uri, args.rate_hz, args.demo))
    except KeyboardInterrupt:
        print("\n[TEST-BACKEND] Terminated by user.")
        sys.exit(0)

if __name__ == "__main__":
    main()
