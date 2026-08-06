import type {
  ValidationRule,
  ValidationResult,
  ValidationIssue,
} from './types';
import { SchemaValidationRule } from './rules/SchemaValidationRule';
import { TimestampValidationRule } from './rules/TimestampValidationRule';
import { EngineeringValidationRule } from './rules/EngineeringValidationRule';
import { EnumValidationRule } from './rules/EnumValidationRule';

export interface ValidatorMetrics {
  acceptedPackets: number;
  rejectedPackets: number;
  lastValidationTime: number;
  lastValidationError: string | null;
  lastPacketAgeMs: number;
}

/**
 * TelemetryValidator Orchestrator
 *
 * Coordinates independent validation rules to ensure telemetry integrity before
 * data reaches the mapper or React renderer. Maintains internal performance
 * and diagnostic metrics.
 */
export class TelemetryValidator {
  private rules: ValidationRule[] = [];

  private metrics: ValidatorMetrics = {
    acceptedPackets: 0,
    rejectedPackets: 0,
    lastValidationTime: 0,
    lastValidationError: null,
    lastPacketAgeMs: 0,
  };

  constructor(customRules?: ValidationRule[]) {
    if (customRules && customRules.length > 0) {
      this.rules = [...customRules];
    } else {
      // Default rule composition
      this.rules = [
        new SchemaValidationRule(),
        new TimestampValidationRule(),
        new EngineeringValidationRule(),
        new EnumValidationRule(),
      ];
    }
  }

  /**
   * Registers an additional validation rule (Open/Closed Principle).
   */
  public addRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  /**
   * Validates a telemetry packet against all registered validation rules.
   * Never throws uncaught exceptions.
   */
  public validate(packet: unknown): ValidationResult {
    const allIssues: ValidationIssue[] = [];
    const now = Date.now();

    for (const rule of this.rules) {
      try {
        const issues = rule.validate(packet);
        if (issues && issues.length > 0) {
          allIssues.push(...issues);
        }
      } catch (err) {
        allIssues.push({
          field: 'validator',
          code: 'VALIDATOR_RULE_EXECUTION_EXCEPTION',
          message: `Rule "${rule.name}" threw an exception: ${err instanceof Error ? err.message : String(err)}`,
          severity: 'ERROR',
        });
      }
    }

    const errors = allIssues.filter((i) => i.severity === 'ERROR');
    const warnings = allIssues.filter((i) => i.severity === 'WARNING');
    const infos = allIssues.filter((i) => i.severity === 'INFO');
    const valid = errors.length === 0;

    // Update diagnostic metrics
    this.metrics.lastValidationTime = now;
    if (valid) {
      this.metrics.acceptedPackets += 1;
    } else {
      this.metrics.rejectedPackets += 1;
      this.metrics.lastValidationError = errors[0]
        ? `[${errors[0].field}] ${errors[0].message}`
        : 'Unknown validation failure';
    }

    // Compute packet age if timestamp is present
    if (packet && typeof packet === 'object') {
      const obj = packet as Record<string, unknown>;
      const rawTs =
        'timestamp_epoch_ms' in obj
          ? obj.timestamp_epoch_ms
          : 'timestamp' in obj
          ? obj.timestamp
          : undefined;
      if (typeof rawTs === 'number' && rawTs > 0) {
        this.metrics.lastPacketAgeMs = now - rawTs;
      }
    }

    return {
      valid,
      issues: allIssues,
      errors,
      warnings,
      infos,
    };
  }

  public getMetrics(): ValidatorMetrics {
    return { ...this.metrics };
  }

  public resetMetrics(): void {
    this.metrics = {
      acceptedPackets: 0,
      rejectedPackets: 0,
      lastValidationTime: 0,
      lastValidationError: null,
      lastPacketAgeMs: 0,
    };
  }
}
