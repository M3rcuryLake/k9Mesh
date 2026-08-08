import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type {
  TelemetrySource,
  SourceType,
  SourceTelemetryListener,
  SourceStatusListener,
} from './TelemetrySource';
import {
  type WebSocketSourceConfig,
  type WebSocketSourceStats,
  DEFAULT_WEBSOCKET_CONFIG,
} from './websocketTypes';
import { CsiTelemetryAdapter } from '../adapters/CsiTelemetryAdapter';
import type { AdapterDiagnostics, RawMicroESPectrePacket } from '../adapters/types';

/**
 * WebSocketTelemetrySource
 *
 * Implements TelemetrySource for real-time telemetry streaming over a local
 * WebSocket server. Connects to Python-based producers (e.g., Micro-ESPectre CSI pipeline).
 *
 * Enforces:
 * - Single active client ownership (rejects concurrent connections)
 * - Maximum packet size boundary
 * - Safe JSON parsing boundary (never throws or crashes on malformed frames)
 * - Autonomous client reconnect support (server remains listening on client disconnect)
 * - Internal CSI Telemetry Adapter normalizing vendor packets into Master ICD envelopes
 * - Zero coupling to React or renderer processes
 */
export class WebSocketTelemetrySource implements TelemetrySource {
  public readonly id = 'websocket-live';
  public readonly type: SourceType = 'websocket';
  public readonly name = 'Live WebSocket Source (Python CSI)';

  private readonly config: WebSocketSourceConfig;
  private readonly adapter = new CsiTelemetryAdapter();
  private wss: WebSocketServer | null = null;
  private activeSocket: WebSocket | null = null;

  private isListening = false;
  private connected = false;
  private currentData: unknown | null = null;

  private telemetryListeners = new Set<SourceTelemetryListener>();
  private statusListeners = new Set<SourceStatusListener>();

  private stats: {
    totalConnectionsAccepted: number;
    totalConnectionsRejected: number;
    reconnectCount: number;
    messagesReceived: number;
    messagesParsed: number;
    messagesAdapted: number;
    messagesDroppedOversized: number;
    messagesDroppedMalformedJson: number;
    messagesDroppedSchema: number;
    lastMessageTimestamp: number;
  } = {
    totalConnectionsAccepted: 0,
    totalConnectionsRejected: 0,
    reconnectCount: 0,
    messagesReceived: 0,
    messagesParsed: 0,
    messagesAdapted: 0,
    messagesDroppedOversized: 0,
    messagesDroppedMalformedJson: 0,
    messagesDroppedSchema: 0,
    lastMessageTimestamp: 0,
  };

  private isDebug(): boolean {
    return (
      typeof process !== 'undefined' &&
      (process.env.DEBUG_TELEMETRY === '1' ||
        process.env.DEBUG === 'true' ||
        process.env.DEBUG === '1')
    );
  }

  constructor(config?: Partial<WebSocketSourceConfig>) {
    this.config = Object.freeze({
      ...DEFAULT_WEBSOCKET_CONFIG,
      ...config,
    });
  }

