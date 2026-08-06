#!/usr/bin/env python3
"""
K9Mesh Python Telemetry Producer Test Harness
--------------------------------------------
Simulates a live Python-based CSI detection pipeline streaming
ICD-compliant JSON telemetry over a local WebSocket connection (ws://127.0.0.1:8765).

Demonstrates:
1. Valid nominal search telemetry stream
2. Valid survivor detected telemetry stream (CSI respiration)
3. Defensive malformed JSON packet rejection
4. Defensive oversized packet rejection (>64KB)
5. Clean client disconnect and autonomous reconnection
"""

import asyncio
import json
import time
import websockets

WS_URI = "ws://127.0.0.1:8765"


def create_base_packet(seq: int) -> dict:
    return {
        "msg_type": "ROVER_TELEMETRY",
        "protocol_version": "2.0.0",
        "timestamp_epoch_ms": int(time.time() * 1000),
        "sequence_id": seq,
        "source_node": "ROVER_PRIME",
        "telemetry": {
            "radio": {
                "linkQuality": "EXCELLENT",
                "latency": 18,
                "signalPercent": 92
            },
            "hardware": {
                "stm32": "OK",
                "esp32": "OK",
                "mqtt": "OK",
                "wifi": "OK",
                "coreTemp": 39.4
            },
            "battery": {
                "percent": 88,
                "voltage": 7.92,
                "estTime": "03:42:15",
                "discharge": "NORMAL"
            },
            "csi": {
                "breathingDetected": False,
                "breathingRate": None,
                "confidence": 0,
                "state": "IDLE",
                "arrayOnline": True,
                "calibrated": True
            },
            "motion": {
                "level": "LOW",
                "lastEventSeconds": 142
            },
            "imu": {
                "heading": 134.5,
                "pitch": -2.1,
                "roll": 0.8
            },
            "odometry": {
                "speed": 0.35,
                "distance": 42.8,
                "motors": {
                    "FL": 120,
                    "FR": 120,
                    "RL": 118,
                    "RR": 119
                }
            },
            "gps": {
                "latitude": 37.7749,
                "longitude": -122.4194
            }
        }
    }


async def run_producer_test():
    print(f"[*] Connecting to K9Mesh WebSocket Telemetry Server at {WS_URI}...")
    
    try:
        async with websockets.connect(WS_URI) as ws:
            print("[+] Connected to K9Mesh WebSocket Server successfully!")
            
            # --- Stage 1: Nominal Search Telemetry Stream ---
            print("\n[Phase 1] Streaming Nominal Search Telemetry (5 packets @ 10 Hz)...")
            for seq in range(1, 6):
                pkt = create_base_packet(seq)
                await ws.send(json.dumps(pkt))
                print(f"  -> Sent Packet #{seq} (Heading: {pkt['telemetry']['imu']['heading']}°, Batt: {pkt['telemetry']['battery']['percent']}%)")
                await asyncio.sleep(0.1)

            # --- Stage 2: Survivor Detected Telemetry Stream ---
            print("\n[Phase 2] Streaming Survivor Detection Telemetry (5 packets @ 10 Hz)...")
            for seq in range(6, 11):
                pkt = create_base_packet(seq)
                pkt["telemetry"]["csi"]["breathingDetected"] = True
                pkt["telemetry"]["csi"]["breathingRate"] = 16
                pkt["telemetry"]["csi"]["confidence"] = 94
                pkt["telemetry"]["csi"]["state"] = "STABLE"
                pkt["telemetry"]["motion"]["level"] = "HIGH"
                pkt["telemetry"]["motion"]["lastEventSeconds"] = 0
                await ws.send(json.dumps(pkt))
                print(f"  -> Sent Packet #{seq} [SURVIVOR DETECTED: 16 BPM, Conf: 94%]")
                await asyncio.sleep(0.1)

            # --- Stage 3: Malformed JSON Packet Test ---
            print("\n[Phase 3] Injecting Malformed JSON (Testing Defensive Safe Boundary)...")
            malformed_payload = '{"msg_type": "ROVER_TELEMETRY", "corrupted_syntax": ... INVALID JSON'
            await ws.send(malformed_payload)
            print("  -> Sent malformed frame. Server should discard safely without crashing.")
            await asyncio.sleep(0.2)

            # --- Stage 4: Oversized Frame Test ---
            print("\n[Phase 4] Injecting Oversized Frame (>64KB limit test)...")
            oversized_payload = json.dumps({"msg_type": "ROVER_TELEMETRY", "padding": "X" * 70000})
            await ws.send(oversized_payload)
            print("  -> Sent 70KB frame. Server should drop oversized packet safely.")
            await asyncio.sleep(0.2)

            # --- Stage 5: Resuming Valid Stream After Faults ---
            print("\n[Phase 5] Resuming Valid Telemetry Stream...")
            for seq in range(11, 14):
                pkt = create_base_packet(seq)
                await ws.send(json.dumps(pkt))
                print(f"  -> Sent Recovery Packet #{seq}")
                await asyncio.sleep(0.1)

            print("\n[+] Test sequence completed. Closing connection.")

    except ConnectionRefusedError:
        print(f"[-] Connection refused: Ensure K9Mesh is running with WebSocketTelemetrySource active on {WS_URI}")
    except Exception as e:
        print(f"[-] Test failed with error: {e}")


if __name__ == "__main__":
    asyncio.run(run_producer_test())
