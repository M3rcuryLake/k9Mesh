"""
windowing.py

Stage 1: timestamp normalization, dropout handling, and window management.

Design notes (from the implementation plan; nothing here is invented
science -- thresholds are engineering defaults, see pipeline_config):

- The ESP32-S3 firmware timestamps packets with 32-bit ``time.ticks_us()``
  which WRAPS every ~71.6 minutes. Unwrap before anything else.
- Actual packet rate is MEASURED (median inter-arrival), never assumed:
  the firmware currently paces at ~50 Hz max and the traffic generator
  defaults to 20 Hz, versus the spec's 100-120 Hz expectation.
- Interpolation is ONLY allowed across small gaps. Gaps larger than
  ``large_gap_threshold_s`` are flagged; bridged samples are marked in
  ``original_mask`` so a window that relies on interpolated data beyond
  ``interp_rejection_fraction`` is rejected (DROPOUT_REJECTED), not
  silently treated as clean.
- Backward timestamps are dropped; duplicates keep the first sample.
- Too-few-samples windows are rejected as INSUFFICIENT_DATA upstream.
"""

from dataclasses import dataclass, field

import numpy as np

from breath.pipeline_config import PipelineConfig

TICKS_WRAP_US = 1 << 32  # 32-bit ticks_us wraps every ~71.6 min


@dataclass(slots=True)
class InterpolationMetadata:
    fs_nominal: float = 0.0        # [Hz] measured median rate
    fs_effective: float = 0.0      # [Hz] 1/mean(grid step)
    interp_fraction: float = 0.0   # [0-1] fraction of samples not original
    large_gap_fraction: float = 0.0  # [0-1] fraction of samples affected by large gaps
    n_large_gaps: int = 0
    max_gap_s: float = 0.0         # [s]
    n_dropped_packets: int = 0     # seq-gap losses
    n_backward_ts: int = 0
    n_duplicate_ts: int = 0
    trust_ok: bool = True
    rejection_reason: str | None = None


@dataclass
class CSIWindow:
    """A uniform-grid window of complex CSI, with trust metadata.

    H has shape [n_subcarriers, n_samples] in array-index order; only
    bins where valid_mask is True are meaningful (guards/DC zeroed by
    the caller).
    """
    t: np.ndarray                    # [s] uniform grid
    H: np.ndarray                    # complex64[n_sc, n]
    valid_mask: np.ndarray           # bool[n_sc]
    original_mask: np.ndarray        # bool[n] True where sample is a real packet
    interp: InterpolationMetadata
    motion_rejected: bool = False    # MVS state at window time
    status: str = "ok"               # "ok" | "insufficient_data" | "dropout_rejected"


def unwrap_timestamps(ts_us: np.ndarray) -> np.ndarray:
    """Unwrap 32-bit microsecond counter wraparound.

    Returns seconds [s]. Consecutive delta > half-wrap is treated as a
    wrap and corrected.
    """
    ts = np.asarray(ts_us, dtype=np.int64)
    if len(ts) == 0:
        return np.zeros(0)
    # Wrap correction: a negative jump > half the 32-bit range means the
    # counter wrapped between the two samples.
    half = TICKS_WRAP_US // 2
    d = np.diff(ts)
    wraps = np.zeros(len(ts), dtype=np.int64)
    wraps[1:] = np.cumsum(np.where(d < -half, 1, np.where(d > half, -1, 0)))
    return (ts + wraps * TICKS_WRAP_US) / 1e6


def normalize_timestamps(ts_us: np.ndarray) -> tuple[np.ndarray, np.ndarray, int, int]:
    """Sort, drop backward-jumping samples, dedup keep-first.

    Returns (clean_seconds_sorted, keep_mask_over_input, n_backward, n_duplicates).
    """
    t = unwrap_timestamps(np.asarray(ts_us, dtype=np.int64))
    n_backward = 0
    keep = np.ones(len(t), dtype=bool)
    last = None
    for i in range(len(t)):
        if last is not None and t[i] <= last:
            keep[i] = False  # backward or duplicate: drop (first kept)
            n_backward += 1 if t[i] < last else 0
        else:
            last = t[i]
    # Duplicate count: samples dropped because equal to predecessor.
    t_kept = t[keep]
    n_duplicates = int(np.sum(np.diff(t) == 0)) if len(t) > 1 else 0
    return t_kept, keep, n_backward, n_duplicates


