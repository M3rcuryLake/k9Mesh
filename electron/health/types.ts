/**
 * SystemHealthManager Types & Interfaces
 *
 * Defines diagnostic metrics and health state models for the internal
 * Electron Main runtime health monitor.
 */

export type HealthStatusLevel = 'NOMINAL' | 'DEGRADED' | 'CRITICAL' | 'OFFLINE';

export type DiagnosticLogLevel = 'INFO' | 'WARN' | 'ERROR';

export type DiagnosticLogCategory =
  | 'TELEMETRY'
  | 'VALIDATION'
  | 'TRANSPORT'
  | 'IPC'
  | 'HEALTH'
  | 'SYSTEM';

export interface PacketMetrics {
  readonly packetsReceived: number;
  readonly packetsValidated: number;
  readonly packetsDropped: number;
  readonly lastPacketTimestamp: number;
  readonly lastPacketAgeMs: number;
  readonly averageIntervalMs: number;
  readonly jitterMs: number;
  readonly estimatedLossRatePercent: number;
}

export interface RuntimeMetrics {
  readonly startupTimestamp: number;
  readonly uptimeSeconds: number;
  readonly lastIpcDispatchLatencyMs: number;
  readonly memoryHeapUsedBytes: number;
  readonly memoryHeapTotalBytes: number;
}

export interface DiagnosticLogEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly level: DiagnosticLogLevel;
  readonly category: DiagnosticLogCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SystemHealthSnapshot {
  readonly status: HealthStatusLevel;
  readonly telemetryFresh: boolean;
  readonly packets: PacketMetrics;
  readonly runtime: RuntimeMetrics;
  readonly recentLogs: readonly DiagnosticLogEntry[];
}
