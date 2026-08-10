import asyncio
import json
import time
import sys
import argparse
import websockets
import random
import math

# Baseline states for demonstration
# Low magnitude state
LOW_STATE = [
    {"t": 0.1, "x": 0.2, "y": 0.1},
    {"t": 0.15, "x": 0.3, "y": 0.15},
    {"t": 0.2, "x": 0.4, "y": 0.2}
]

# Medium magnitude state
MEDIUM_STATE = [
    {"t": 0.3, "x": 0.25, "y": 0.3},
    {"t": 0.5, "x": 0.35, "y": 0.4},
    {"t": 0.45, "x": 0.45, "y": 0.35}
]

# High magnitude state
HIGH_STATE = [
    {"t": 0.8, "x": 0.4, "y": 0.5},
    {"t": 0.95, "x": 0.5, "y": 0.6},
    {"t": 1.0, "x": 0.6, "y": 0.7},
    {"t": 0.9, "x": 0.7, "y": 0.6}
]

DEMO_STATES = [
    {"score": 0.1, "motion": False, "points": LOW_STATE},
    {"score": 0.5, "motion": True, "points": MEDIUM_STATE},
    {"score": 0.95, "motion": True, "points": HIGH_STATE},
    {"score": 0.3, "motion": False, "points": LOW_STATE}
]

def generate_random_classification(num_points, max_t):
    pts = []
    for _ in range(num_points):
        pts.append({
            "t": round(random.uniform(0.0, max_t), 3),
            "x": round(random.uniform(0.0, 1.0), 4),
            "y": round(random.uniform(0.0, 1.0), 4)
        })
    return pts

async def stream_telemetry(uri: str, rate_hz: float, mode: str):
    seq = 5000
    demo_index = 0
    demo_last_change = time.time()
    
    # Initialize state
    current_score = 0.1
    current_motion = False
    current_points = LOW_STATE

    # GPS simulation base
    base_lat = 37.7749
    base_lon = -122.4194

    while True:
        try:
            async with websockets.connect(uri, max_size=1024 * 1024) as websocket:
                print(f"[ML-TEST-BACKEND] Connected to {uri}")
                
                while True:
                    now = time.time()
                    
                    if mode == 'demo':
                        if now - demo_last_change >= 3.0:
                            demo_index = (demo_index + 1) % len(DEMO_STATES)
                            state = DEMO_STATES[demo_index]
                            current_score = state['score']
                            current_motion = state['motion']
                            current_points = state['points']
                            demo_last_change = now
                            print(f"\n[ML-TEST-BACKEND] DEMO STATE {demo_index + 1}")
                            print(f"Score: {current_score} | Motion: {current_motion} | Pts: {len(current_points)}")
                    elif mode == 'low':
                        current_score = 0.2
                        current_motion = False
                        current_points = generate_random_classification(5, 0.3)
                    elif mode == 'medium':
                        current_score = 0.6
                        current_motion = True
                        current_points = generate_random_classification(10, 0.6)
                    elif mode == 'high':
                        current_score = 0.99
                        current_motion = True
                        current_points = generate_random_classification(20, 1.0)
                    else:
                        # random
                        current_score = round(random.uniform(0.0, 1.0), 2)
                        current_motion = random.choice([True, False])
                        current_points = generate_random_classification(random.randint(5, 15), 1.0)

                    # Simulate rover moving slightly to test valid GPS trail
                    moving_lat = base_lat + math.sin(now) * 0.0001
                    moving_lon = base_lon + math.cos(now) * 0.0001

                    # Occasionally send a positive breathing detected signal to test detection marker
                    breathing_detected = True if (int(now) % 15 == 0 and demo_index == 2) else False

                    # Complete production-shaped Micro-ESPectre packet
                    packet = {
                        "seq": seq,
                        "timestamp_us": int(now * 1_000_000),
                        "channel": 1,
                        "rssi": -55,
                        "dropped": 0,
                        "band": [11, 13, 15],
                        "mvs": {
                            "state": "motion" if current_motion else "stable",
                            "variance": 0.001,
                            "threshold": 0.002,
                            "confidence": 50.0
                        },
                        "breathing_detected": breathing_detected,
                        "breathing_rate": 15 if breathing_detected else None,
                        "gps_lat": moving_lat,
                        "gps_lon": moving_lon,
                        "ml": {
                            "ready": True,
                            "enabled": True,
                            "score": current_score,
                            "motion": current_motion,
                            "classification": current_points
                        }
                    }

                    await websocket.send(json.dumps(packet))
                    
                    if seq % 10 == 0 and mode != 'demo':
                        print(f"[ML-TEST-BACKEND] seq={seq} score={current_score} pts={len(current_points)}")
                    
                    seq += 1
                    await asyncio.sleep(1.0 / rate_hz)

        except (websockets.exceptions.ConnectionClosedError, ConnectionRefusedError):
            print(f"[ML-TEST-BACKEND] Connection lost/refused. Retrying in 1s...")
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            print("[ML-TEST-BACKEND] Shutting down...")
            break
        except Exception as e:
            print(f"[ML-TEST-BACKEND] Error: {e}")
            await asyncio.sleep(1)

def main():
    parser = argparse.ArgumentParser(description="K9Mesh ML Classification Test Producer")
    parser.add_argument("--demo", action="store_true", help="Cycle through distinct demo states to prove UI reactivity")
    parser.add_argument("--low", action="store_true", help="Constant low magnitude")
    parser.add_argument("--medium", action="store_true", help="Constant medium magnitude")
    parser.add_argument("--high", action="store_true", help="Constant high magnitude")
    parser.add_argument("--random", action="store_true", help="Random dynamic magnitude")
    parser.add_argument("--rate-hz", type=float, default=10.0, help="Transmission rate in Hz")
    parser.add_argument("--uri", type=str, default="ws://127.0.0.1:8080", help="WebSocket URI")
    
    args = parser.parse_args()

    mode = 'random'
    if args.demo: mode = 'demo'
    elif args.low: mode = 'low'
    elif args.medium: mode = 'medium'
    elif args.high: mode = 'high'

    print(f"Starting K9Mesh ML Emulator")
    print(f"Target: {args.uri}")
    print(f"Rate:   {args.rate_hz} Hz")
    print(f"Mode:   {mode.upper()}")
    print("Press Ctrl+C to stop.")

    try:
        asyncio.run(stream_telemetry(args.uri, args.rate_hz, mode))
    except KeyboardInterrupt:
        print("\n[ML-TEST-BACKEND] Terminated by user.")
        sys.exit(0)

if __name__ == "__main__":
    main()
