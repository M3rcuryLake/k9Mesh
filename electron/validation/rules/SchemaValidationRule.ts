import type { ValidationRule, ValidationIssue } from '../types';

/**
 * SchemaValidationRule
 *
 * Verifies that the packet structure conforms to the basic ICD message envelope
 * or telemetry data schema, and ensures category containers are valid objects.
 */
export class SchemaValidationRule implements ValidationRule {
  public readonly id = 'schema-structure';
  public readonly name = 'ICD Schema Structure Validation Rule';

  public validate(packet: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
      issues.push({
        field: 'root',
        code: 'SCHEMA_INVALID_ROOT',
        message: 'Telemetry packet must be a non-null, non-array object.',
        value: packet,
        severity: 'ERROR',
      });
      return issues;
    }

    const obj = packet as Record<string, unknown>;

    // Check if envelope format
    const isEnvelope = 'msg_type' in obj && 'data' in obj;
    if (isEnvelope && obj.msg_type !== 'TELEMETRY') {
      issues.push({
        field: 'msg_type',
        code: 'SCHEMA_INVALID_MSG_TYPE',
        message: `Expected msg_type to be "TELEMETRY", received "${String(obj.msg_type)}"`,
        value: obj.msg_type,
        severity: 'ERROR',
      });
    }

    const dataObj = isEnvelope ? (obj.data as Record<string, unknown> | undefined) : obj;

    if (!dataObj || typeof dataObj !== 'object' || Array.isArray(dataObj)) {
      issues.push({
        field: isEnvelope ? 'data' : 'root',
        code: 'SCHEMA_INVALID_DATA_PAYLOAD',
        message: 'Telemetry payload data container must be a non-null object.',
        value: dataObj,
        severity: 'ERROR',
      });
      return issues;
    }

    // Verify subsystem categories when present
    const categories = [
      'radio',
      'hardware',
      'battery',
      'csi',
      'motion',
      'gps',
      'imu',
      'odometry',
    ];

    for (const cat of categories) {
      if (cat in dataObj && dataObj[cat] !== null && dataObj[cat] !== undefined) {
        if (typeof dataObj[cat] !== 'object' || Array.isArray(dataObj[cat])) {
          issues.push({
            field: cat,
            code: 'SCHEMA_INVALID_CATEGORY_TYPE',
            message: `Category "${cat}" must be an object or null, received ${typeof dataObj[cat]}`,
            value: dataObj[cat],
            severity: 'ERROR',
          });
        }
      }
    }

    return issues;
  }
}