class TimestampNormalizer:
    """Streaming normalizer: feeds raw (ts_us, H) frames, emits uniform
    grid columns with trust metadata."""

    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg
        self._raw_ts: list[int] = []
        self._raw_cols: list[np.ndarray] = []
        self._n_dropped_seq = 0

    def note_seq_gap(self, dropped: int) -> None:
        """Feed CSIReceiver's sequence-gap count so dropout metadata
        includes transport loss, not just timestamp gaps."""
        self._n_dropped_seq += dropped

    def add(self, ts_us: int, H: np.ndarray) -> None:
        self._raw_ts.append(int(ts_us))
        self._raw_cols.append(np.asarray(H, dtype=np.complex64))

    def drain(self) -> CSIWindow | None:
        """Normalize everything buffered so far onto a uniform grid.

        Called periodically by the pipeline; consumes the buffer.
        Returns None if there is not enough data to resample.
        """
        if len(self._raw_ts) < 8:
            return None
        t, keep_mask, n_backward, n_dup = normalize_timestamps(self._raw_ts)
        if len(t) < 8:
            self._raw_ts, self._raw_cols = [], []
            return None

        # Keep columns matching kept timestamps.
        cols = [self._raw_cols[i] for i in np.nonzero(keep_mask)[0]]
        H = np.stack(cols, axis=1)

        meta = self._grid_metadata(t)
        meta.n_backward_ts = n_backward
        meta.n_duplicate_ts = n_dup
        meta.n_dropped_packets = self._n_dropped_seq

        window = self._resample(t, H, meta)
        self._raw_ts, self._raw_cols = [], []
        self._n_dropped_seq = 0
        return window

    def _grid_metadata(self, t: np.ndarray) -> InterpolationMetadata:
        dt = np.diff(t)
        gaps = dt[dt > self.cfg.large_gap_threshold_s]
        fs_nominal = 1.0 / np.median(dt)
        return InterpolationMetadata(
            fs_nominal=fs_nominal,
            n_large_gaps=len(gaps),
            max_gap_s=float(gaps.max()) if len(gaps) else 0.0,
        )

    def _resample(self, t: np.ndarray, H: np.ndarray,
                  meta: InterpolationMetadata) -> CSIWindow:
        cfg = self.cfg
        fs = meta.fs_nominal
        # Uniform grid over the observed span. If any single gap exceeds
        # the large-gap threshold, split into segments and interpolate
        # within segments only.
        grid_step = 1.0 / fs
        t0, t1 = t[0], t[-1]
        grid = np.arange(t0, t1 + grid_step * 0.5, grid_step)

        gap_edges = np.nonzero(np.diff(t) > cfg.large_gap_threshold_s)[0]
        n_grid = len(grid)
        original = np.zeros(n_grid, dtype=bool)
        out = np.zeros((H.shape[0], n_grid), dtype=np.complex64)

        # Map each raw sample to the nearest grid index (monotonic t).
        raw_grid_idx = np.clip(np.round((t - t0) / grid_step).astype(int), 0, n_grid - 1)
        out[:, raw_grid_idx] = H
        original[raw_grid_idx] = True

        # Large gaps: mask them; NEVER interpolate across them.
        large_gap_mask = np.zeros(n_grid, dtype=bool)
        for gi in gap_edges:
            lo = raw_grid_idx[gi] + 1
            hi = raw_grid_idx[gi + 1]
            if hi > lo:
                large_gap_mask[lo:hi] = True

        # Interpolate only runs that are NOT large-gap separated. For
        # each contiguous non-large-gap run with missing samples, linear
        # interpolation per subcarrier (complex: interp real/imag jointly
        # as complex lerp).
        runs = self._contiguous_runs(~original & ~large_gap_mask)
        for lo, hi in runs:
            lo_edge = max(lo - 1, 0)
            hi_edge = min(hi + 1, n_grid - 1)
            xs = grid[[lo_edge, hi_edge]]
            left = out[:, lo_edge]
            right = out[:, hi_edge]
            span = grid[hi_edge] - grid[lo_edge]
            if span <= 0:
                continue
            w = ((grid[lo:hi + 1] - xs[0]) / span).astype(np.float32)
            out[:, lo:hi + 1] = (left[:, None] * (1 - w) + right[:, None] * w).astype(np.complex64)

        n_interp = int((~original).sum())
        interp_fraction = n_interp / n_grid if n_grid else 0.0
        large_gap_fraction = float(large_gap_mask.sum()) / n_grid if n_grid else 0.0
        meta.fs_effective = 1.0 / grid_step
        meta.interp_fraction = float(interp_fraction)
        meta.large_gap_fraction = large_gap_fraction
        meta.trust_ok = interp_fraction <= cfg.interp_rejection_fraction
        meta.rejection_reason = None if meta.trust_ok else "INTERP_FRACTION_EXCEEDED"

        # Zero-out guard/DC lanes so downstream valid masks agree.
        valid_mask = np.ones(H.shape[0], dtype=bool)
        valid_mask[:11] = False
        valid_mask[52:] = False
        valid_mask[32] = False

        return CSIWindow(
            t=grid,
            H=out,
            valid_mask=valid_mask,
            original_mask=original,
            interp=meta,
        )

    @staticmethod
    def _contiguous_runs(mask: np.ndarray) -> list[tuple[int, int]]:
        """Runs of True in a boolean array -> [(start, end_inclusive), ...]."""
        if len(mask) == 0:
            return []
        d = np.diff(mask.astype(np.int8))
        starts = np.nonzero(d == 1)[0] + 1
        ends = np.nonzero(d == -1)[0]
        if mask[0]:
            starts = np.concatenate([[0], starts])
        if mask[-1]:
            ends = np.concatenate([ends, [len(mask) - 1]])
        return list(zip(starts, ends))


