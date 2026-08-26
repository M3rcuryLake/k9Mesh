# ws_test_server.py
import asyncio
import websockets

connected = set()

async def handler(websocket):
    connected.add(websocket)
    print(f"Client connected ({len(connected)} total)")
    try:
        async for message in websocket:
            print(f"Received: {message}")  # truncate long messages in logs
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected.remove(websocket)
        print(f"Client disconnected ({len(connected)} total)")

async def main():
    async with websockets.serve(handler, "localhost", 8080):
        print("WS test server listening on ws://localhost:8080")
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
