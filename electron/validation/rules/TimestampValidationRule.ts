import type { ValidationRule, ValidationIssue } from '../types';

/**
 * TimestampValidationRule
 *
 * Verifies that the telemetry packet includes a valid numeric epoch timestamp,
 * checks for future drift and reasonable packet sanity.
 */
export class TimestampValidationRule implements ValidationRule {
  public readonly id = 'timestamp-sanity';
  public readonly name = 'Timestamp Sanity & Freshness Rule';

  public validate(packet: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!packet || typeof packet !== 'object') return issues;

    const obj = packet as Record<string, unknown>;
    const rawTs =
      'timestamp_epoch_ms' in obj
        ? obj.timestamp_epoch_ms
        : 'timestamp' in obj
        ? obj.timestamp
        : undefined;

    if (rawTs === undefined || rawTs === null) {
      issues.push({
        field: 'timestamp_epoch_ms',
        code: 'TIMESTAMP_MISSING',
        message: 'Telemetry packet must contain a timestamp.',
        value: rawTs,
        severity: 'WARNING',
      });
      return issues;
    }

    if (typeof rawTs !== 'number' || !Number.isFinite(rawTs) || rawTs <= 0) {
      issues.push({
        field: 'timestamp_epoch_ms',
        code: 'TIMESTAMP_INVALID_NUMERIC',
        message: `Timestamp must be a positive finite integer, received "${String(rawTs)}"`,
        value: rawTs,
        severity: 'ERROR',
      });
      return issues;
    }

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Check if timestamp is significantly in the future (> 10 minutes ahead of host clock)
    if (rawTs > now + 10 * 60 * 1000) {
      issues.push({
        field: 'timestamp_epoch_ms',
        code: 'TIMESTAMP_FUTURE_DRIFT',
        message: `Packet timestamp is in the future (${rawTs - now}ms ahead of host clock).`,
        value: rawTs,
        severity: 'WARNING',
      });
    }

    // Informational notice if packet is older than 24 hours (e.g. historical log replay or scenario baseline)
    if (now - rawTs > oneDayMs) {
      issues.push({
        field: 'timestamp_epoch_ms',
        code: 'TIMESTAMP_HISTORICAL',
        message: `Packet contains historical or scenario timestamp (${new Date(rawTs).toISOString()}).`,
        value: rawTs,
        severity: 'INFO',
      });
    }

    return issues;
  }
}
