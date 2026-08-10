import type { ValidationResult } from '../validation/types';
import type {
  HealthStatusLevel,
  DiagnosticLogLevel,
  DiagnosticLogCategory,
  DiagnosticLogEntry,
  PacketMetrics,
  RuntimeMetrics,
  SystemHealthSnapshot,
} from './types';

/**
 * SystemHealthManager
 *
 * Observes runtime telemetry packets, validation outcomes, and IPC performance
 * to compute deterministic diagnostics and health metrics entirely within the
 * Electron Main host process.
 *
 * Adheres strictly to the Single Responsibility Principle: observes and reports
 * health metrics without owning telemetry or mutating application state.
 */
export class SystemHealthManager {
  private static readonly MAX_LOG_ENTRIES = 1000;
  private static readonly INTERVAL_WINDOW_SIZE = 20;
  private static readonly STALE_THRESHOLD_MS = 2000;
  private static readonly OFFLINE_THRESHOLD_MS = 10000;
  private static readonly DEGRADED_DROP_PERCENT = 5.0;
  private static readonly CRITICAL_DROP_PERCENT = 20.0;

  private readonly startupTimestamp: number = Date.now();

  private packetsReceived = 0;
  private packetsValidated = 0;
  private packetsDropped = 0;
  private lastPacketTimestamp = 0;
  private lastPacketAgeMs = 0;

  private arrivalTimestamps: number[] = [];
  private intervals: number[] = [];

  private lastIpcDispatchLatencyMs = 0;
  private logs: DiagnosticLogEntry[] = [];
  private logSeq = 0;

  /**
   * Observes an ingested packet and its validation outcome.
   */
  public recordPacketIngest(
    raw: unknown,
    validationResult: ValidationResult
  ): void {
    const now = Date.now();
    this.packetsReceived += 1;

    // Track arrival time for interval and jitter calculations
    if (this.lastPacketTimestamp > 0) {
      const interval = now - this.lastPacketTimestamp;
      this.intervals.push(interval);
      if (this.intervals.length > SystemHealthManager.INTERVAL_WINDOW_SIZE) {
        this.intervals.shift();
      }
    }
    this.lastPacketTimestamp = now;

    // Extract explicitly documented host-receipt timestamp to avoid upstream
    // contract ambiguity (uptime vs epoch).
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const hostReceipt = typeof obj.host_receipt_time_ms === 'number'
          ? obj.host_receipt_time_ms
          : null;

      if (hostReceipt !== null && hostReceipt > 0) {
        this.lastPacketAgeMs = Math.max(0, now - hostReceipt);
      } else {
        // Fallback for older envelopes that lack host_receipt_time_ms
        this.lastPacketAgeMs = Math.max(0, now - this.lastPacketTimestamp);
      }
    }

