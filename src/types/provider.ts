import type { RoverTelemetry } from './telemetry';

export type ConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

export type TelemetryListener = (telemetry: RoverTelemetry) => void;
export type StatusListener = (status: ConnectionStatus) => void;

/**
 * Transport-independent Telemetry Provider Interface.
 *
 * Implemented by concrete providers (JsonTelemetryProvider, MqttTelemetryProvider,
 * SerialTelemetryProvider, PlaybackTelemetryProvider).
 *
 * Consumers (React UI, logging engines, analyzers) depend exclusively on this interface.
 */
export interface TelemetryProvider {
  /** Unique provider identifier (e.g. "json-static", "mqtt-live", "serial-usb") */
  readonly id: string;

  /** Human-readable display name */
  readonly name: string;

  /** Current connection lifecycle state */
  getStatus(): ConnectionStatus;

  /** Establish connection or initialize telemetry stream */
  connect(): Promise<void>;

  /** Terminate connection and clean up resources */
  disconnect(): Promise<void>;

  /**
   * Subscribe to incoming telemetry frames.
   * @param listener Callback invoked when a new telemetry packet is received
   * @returns Unsubscribe function to release the subscription
   */
  subscribe(listener: TelemetryListener): () => void;

  /**
   * Register a callback for connection lifecycle status transitions.
   * @param listener Callback invoked on status change
   * @returns Unsubscribe function to release the status listener
   */
  onStatusChange(listener: StatusListener): () => void;
}
