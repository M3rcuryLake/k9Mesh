export type SourceType = 'scenario' | 'mqtt' | 'serial' | 'playback';

export type SourceTelemetryListener = (data: unknown) => void;
export type SourceStatusListener = (connected: boolean) => void;

/**
 * TelemetrySource Interface (Electron Main Process)
 *
 * Defines the contract for all telemetry ingestion sources in the Electron host.
 * TelemetryHost relies exclusively on this abstraction, decoupling host runtime
 * management from concrete transport protocols (Static Scenarios, MQTT, Serial, Playback).
 */
export interface TelemetrySource {
  /** Unique source identifier */
  readonly id: string;

  /** Transport classification */
  readonly type: SourceType;

  /** Human-readable display name */
  readonly name: string;

  /** Initializes and starts telemetry acquisition */
  start(): Promise<void>;

  /** Stops acquisition and cleans up transport resources */
  stop(): Promise<void>;

  /** Subscribe to incoming telemetry packets from this source */
  onTelemetry(listener: SourceTelemetryListener): () => void;

  /** Subscribe to connection / availability status transitions */
  onStatusChange(listener: SourceStatusListener): () => void;

  /** Retrieve latest telemetry snapshot from this source */
  getCurrentTelemetry(): unknown | null;

  /** Check if source is actively connected / ready */
  isConnected(): boolean;
}