    if (validationResult.valid) {
      this.packetsValidated += 1;
    } else {
      this.packetsDropped += 1;
      // Record diagnostic entry for validation rejection
      const firstError = validationResult.errors[0];
      this.log(
        'WARN',
        'VALIDATION',
        `Packet rejected: ${firstError ? `[${firstError.field}] ${firstError.message}` : 'Validation failed'}`,
        { errorCount: validationResult.errors.length, code: firstError?.code }
      );
    }
  }

  /**
   * Observes latency of IPC broadcast to renderer processes.
   */
  public recordIpcDispatch(latencyMs: number): void {
    this.lastIpcDispatchLatencyMs = Math.max(0, latencyMs);
  }

  /**
   * Records a diagnostic event into the bounded ring-buffer.
   */
  public log(
    level: DiagnosticLogLevel,
    category: DiagnosticLogCategory,
    message: string,
    details?: Record<string, unknown>
  ): void {
    this.logSeq += 1;
    const entry: DiagnosticLogEntry = {
      id: `diag-${this.logSeq.toString().padStart(6, '0')}`,
      timestamp: Date.now(),
      level,
      category,
      message,
      ...(details ? { details: Object.freeze({ ...details }) } : {}),
    };

    this.logs.push(entry);

    if (this.logs.length > SystemHealthManager.MAX_LOG_ENTRIES) {
      this.logs.shift();
    }
  }

  /**
   * Computes and returns an immutable snapshot of system health and diagnostic metrics.
   */
  public getHealthSnapshot(): SystemHealthSnapshot {
    const now = Date.now();
    const uptimeSeconds = Math.floor((now - this.startupTimestamp) / 1000);

    // Compute average interval and jitter from moving window
    let averageIntervalMs = 0;
    let jitterMs = 0;

    if (this.intervals.length > 0) {
      const sum = this.intervals.reduce((acc, val) => acc + val, 0);
      averageIntervalMs = Math.round(sum / this.intervals.length);

      const absDevSum = this.intervals.reduce(
        (acc, val) => acc + Math.abs(val - averageIntervalMs),
        0
      );
      jitterMs = Math.round(absDevSum / this.intervals.length);
    }

    const estimatedLossRatePercent =
      this.packetsReceived > 0
        ? Number(((this.packetsDropped / this.packetsReceived) * 100).toFixed(2))
        : 0;

    const timeSinceLastPacket =
      this.lastPacketTimestamp > 0 ? now - this.lastPacketTimestamp : Infinity;

    const telemetryFresh =
      this.lastPacketTimestamp > 0 &&
      timeSinceLastPacket < SystemHealthManager.STALE_THRESHOLD_MS;

    // Determine status level
    let status: HealthStatusLevel = 'NOMINAL';

    if (this.packetsReceived === 0 || timeSinceLastPacket >= SystemHealthManager.OFFLINE_THRESHOLD_MS) {
      status = 'OFFLINE';
    } else if (
      timeSinceLastPacket >= SystemHealthManager.STALE_THRESHOLD_MS ||
      estimatedLossRatePercent >= SystemHealthManager.CRITICAL_DROP_PERCENT
    ) {
      status = 'CRITICAL';
    } else if (estimatedLossRatePercent >= SystemHealthManager.DEGRADED_DROP_PERCENT) {
      status = 'DEGRADED';
    }

    // Capture memory metrics safely
    let memoryHeapUsedBytes = 0;
    let memoryHeapTotalBytes = 0;
    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
      const mem = process.memoryUsage();
      memoryHeapUsedBytes = mem.heapUsed;
      memoryHeapTotalBytes = mem.heapTotal;
    }

    const packetMetrics: PacketMetrics = {
      packetsReceived: this.packetsReceived,
      packetsValidated: this.packetsValidated,
      packetsDropped: this.packetsDropped,
      lastPacketTimestamp: this.lastPacketTimestamp,
      lastPacketAgeMs: this.lastPacketAgeMs,
      averageIntervalMs,
      jitterMs,
      estimatedLossRatePercent,
    };

    const runtimeMetrics: RuntimeMetrics = {
      startupTimestamp: this.startupTimestamp,
      uptimeSeconds,
      lastIpcDispatchLatencyMs: this.lastIpcDispatchLatencyMs,
      memoryHeapUsedBytes,
      memoryHeapTotalBytes,
    };

    return {
      status,
      telemetryFresh,
      packets: Object.freeze(packetMetrics),
      runtime: Object.freeze(runtimeMetrics),
      recentLogs: Object.freeze([...this.logs]),
    };
  }

  /**
   * Resets diagnostic counters and log buffer.
   */
  public resetMetrics(): void {
    this.packetsReceived = 0;
    this.packetsValidated = 0;
    this.packetsDropped = 0;
    this.lastPacketTimestamp = 0;
    this.lastPacketAgeMs = 0;
    this.arrivalTimestamps = [];
    this.intervals = [];
    this.lastIpcDispatchLatencyMs = 0;
    this.logs = [];
    this.logSeq = 0;
  }
}
