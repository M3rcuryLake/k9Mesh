"""
Guided capture-and-train session: 10 min baseline -> [Enter] -> 10 min
movement -> [Enter] -> train.

Just runs collect_data.py twice and train_model.py once, as subprocesses,
with pauses for you to change the room state in between. Doesn't duplicate
any of their logic -- if you want different durations, bands, windows,
etc., either edit the constants below or add pass-through flags.

Usage:
    python run_session.py --interface wlp2s0
    python run_session.py --interface wlp2s0 --port 5005 --out-dir data --model model.pkl

Ctrl+C during a capture phase stops that phase early and still saves
partial data (same behavior as collect_data.py on its own) -- the session
then moves on to the next step rather than aborting entirely.
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path

BASELINE_SECONDS = 10 * 60
MOVEMENT_SECONDS = 10 * 60


def run_collect(interface, port, label, duration, out_path):
    cmd = [
        sys.executable, "collect_data.py",
        "--interface", interface,
        "--port", str(port),
        "--label", label,
        "--duration", str(duration),
        "--out", str(out_path),
    ]
    print(f"\n$ {' '.join(cmd)}\n")
    result = subprocess.run(cmd)
    if result.returncode not in (0, None) and result.returncode < 0:
        # negative returncode = killed by signal (e.g. Ctrl+C propagated) -
        # collect_data.py itself catches KeyboardInterrupt and still saves,
        # so this only fires on something more abnormal.
        print(f"'{label}' capture exited abnormally (code {result.returncode}).")
    return out_path.exists()


def run_train(data_glob, model_out):
    cmd = [sys.executable, "train_model.py", "--data", data_glob, "--out", str(model_out)]
    print(f"\n$ {' '.join(cmd)}\n")
    subprocess.run(cmd, check=True)


def wait_for_enter(prompt):
    try:
        input(prompt)
    except KeyboardInterrupt:
        print("\nAborted before starting next phase.")
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interface", required=True, help="e.g. wlp2s0")
    ap.add_argument("--port", type=int, default=5005)
    ap.add_argument("--out-dir", default="data", help="where the .npz captures go")
    ap.add_argument("--model", default="model.pkl", help="output path for the trained model")
    ap.add_argument("--run-tag", default=None,
                     help="suffix for this session's filenames, default = current timestamp")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    tag = args.run_tag or time.strftime("%Y%m%d_%H%M%S")

    baseline_path = out_dir / f"baseline_{tag}.npz"
    movement_path = out_dir / f"movement_{tag}.npz"

    print("=" * 60)
    print("Step 1/3: BASELINE capture")
    print("Clear the room and keep it still. Capture starts immediately")
    print(f"and runs for {BASELINE_SECONDS // 60} minutes.")
    print("=" * 60)
    wait_for_enter("Press Enter when the room is clear and still to begin baseline capture...")
    ok = run_collect(args.interface, args.port, "baseline", BASELINE_SECONDS, baseline_path)
    if not ok:
        print(f"No baseline data saved to {baseline_path} - aborting session.")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("Step 2/3: MOVEMENT capture")
    print(f"When you press Enter, capture starts and runs for "
          f"{MOVEMENT_SECONDS // 60} minutes. Have your person walking/")
    print("moving through the sensed area for that whole window.")
    print("=" * 60)
    wait_for_enter("Press Enter to begin movement capture...")
    ok = run_collect(args.interface, args.port, "movement", MOVEMENT_SECONDS, movement_path)
    if not ok:
        print(f"No movement data saved to {movement_path} - aborting session.")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("Step 3/3: TRAIN")
    print(f"Will train on every .npz in {out_dir}/ (not just this session's "
          f"two files, so any earlier captures in there count too).")
    print("=" * 60)
    wait_for_enter("Press Enter to start training...")
    run_train(str(out_dir / "*.npz"), args.model)

    print(f"\nDone. Model saved to {args.model}")
    print(f"Run detection with: python main.py --interface {args.interface} "
          f"--port {args.port} --model {args.model}")


if __name__ == "__main__":
    main()
