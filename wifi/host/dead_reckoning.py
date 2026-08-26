"""
Differential-drive dead reckoning from FC-03 wheel ticks + MPU9250 gyro.

Position (x, y) comes from wheel tick deltas. Heading (theta) comes from
integrating the gyro z-axis rather than the tick differential -- tick-based
heading drifts hard under wheel slip (common on TT gearmotors), and we
already have a gyro on the bus, so use it.

Robot-specific constants (set from your hardware):
    wheel_radius_m:   3cm wheels  -> 0.03
    ticks_per_rev:    FC-03 disc has 20 holes, ISR counts RISING edges only
                       -> 20 ticks per wheel revolution
    wheelbase_m:      distance between left/right wheel centers -- MEASURE
                       THIS on your chassis, no sane default exists.
"""

import math
import time


class DeadReckoner:
    def __init__(self, wheel_radius_m, ticks_per_rev, wheelbase_m,
                 gyro_fsr_dps=250.0, use_gyro_heading=True):
        """
        Args:
            wheel_radius_m: wheel radius in meters.
            ticks_per_rev: encoder ticks per one full wheel revolution.
            wheelbase_m: distance between the two wheels' contact points.
            gyro_fsr_dps: MPU9250 gyro full-scale range in deg/s. Must match
                the GYRO_CONFIG set on the ESP32 (firmware default is
                +-250dps -> 131 LSB per deg/s).
            use_gyro_heading: if True, integrate theta from gz. If False,
                fall back to tick-differential heading (noisier, but works
                if the gyro is reporting mpu_ok=False).
        """
        self.wheel_radius_m = wheel_radius_m
        self.ticks_per_rev = ticks_per_rev
        self.wheelbase_m = wheelbase_m
        self.use_gyro_heading = use_gyro_heading

        # MPU9250 sensitivity scales with FSR: 131 LSB/(deg/s) at +-250dps,
        # halving for each FSR step up (+-500, +-1000, +-2000).
        self.gyro_lsb_per_dps = 131.0 * (250.0 / gyro_fsr_dps)

        self.dist_per_tick_m = (2.0 * math.pi * wheel_radius_m) / ticks_per_rev

        self.x = 0.0
        self.y = 0.0
        self.theta = 0.0  # radians, 0 = +x axis, CCW positive

        self._last_ticks_l = None
        self._last_ticks_r = None
        self._last_t = None

    def reset(self, x=0.0, y=0.0, theta=0.0):
        """Re-anchor the pose (e.g. at a known start position/heading)."""
        self.x, self.y, self.theta = x, y, theta
        self._last_ticks_l = None
        self._last_ticks_r = None
        self._last_t = None

    def update(self, odom, now=None):
        """Feed one OdomSample. Returns (x, y, theta_rad).

        Call this only for odom.fresh == True samples -- repeats have zero
        tick delta anyway, but they'd corrupt the dt estimate used for
        gyro integration since we don't have an onboard timestamp for
        odom, only host arrival time.
        """
        if now is None:
            now = time.time()

        if self._last_ticks_l is None:
            # First sample: anchor baseline, no delta to integrate yet.
            self._last_ticks_l = odom.ticks_l
            self._last_ticks_r = odom.ticks_r
            self._last_t = now
            return self.x, self.y, self.theta

        dt = now - self._last_t
        self._last_t = now
        if dt <= 0:
            return self.x, self.y, self.theta

        d_ticks_l = odom.ticks_l - self._last_ticks_l
        d_ticks_r = odom.ticks_r - self._last_ticks_r
        self._last_ticks_l = odom.ticks_l
        self._last_ticks_r = odom.ticks_r

        d_left = d_ticks_l * self.dist_per_tick_m
        d_right = d_ticks_r * self.dist_per_tick_m
        d_center = (d_left + d_right) / 2.0

        if self.use_gyro_heading and odom.mpu_ok:
            gyro_dps = odom.gz / self.gyro_lsb_per_dps
            d_theta = math.radians(gyro_dps) * dt
        else:
            # Tick-differential fallback (used if gyro is flagged bad)
            d_theta = (d_right - d_left) / self.wheelbase_m

        # Midpoint integration: apply displacement using the heading at the
        # midpoint of this step, not the start -- halves first-order error
        # vs. naive Euler integration, cheap to do.
        theta_mid = self.theta + d_theta / 2.0
        self.x += d_center * math.cos(theta_mid)
        self.y += d_center * math.sin(theta_mid)
        self.theta = _wrap_pi(self.theta + d_theta)

        return self.x, self.y, self.theta

    @property
    def pose(self):
        return {"x": self.x, "y": self.y, "theta_deg": math.degrees(self.theta)}


def _wrap_pi(angle):
    """Wrap angle to (-pi, pi]."""
    return (angle + math.pi) % (2.0 * math.pi) - math.pi