  public async start(): Promise<void> {
    if (this.wss) return;

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          host: this.config.host,
          port: this.config.port,
        });

        this.wss.on('listening', () => {
          this.isListening = true;
          console.info(`[WS] Listening on ws://${this.config.host}:${this.config.port}`);
          console.info('[WS] Waiting for producer...');
          resolve();
        });

        this.wss.on('connection', (socket: WebSocket, req) => {
          this.handleIncomingConnection(socket, req.socket.remoteAddress);
        });

        this.wss.on('error', (err: Error) => {
          console.error('[WS] Server error:', err.message);
          // If server fails to bind during initial start, reject promise
          if (!this.isListening) {
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public async stop(): Promise<void> {
    if (!this.wss) return;

    return new Promise((resolve) => {
      // Cleanly terminate active client socket
      if (this.activeSocket) {
        try {
          this.activeSocket.removeAllListeners();
          this.activeSocket.terminate();
        } catch {
          // Ignore socket termination errors during teardown
        }
        this.activeSocket = null;
      }

      this.setConnected(false);

      this.wss?.close(() => {
        this.wss = null;
        this.isListening = false;
        console.info('[WS] WebSocket server stopped and port released.');
        resolve();
      });
    });
  }

  public onTelemetry(listener: SourceTelemetryListener): () => void {
    this.telemetryListeners.add(listener);
    if (this.connected && this.currentData) {
      listener(this.currentData);
    }
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  public onStatusChange(listener: SourceStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.connected);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public getCurrentTelemetry(): unknown | null {
    return this.currentData;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public getConfig(): Readonly<WebSocketSourceConfig> {
    return this.config;
  }

  public getStats(): WebSocketSourceStats {
    const remoteAddr =
      this.activeSocket && (this.activeSocket as unknown as { _socket?: { remoteAddress?: string } })._socket?.remoteAddress;
    return Object.freeze({
      serverListening: this.isListening,
      activeClientsCount: this.activeSocket !== null ? 1 : 0,
      activeProducerAddress: this.activeSocket !== null ? (remoteAddr ?? '127.0.0.1') : null,
      totalConnectionsAccepted: this.stats.totalConnectionsAccepted,
      totalConnectionsRejected: this.stats.totalConnectionsRejected,
      reconnectCount: this.stats.reconnectCount,
      messagesReceived: this.stats.messagesReceived,
      messagesParsed: this.stats.messagesParsed,
      messagesAdapted: this.stats.messagesAdapted,
      messagesDroppedOversized: this.stats.messagesDroppedOversized,
      messagesDroppedMalformedJson: this.stats.messagesDroppedMalformedJson,
      messagesDroppedSchema: this.stats.messagesDroppedSchema,
      lastMessageTimestamp: this.stats.lastMessageTimestamp,
    });
  }

  public getAdapterDiagnostics(): AdapterDiagnostics {
    return this.adapter.getDiagnostics();
  }

  public getAdapter(): CsiTelemetryAdapter {
    return this.adapter;
  }

  private handleIncomingConnection(socket: WebSocket, remoteAddress?: string): void {
    // Enforce single active client ownership
    if (this.activeSocket !== null && this.activeSocket.readyState === WebSocket.OPEN) {
      this.stats.totalConnectionsRejected += 1;
      console.warn(
        `[WS] Rejected connection from ${remoteAddress ?? 'unknown'}: Single client limit (${this.config.maxActiveClients}) reached.`
      );
      socket.close(4001, 'Another telemetry producer is already connected');
      return;
    }

    if (this.stats.totalConnectionsAccepted > 0) {
      this.stats.reconnectCount += 1;
    }

    this.activeSocket = socket;
    this.stats.totalConnectionsAccepted += 1;
    this.setConnected(true);
    console.log(
      `[WS] Producer connected from ${remoteAddress ?? '127.0.0.1'}`
    );

    socket.on('message', (rawData: RawData, isBinary: boolean) => {
      this.handleIncomingMessage(rawData, isBinary);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      this.handleClientClose(socket, code, reason.toString('utf-8'));
    });

    socket.on('error', (err: Error) => {
      this.handleClientError(socket, err);
    });
  }

  private handleIncomingMessage(rawData: RawData, _isBinary: boolean): void {
    this.stats.messagesReceived += 1;

    // Determine payload byte length
    const byteLength = this.getRawDataLength(rawData);

    if (byteLength > this.config.maxMessageSizeBytes) {
      this.stats.messagesDroppedOversized += 1;
      console.warn(
        `[WS] Packet rejected: ${byteLength} bytes exceeds limit of ${this.config.maxMessageSizeBytes} bytes.`
      );
      return;
    }

    // Convert to UTF-8 text string
    const text = this.rawDataToString(rawData);

    // Defensive JSON parsing boundary
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
      this.stats.messagesParsed += 1;
    } catch (err) {
      this.stats.messagesDroppedMalformedJson += 1;
      console.warn(
        `[WS] Packet rejected: Malformed JSON - ${(err as Error).message}`
      );
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      this.stats.messagesDroppedMalformedJson += 1;
      console.warn('[WS] Packet rejected: Non-object JSON payload');
      return;
    }

    const rawPkt = parsed as RawMicroESPectrePacket | Record<string, unknown>;
    const seqNum =
      typeof rawPkt.seq === 'number'
        ? rawPkt.seq
        : typeof rawPkt.sequence === 'number'
        ? rawPkt.sequence
        : null;

    if (this.isDebug()) {
      console.log(`[WS] Packet #${seqNum !== null ? seqNum : this.stats.messagesReceived}`);
      console.log('[Parser] JSON OK');
    }

    // Adapt raw Micro-ESPectre packet into Master ICD RoverTelemetryEnvelope
    const adapted = this.adapter.adapt(rawPkt);

    if (!adapted) {
      this.stats.messagesDroppedSchema += 1;
      console.warn('[Adapter] Packet rejected by CsiTelemetryAdapter');
      return;
    }

    this.stats.messagesAdapted += 1;
    if (this.isDebug()) {
      console.log(`[Adapter] Normalized (seq: ${seqNum})`);
    }

    this.currentData = adapted;
    this.stats.lastMessageTimestamp = Date.now();
    this.notifyTelemetry(adapted);
  }

  private handleClientClose(socket: WebSocket, code: number, reason: string): void {
    if (this.activeSocket === socket) {
      this.activeSocket = null;
      this.setConnected(false);
      console.log(
        `[WS] Producer disconnected (code: ${code}, reason: "${reason || 'none'}")`
      );
      console.info('[WS] Waiting for producer...');
    }
  }

  private handleClientError(socket: WebSocket, err: Error): void {
    console.error('[WS] Producer socket error:', err.message);
    if (this.activeSocket === socket) {
      this.activeSocket = null;
      this.setConnected(false);
      console.info('[WS] Waiting for producer...');
    }
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.statusListeners.forEach((listener) => {
      try {
        listener(connected);
      } catch (err) {
        console.error('[WebSocketTelemetrySource] Error in status listener:', err);
      }
    });
  }

  private notifyTelemetry(data: unknown): void {
    this.telemetryListeners.forEach((listener) => {
      try {
        listener(data);
      } catch (err) {
        console.error('[WebSocketTelemetrySource] Error in telemetry listener:', err);
      }
    });
  }

  private getRawDataLength(rawData: RawData): number {
    if (Buffer.isBuffer(rawData)) {
      return rawData.length;
    }
    if (Array.isArray(rawData)) {
      return rawData.reduce((acc, chunk) => acc + chunk.length, 0);
    }
    if (rawData instanceof ArrayBuffer) {
      return rawData.byteLength;
    }
    return String(rawData).length;
  }

  private rawDataToString(rawData: RawData): string {
    if (Buffer.isBuffer(rawData)) {
      return rawData.toString('utf-8');
    }
    if (Array.isArray(rawData)) {
      return Buffer.concat(rawData).toString('utf-8');
    }
    if (rawData instanceof ArrayBuffer) {
      return Buffer.from(rawData).toString('utf-8');
    }
    return String(rawData);
  }
}
