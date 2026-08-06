"""
MVS (Moving Variance Segmentation) detector - laptop-side port of
Micro-ESPectre's default detection algorithm.

Pipeline per packet (matches ALGORITHMS.md):
    amplitudes (selected band) -> turbulence (std/CV)
        -> Hampel filter (optional, default on)
        -> Low-pass filter (optional, default off)
        -> moving variance over sliding window
        -> compare to adaptive threshold -> IDLE/MOTION
"""

from collections import deque

from csi_dsp import (
    DEFAULT_BAND,
    HampelFilter,
    LowPassFilter,
    calculate_adaptive_threshold,
    moving_variance,
    spatial_turbulence,
)

IDLE = "idle"
MOTION = "motion"


class MVSDetector:
    def __init__(
        self,
        band=None,
        window_size=10,
        gain_locked=True,
        hampel_enabled=True,
        hampel_window=7,
        hampel_threshold=5.0,
        lowpass_enabled=False,
        lowpass_cutoff_hz=11.0,
        sample_rate_hz=100.0,
        motion_on_hits=1,
        motion_off_hits=2,
    ):
        self.band = band or list(DEFAULT_BAND)
        self.window_size = window_size
        self.gain_locked = gain_locked

        self.hampel = HampelFilter(hampel_window, hampel_threshold) if hampel_enabled else None
        self.lowpass = LowPassFilter(lowpass_cutoff_hz, sample_rate_hz) if lowpass_enabled else None

        self.turbulence_buffer = deque(maxlen=window_size)

        self.threshold = None  # set by calibrate()
        self.state = IDLE

        # Consecutive-hit filtering to avoid single-packet flapping
        self.motion_on_hits = motion_on_hits
        self.motion_off_hits = motion_off_hits
        self._on_streak = 0
        self._off_streak = 0

        self.last_variance = 0.0

    def _band_amplitudes(self, amplitudes):
        n = len(amplitudes)
        return [amplitudes[i] for i in self.band if i < n]

    def _turbulence_for_packet(self, amplitudes):
        band_amps = self._band_amplitudes(amplitudes)
        t = spatial_turbulence(band_amps, gain_locked=self.gain_locked)
        if self.hampel is not None:
            t = self.hampel.filter(t)
        if self.lowpass is not None:
            t = self.lowpass.filter(t)
        return t

    def calibrate(self, baseline_packets, pct=95, factor=1.1):
        """
        Run over a baseline (idle) recording to set the adaptive threshold.
        baseline_packets: iterable of amplitude lists (already parsed).
        """
        mv_values = []
        window = deque(maxlen=self.window_size)
        for amplitudes in baseline_packets:
            t = self._turbulence_for_packet(amplitudes)
            window.append(t)
            if len(window) == self.window_size:
                mv_values.append(moving_variance(window))

        if not mv_values:
            raise ValueError("Not enough baseline packets to calibrate")

        self.threshold = calculate_adaptive_threshold(mv_values, pct, factor)
        # Reset live buffers so calibration data doesn't bleed into runtime
        self.turbulence_buffer.clear()
        if self.hampel is not None:
            self.hampel.buffer.clear()
        return self.threshold

    def process(self, amplitudes):
        """
        Feed one packet's amplitude array. Returns (state, variance) -
        state only changes once window_size samples have accumulated.
        """
        t = self._turbulence_for_packet(amplitudes)
        self.turbulence_buffer.append(t)

        if len(self.turbulence_buffer) < self.window_size:
            return self.state, self.last_variance

        variance = moving_variance(self.turbulence_buffer)
        self.last_variance = variance

        if self.threshold is None:
            # No calibration run yet - report variance but don't flip state
            return self.state, variance

        is_motion_sample = variance > self.threshold

        if is_motion_sample:
            self._on_streak += 1
            self._off_streak = 0
        else:
            self._off_streak += 1
            self._on_streak = 0

        if self.state == IDLE and self._on_streak >= self.motion_on_hits:
            self.state = MOTION
        elif self.state == MOTION and self._off_streak >= self.motion_off_hits:
            self.state = IDLE

        return self.state, variance
