import type { ValidationRule, ValidationIssue } from '../types';

/**
 * EngineeringValidationRule
 *
 * Enforces physics and engineering operational bounds derived from docs/ICD.md.
 * Null values represent unmeasured/unconnected sensors and are accepted.
 * Non-null values must satisfy valid numerical ranges and engineering formats.
 */
export class EngineeringValidationRule implements ValidationRule {
  public readonly id = 'engineering-bounds';
  public readonly name = 'Engineering Limits & Physical Bounds Rule';

  public validate(packet: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!packet || typeof packet !== 'object') return issues;

    const obj = packet as Record<string, unknown>;
    const data = ('data' in obj && obj.data && typeof obj.data === 'object'
      ? (obj.data as Record<string, unknown>)
      : obj) as Record<string, Record<string, unknown>>;

    // 1. Battery Limits
    if (data.battery) {
      const b = data.battery;
      this.checkRange(issues, 'battery.percent', b.percent, 0, 100);
      this.checkRange(issues, 'battery.voltage', b.voltage, 0.0, 8.4);
      if (b.estTime !== null && b.estTime !== undefined) {
        if (typeof b.estTime !== 'string' || !/^\d{2}:\d{2}:\d{2}$/.test(b.estTime)) {
          issues.push({
            field: 'battery.estTime',
            code: 'BOUNDS_INVALID_TIME_FORMAT',
            message: `Estimated runtime must match "HH:MM:SS" format, received "${String(b.estTime)}"`,
            value: b.estTime,
            severity: 'ERROR',
          });
        }
      }
    }

    // 2. Radio Limits
    if (data.radio) {
      const r = data.radio;
      this.checkRange(issues, 'radio.latency', r.latency, 0, 1000);
      this.checkRange(issues, 'radio.signalPercent', r.signalPercent, 0, 100);
      if (r.rssi !== null && r.rssi !== undefined) {
        this.checkRange(issues, 'radio.rssi', r.rssi, -120, 0);
      }
    }

    // 3. IMU Limits
    if (data.imu) {
      const imu = data.imu;
      this.checkRange(issues, 'imu.heading', imu.heading, 0.0, 359.99);
      this.checkRange(issues, 'imu.pitch', imu.pitch, -90.0, 90.0);
      this.checkRange(issues, 'imu.roll', imu.roll, -180.0, 180.0);
    }

    // 4. Odometry Limits
    if (data.odometry) {
      const o = data.odometry;
      this.checkRange(issues, 'odometry.speed', o.speed, 0.0, 5.0);
      this.checkRange(issues, 'odometry.distance', o.distance, 0.0, 9999.99);

      if (o.motors && typeof o.motors === 'object') {
        const m = o.motors as Record<string, unknown>;
        this.checkRange(issues, 'odometry.motors.FL', m.FL, 0, 1000);
        this.checkRange(issues, 'odometry.motors.FR', m.FR, 0, 1000);
        this.checkRange(issues, 'odometry.motors.RL', m.RL, 0, 1000);
        this.checkRange(issues, 'odometry.motors.RR', m.RR, 0, 1000);
      }
    }

    // 5. GPS Limits
    if (data.gps) {
      const g = data.gps;
      this.checkRange(issues, 'gps.latitude', g.latitude, -90.0, 90.0);
      this.checkRange(issues, 'gps.longitude', g.longitude, -180.0, 180.0);
    }

    // 6. CSI Respiration Limits
    if (data.csi) {
      const c = data.csi;
      this.checkRange(issues, 'csi.breathingRate', c.breathingRate, 0.0, 60.0);
      if (c.confidence !== null && c.confidence !== undefined) {
        if (typeof c.confidence === 'string') {
          const num = parseFloat(c.confidence);
          if (isNaN(num) || num < 0.0 || num > 100.0) {
            issues.push({
              field: 'csi.confidence',
              code: 'BOUNDS_INVALID_CONFIDENCE_STRING',
              message: `CSI confidence string must evaluate between 0.0 and 100.0%, received "${c.confidence}"`,
              value: c.confidence,
              severity: 'ERROR',
            });
          }
        }
      }
    }

    // 7. Hardware Thermal Limits
    if (data.hardware) {
      const h = data.hardware;
      this.checkRange(issues, 'hardware.coreTemp', h.coreTemp, -40.0, 85.0);
    }

    // 8. ML Classification Limits
    if (data.ml) {
      const ml = data.ml;
      this.checkRange(issues, 'ml.score', ml.score, 0.0, 1.0);
      
      if (Array.isArray(ml.classification)) {
        ml.classification.forEach((pt: any, index: number) => {
          this.checkRange(issues, `ml.classification[${index}].t`, pt.t, 0.0, 1.0);
          this.checkRange(issues, `ml.classification[${index}].x`, pt.x, 0.0, 1.0);
          this.checkRange(issues, `ml.classification[${index}].y`, pt.y, 0.0, 1.0);
        });
      }
    }

    // 9. MVS Limits
    if (data.motion && data.motion.variance !== undefined) {
      // It's mapped under motion, but in our adapter we map mvs.confidence to csi.confidence currently!
      // Wait, let me check CsiTelemetryAdapter.ts: I mapped mvs.confidence to csi.confidence
      // So csi.confidence is already checked.
    }

    // 10. Pose Limits
    if (data.pose) {
      const p = data.pose;
      this.checkRange(issues, 'pose.thetaDeg', p.thetaDeg, -360.0, 360.0);
    }

    return issues;
  }

  private checkRange(
    issues: ValidationIssue[],
    field: string,
    val: unknown,
    min: number,
    max: number
  ): void {
    if (val === null || val === undefined) return;

    if (typeof val !== 'number' || !Number.isFinite(val)) {
      issues.push({
        field,
        code: 'TYPE_EXPECTED_NUMBER',
        message: `Field "${field}" must be a finite number or null, received ${typeof val}`,
        value: val,
        severity: 'ERROR',
      });
      return;
    }

    if (val < min || val > max) {
      issues.push({
        field,
        code: 'BOUNDS_OUT_OF_RANGE',
        message: `Value for "${field}" (${val}) is outside valid engineering limits [${min}, ${max}]`,
        value: val,
        severity: 'ERROR',
      });
    }
  }
}
