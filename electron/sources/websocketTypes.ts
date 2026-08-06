/**
 * WebSocket Source Configuration & Metric Contracts
 *
 * Defines configuration schemas and runtime statistics for the
 * WebSocketTelemetrySource in the Electron Main process.
 */

export interface WebSocketSourceConfig {
  /** Host address to bind the WebSocket server (e.g., '127.0.0.1') */
  readonly host: string;

  /** Port to listen on (default: 8765) */
  readonly port: number;

  /** Maximum permitted incoming message payload size in bytes (default: 65536 = 64KB) */
  readonly maxMessageSizeBytes: number;

  /** Connection timeout in milliseconds (default: 5000) */
  readonly connectionTimeoutMs: number;

  /** Heartbeat interval in milliseconds (default: 1000) */
  readonly heartbeatIntervalMs: number;

  /** Maximum reconnect delay in milliseconds (default: 5000) */
  readonly maxReconnectDelayMs: number;

  /** Maximum concurrent active telemetry producer clients (default: 1) */
  readonly maxActiveClients: number;
}

export const DEFAULT_WEBSOCKET_CONFIG: Readonly<WebSocketSourceConfig> = Object.freeze({
  host: '127.0.0.1',
  port: 8765,
  maxMessageSizeBytes: 65536, // 64 KB
  connectionTimeoutMs: 5000,
  heartbeatIntervalMs: 1000,
  maxReconnectDelayMs: 5000,
  maxActiveClients: 1,
});

export interface WebSocketSourceStats {
  readonly serverListening: boolean;
  readonly activeClientsCount: number;
  readonly totalConnectionsAccepted: number;
  readonly totalConnectionsRejected: number;
  readonly messagesReceived: number;
  readonly messagesDroppedOversized: number;
  readonly messagesDroppedMalformedJson: number;
  readonly lastMessageTimestamp: number;
}
