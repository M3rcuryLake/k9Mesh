"""
Deterministic synthetic CSI for respiration-pipeline tests.

Generates complex CSI frames with a planted respiration tone that shows
up in CSCR ratios (amplitude AND phase variation across subcarriers),
plus controllable impairments:

    - Gaussian I/Q noise
    - impulsive spikes
    - packet dropouts
    - timestamp jitter
    - per-subcarrier amplitude variation
    - common phase rotation
    - an out-of-band decoy peak (40 brpm) to test band discipline

All randomness goes through a seeded numpy Generator, so tests are
deterministic.
"""

from dataclasses import dataclass, field

import numpy as np

NUM_SC = 64
GUARD_LOW, GUARD_HIGH, DC = 11, 52, 32
USABLE = [i for i in range(GUARD_LOW, GUARD_HIGH) if i != DC]


@dataclass
class SynthConfig:
    fs_hz: float = 20.0                  # matches the CURRENT firmware ceiling, not the spec's 100 Hz
    duration_s: float = 30.0
    brpm: float = 15.0
    decoy_brpm: float | None = None      # out-of-band decoy peak (e.g. 40)
    static_mag_range: tuple = (20.0, 80.0)
    resp_sc_fraction: float = 0.4        # fraction of usable subcarriers carrying the tone
    resp_amplitude: float = 0.15         # relative amplitude modulation depth
    resp_phase_swing_rad: float = 0.3    # phase modulation swing
    noise_sigma: float = 0.5             # I/Q noise std per sample
    spike_rate: float = 0.0              # impulses per second
    spike_amplitude: float = 50.0
    dropout_rate: float = 0.0            # packets dropped per second (random single drops)
    dropout_burst_s: float = 0.0         # if > 0, one contiguous gap of this length
    timestamp_jitter_s: float = 0.0      # +/- uniform jitter on timestamps
    common_phase_drift: float = 0.0      # rad/s common rotation applied to all subcarriers
    seed: int = 1234


@dataclass
class SynthStream:
    t: np.ndarray            # [s], uniform grid
    H: np.ndarray            # complex64[64, n] clean signal
    t_received: np.ndarray   # jittered timestamps, drops removed, non-uniform
    H_received: np.ndarray   # same columns as t_received
    dropped_mask: np.ndarray # bool[n] True where the packet was "lost"
    cfg: SynthConfig

    @property
    def brpm(self) -> float:
        return self.cfg.brpm


def synth_stream(cfg: SynthConfig) -> SynthStream:
    rng = np.random.default_rng(cfg.seed)
    n = int(round(cfg.duration_s * cfg.fs_hz))
    t = np.arange(n) / cfg.fs_hz

    # Static complex channel: random magnitude/phase per subcarrier.
    static_mag = rng.uniform(*cfg.static_mag_range, size=NUM_SC)
    static_phase = rng.uniform(0, 2 * np.pi, size=NUM_SC)
    H = static_mag.astype(np.complex128) * np.exp(1j * static_phase)[:, None] * np.ones((1, n))

    # Planted respiration: amplitude+phase modulation on a subset of
    # usable subcarriers, with subcarrier-dependent sign so CSCR ratios
    # between modulated and unmodulated carriers carry the tone.
    resp = cfg.brpm / 60.0
    f_resp_hz = resp
    chosen = np.array(USABLE, dtype=int)
    sel = rng.choice(chosen, size=max(2, int(len(chosen) * cfg.resp_sc_fraction)), replace=False)
    resp_signs = rng.choice([-1.0, 1.0], size=len(sel))
    amp_depth = cfg.resp_amplitude * (0.5 + rng.random(len(sel)))
    phase_swing = cfg.resp_phase_swing_rad * (0.5 + rng.random(len(sel)))
    mod = np.exp(
        1j * (resp_signs * phase_swing * np.sin(2 * np.pi * f_resp_hz * t))[None, :]
    )
    H[sel] = H[sel] * ((1 + resp_signs[:, None] * amp_depth[:, None] * np.sin(2 * np.pi * f_resp_hz * t)) * mod)

    # Optional decoy: strong out-of-band modulation (e.g. 40 brpm = 0.667 Hz,
    # above the 0.55 Hz physiological edge).
    if cfg.decoy_brpm is not None:
        f_decoy = cfg.decoy_brpm / 60.0
        dsel = rng.choice([i for i in chosen if i not in set(sel)], size=4, replace=False)
        H[dsel] = H[dsel] * (1 + 0.3 * np.sin(2 * np.pi * f_decoy * t + rng.uniform(0, 2 * np.pi, (4, 1))))

    # Common phase drift (packet-dependent common phase error, slow).
    if cfg.common_phase_drift:
        H = H * np.exp(1j * cfg.common_phase_drift * t)[None, :]

    # I/Q noise.
    H = H + cfg.noise_sigma * (rng.standard_normal(H.shape) + 1j * rng.standard_normal(H.shape))

    # Impulsive spikes.
    if cfg.spike_rate > 0:
        n_spikes = int(cfg.spike_rate * cfg.duration_s)
        for _ in range(n_spikes):
            k = rng.integers(0, n)
            m = rng.choice(USABLE)
            H[m, k] += cfg.spike_amplitude * np.exp(1j * rng.uniform(0, 2 * np.pi))

    H = H.astype(np.complex64)

    # Dropouts: remove random single packets and/or one burst gap.
    dropped = np.zeros(n, dtype=bool)
    if cfg.dropout_rate > 0:
        n_drop = int(cfg.dropout_rate * cfg.duration_s)
        dropped[rng.choice(n, size=min(n_drop, n), replace=False)] = True
    if cfg.dropout_burst_s > 0:
        start = rng.integers(0, max(1, n - int(cfg.dropout_burst_s * cfg.fs_hz)))
        end = start + int(cfg.dropout_burst_s * cfg.fs_hz)
        dropped[start:end] = True
    keep = ~dropped
    t_rx = t[keep].copy()
    H_rx = H[:, keep]

    # Timestamp jitter.
    if cfg.timestamp_jitter_s > 0:
        t_rx = t_rx + rng.uniform(-cfg.timestamp_jitter_s, cfg.timestamp_jitter_s, size=len(t_rx))

    return SynthStream(t=t, H=H, t_received=t_rx, H_received=H_rx,
                       dropped_mask=dropped, cfg=cfg)


def stream_to_packets(stream: SynthStream, seq_start: int = 0):
    """Convenience: yield (seq, t, H_col) triples the way a receiver would."""
    seq = seq_start
    for k in range(len(stream.t_received)):
        yield seq, float(stream.t_received[k]), stream.H_received[:, k]
        seq += 1
