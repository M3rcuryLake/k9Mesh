export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
  value?: unknown;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  /** True if no issues with severity === 'ERROR' exist */
  valid: boolean;
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  infos: ValidationIssue[];
}

/**
 * ValidationRule Interface
 *
 * Implemented by independent rule modules adhering to the Open/Closed Principle.
 * Composed by TelemetryValidator without coupling validation rules together.
 */
export interface ValidationRule {
  readonly id: string;
  readonly name: string;

  /**
   * Validates a raw or parsed telemetry packet.
   * Returns an array of detected issues (empty if compliant).
   */
  validate(packet: unknown): ValidationIssue[];
}
