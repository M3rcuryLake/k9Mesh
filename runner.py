#!/usr/bin/env python3

import argparse
import asyncio
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
import webbrowser



ROOT = Path(__file__).parent
K9UI_DIR = ROOT / "k9ui"
WIFI_DIR = ROOT / "wifi"


class ProcessManager:
    def __init__(self):
        self.processes = []
        self.shutdown_event = asyncio.Event()
        self._shutdown_task = None

    def add(self, proc: subprocess.Popen, name: str):
        self.processes.append((proc, name))

    async def wait_for_port(self, port: int, host: str = "127.0.0.1", timeout: float = 30.0):
        start = time.time()
        while time.time() - start < timeout:
            try:
                reader, writer = await asyncio.open_connection(host, port)
                writer.close()
                await writer.wait_closed()
                return True
            except (ConnectionRefusedError, OSError):
                await asyncio.sleep(0.2)
        raise TimeoutError(f"Port {port} not ready after {timeout}s")

    async def check_alive(self, proc: subprocess.Popen, name: str, delay: float = 0.5):
        await asyncio.sleep(delay)
        if proc.poll() is not None:
            raise RuntimeError(f"{name} exited immediately with code {proc.returncode}")

    async def shutdown(self):
        # Idempotency guard: a second SIGINT/SIGTERM (or an overlapping
        # signal + finally-block call) must not re-enter this while an
        # earlier shutdown is still terminating processes.
        if self.shutdown_event.is_set():
            return
        print("\nShutting down...")
        for proc, name in reversed(self.processes):
            if proc.poll() is None:
                print(f"  Stopping {name} (PID {proc.pid})...")
                proc.terminate()
                try:
                    await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=5.0)
                except asyncio.TimeoutError:
                    proc.kill()
                    await asyncio.to_thread(proc.wait)
        self.shutdown_event.set()

    def setup_signals(self):
        loop = asyncio.get_running_loop()

        def _trigger_shutdown():
            # Keep a strong reference on self, otherwise asyncio may
            # garbage-collect the task mid-run and shutdown silently
            # never completes.
            self._shutdown_task = asyncio.create_task(self.shutdown())

        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, _trigger_shutdown)
            except (NotImplementedError, ValueError, OSError):
                pass


async def run_bridge(manager: ProcessManager, port: int, env: dict):
    bridge = subprocess.Popen(
        ["npm", "run", "bridge"],
        cwd=K9UI_DIR,
        env=env,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    manager.add(bridge, "bridge")
    await manager.check_alive(bridge, "bridge")
    await manager.wait_for_port(port)
    print(f"Bridge ready on http://localhost:{port}")



async def main():
    parser = argparse.ArgumentParser(description="K9Mesh runner")
    parser.add_argument("--dev", action="store_true", help="Development mode (bridge + Vite)")
    args = parser.parse_args()

    manager = ProcessManager()
    manager.setup_signals()

    env = os.environ.copy()
    env["K9MESH_WIFI_PATH"] = str(WIFI_DIR)

    try:
        if args.dev:
            await run_bridge(manager, 3001, env)
            vite = subprocess.Popen(
                ["npm", "run", "dev"],
                cwd=K9UI_DIR,
                env=env,
                stdout=sys.stdout,
                stderr=sys.stderr,
            )
            manager.add(vite, "vite")
            await manager.check_alive(vite, "vite")
            await manager.shutdown_event.wait()
        else:
            await run_bridge(manager, 3001, env)
            build = subprocess.run(
                ["npm", "run", "build"],
                cwd=K9UI_DIR,
                capture_output=True,
                text=True,
            )
            if build.returncode != 0:
                print(f"Build failed:\n{build.stdout}\n{build.stderr}")
                sys.exit(1)
            print("Build complete.")
            webbrowser.open("http://localhost:3001")
            await manager.shutdown_event.wait()

    except asyncio.CancelledError:
        pass
    except KeyboardInterrupt:
        await manager.shutdown()
    except Exception as e:
        print(f"Error: {e}")
        await manager.shutdown()
        sys.exit(1)
    finally:
        if not manager.shutdown_event.is_set():
            await manager.shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted. Exiting.")
        sys.exit(130)