class WindowManager:
    """Maintains a ring of normalized CSI up to the max adaptive window;
    cuts analysis windows of requested length."""

    def __init__(self, cfg: PipelineConfig, max_window_s: float | None = None):
        self.cfg = cfg
        self.max_s = max_window_s or cfg.max_window_s
        self._t: list[np.ndarray] = []
        self._H: list[np.ndarray] = []
        self._orig: list[np.ndarray] = []
        self._dropped_total = 0

    def push(self, window: CSIWindow) -> None:
        self._dropped_total += window.interp.n_dropped_packets
        self._t.append(window.t)
        self._H.append(window.H)
        self._orig.append(window.original_mask)
        self._prune()

    def _prune(self) -> None:
        if not self._t:
            return
        cutoff = self._t[-1][-1] - (self.max_s + 1.0)
        while self._t and self._t[0][-1] < cutoff:
            self._t.pop(0)
            self._H.pop(0)
            self._orig.pop(0)

    def cut(self, window_s: float) -> CSIWindow | None:
        """Cut a window of ~window_s ending at the newest sample.

        Re-references concatenation of stored segments. Returns None if
        less than window_s of data is buffered.
        """
        if not self._t:
            return None
        t_end = self._t[-1][-1]
        t_start = t_end - window_s
        ts, Hs, os_ = [], [], []
        for seg_t, seg_H, seg_o in zip(self._t, self._H, self._orig):
            keep = seg_t >= t_start - 0.5
            if keep.any():
                ts.append(seg_t[keep])
                Hs.append(seg_H[:, keep])
                os_.append(seg_o[keep])
        if not ts:
            return None
        t = np.concatenate(ts)
        H = np.concatenate(Hs, axis=1)
        original = np.concatenate(os_)
        if t[-1] - t[0] < window_s * 0.95:
            return None  # not enough history yet

        meta = InterpolationMetadata(
            fs_nominal=1.0 / np.median(np.diff(t)),
            fs_effective=1.0 / np.median(np.diff(t)),
            interp_fraction=float((~original).sum()) / len(t),
            n_dropped_packets=self._dropped_total,
            trust_ok=float((~original).sum()) / len(t) <= self.cfg.interp_rejection_fraction,
            rejection_reason=None,
        )
        if not meta.trust_ok:
            meta.rejection_reason = "INTERP_FRACTION_EXCEEDED"
        valid_mask = np.ones(H.shape[0], dtype=bool)
        valid_mask[:11] = False
        valid_mask[52:] = False
        valid_mask[32] = False
        return CSIWindow(t=t, H=H, valid_mask=valid_mask,
                         original_mask=original, interp=meta,
                         status="dropout_rejected" if not meta.trust_ok else "ok")
