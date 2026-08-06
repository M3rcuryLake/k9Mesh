import type { ValidationRule, ValidationIssue } from '../types';

/**
 * EnumValidationRule
 *
 * Verifies that all status, quality, and state enumeration values match the
 * strict discrete domain sets defined in docs/ICD.md.
 */
export class EnumValidationRule implements ValidationRule {
  public readonly id = 'enum-invariants';
  public readonly name = 'Telemetry Enumeration Invariants Rule';

  private static readonly HARDWARE_STATES = new Set(['OK', 'FAULT', 'OFFLINE']);
  private static readonly RADIO_QUALITIES = new Set(['EXCELLENT', 'GOOD', 'FAIR', 'POOR']);
  private static readonly DISCHARGE_RATES = new Set(['NORMAL', 'HIGH', 'CRITICAL']);
  private static readonly CSI_STATES = new Set(['STABLE', 'MOTION', 'IDLE']);
  private static readonly MOTION_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH']);

  public validate(packet: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!packet || typeof packet !== 'object') return issues;

    const obj = packet as Record<string, unknown>;
    const data = ('data' in obj && obj.data && typeof obj.data === 'object'
      ? (obj.data as Record<string, unknown>)
      : obj) as Record<string, Record<string, unknown>>;

    // 1. Hardware Status Enums
    if (data.hardware) {
      const h = data.hardware;
      this.checkEnum(issues, 'hardware.stm32', h.stm32, EnumValidationRule.HARDWARE_STATES);
      this.checkEnum(issues, 'hardware.esp32', h.esp32, EnumValidationRule.HARDWARE_STATES);
      this.checkEnum(issues, 'hardware.mqtt', h.mqtt, EnumValidationRule.HARDWARE_STATES);
      this.checkEnum(issues, 'hardware.wifi', h.wifi, EnumValidationRule.HARDWARE_STATES);
    }

    // 2. Radio Link Quality Enum
    if (data.radio) {
      this.checkEnum(issues, 'radio.linkQuality', data.radio.linkQuality, EnumValidationRule.RADIO_QUALITIES);
    }

    // 3. Battery Discharge Rate Enum
    if (data.battery) {
      this.checkEnum(issues, 'battery.discharge', data.battery.discharge, EnumValidationRule.DISCHARGE_RATES);
    }

    // 4. CSI State Enum
    if (data.csi) {
      this.checkEnum(issues, 'csi.state', data.csi.state, EnumValidationRule.CSI_STATES);
    }

    // 5. Motion Level Enum
    if (data.motion) {
      this.checkEnum(issues, 'motion.level', data.motion.level, EnumValidationRule.MOTION_LEVELS);
    }

    return issues;
  }

  private checkEnum(
    issues: ValidationIssue[],
    field: string,
    val: unknown,
    allowedSet: Set<string>
  ): void {
    if (val === null || val === undefined) return;

    if (typeof val !== 'string' || !allowedSet.has(val)) {
      issues.push({
        field,
        code: 'ENUM_INVALID_VALUE',
        message: `Value for "${field}" ("${String(val)}") is not in allowed set: [${Array.from(allowedSet).join(', ')}]`,
        value: val,
        severity: 'ERROR',
      });
    }
  }
}
