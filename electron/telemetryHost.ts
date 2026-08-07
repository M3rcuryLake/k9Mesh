import { ipcMain, BrowserWindow } from 'electron';
import type { TelemetrySource, SourceType } from './sources/TelemetrySource';
import { ScenarioSource, type ScenarioName } from './sources/ScenarioSource';
import { WebSocketTelemetrySource } from './sources/WebSocketTelemetrySource';
import type { WebSocketSourceConfig } from './sources/websocketTypes';
import { SourceFactory } from './sources/SourceFactory';
import { TelemetryValidator, type ValidatorMetrics } from './validation/TelemetryValidator';
import { SystemHealthManager } from './health/SystemHealthManager';
import type { SystemHealthSnapshot } from './health/types';

export type HostConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

/**
 * Internal Host Runtime Status
 * Maintained exclusively in the Electron Main process for telemetry diagnostics.
 */
export interface RuntimeStatus {
  transport: SourceType;
  connected: boolean;
  activeProducer: string | null;
  lastPacketTimestamp: number;
  lastPacketAgeMs: number;
  packetsReceived: number;
  packetsParsed: number;
  packetsAdapted: number;
  packetsValidated: number;
  packetsPublished: number;
  packetsDropped: number;
  malformedPackets: number;
  oversizedPackets: number;
  schemaFailures: number;
  reconnectCount: number;
  currentPacketRateHz: number;
  averagePacketRateHz: number;
  minPipelineLatencyMs: number;
  maxPipelineLatencyMs: number;
  avgPipelineLatencyMs: number;
}

/**
 * TelemetryHost
 *
 * The authoritative runtime host for K9Mesh telemetry.
 * Manages active TelemetrySource, runs validation through TelemetryValidator,
 * maintains health metrics via SystemHealthManager,
 * and handles secure IPC communication with the renderer process.
 */
export class TelemetryHost {
  private static instance: TelemetryHost | null = null;

  private activeSource: TelemetrySource;
  private currentTelemetry: unknown = null;
  private connectionStatus: HostConnectionStatus = 'DISCONNECTED';
  private validator = new TelemetryValidator();
  private healthManager = new SystemHealthManager();

  private sessionStartTime = Date.now();
  private packetTimestampsWindow: number[] = [];
  private totalLatencyMs = 0;
  private latencySamplesCount = 0;
  private minLatencyMs = Number.MAX_VALUE;
  private maxLatencyMs = 0;

  private runtimeStatus: RuntimeStatus = {
    transport: 'scenario',
    connected: false,
    activeProducer: null,
    lastPacketTimestamp: 0,
    lastPacketAgeMs: 0,
    packetsReceived: 0,
    packetsParsed: 0,
    packetsAdapted: 0,
    packetsValidated: 0,
    packetsPublished: 0,
    packetsDropped: 0,
    malformedPackets: 0,
    oversizedPackets: 0,
    schemaFailures: 0,
    reconnectCount: 0,
    currentPacketRateHz: 0,
    averagePacketRateHz: 0,
    minPipelineLatencyMs: 0,
    maxPipelineLatencyMs: 0,
    avgPipelineLatencyMs: 0,
  };

  private sourceUnsubscribeTelemetry: (() => void) | null = null;
  private sourceUnsubscribeStatus: (() => void) | null = null;

  private isDebug(): boolean {
    return (
      typeof process !== 'undefined' &&
      (process.env.DEBUG_TELEMETRY === '1' ||
        process.env.DEBUG === 'true' ||
        process.env.DEBUG === '1')
    );
  }

  private constructor() {
    // Determine and instantiate initial source using SourceFactory
    this.activeSource = SourceFactory.createInitialSource();
    this.runtimeStatus.transport = this.activeSource.type;
  }

  public static getInstance(): TelemetryHost {
    if (!TelemetryHost.instance) {
      TelemetryHost.instance = new TelemetryHost();
    }
    return TelemetryHost.instance;
  }

  /**
   * Initializes the TelemetryHost, registers IPC handlers, and starts the active source.
   */
  public async initialize(): Promise<void> {
    this.registerIpcHandlers();
    await this.bindActiveSource();
  }

  public async setSource(source: TelemetrySource): Promise<void> {
    if (this.activeSource === source) return;

    if (this.sourceUnsubscribeTelemetry) this.sourceUnsubscribeTelemetry();
    if (this.sourceUnsubscribeStatus) this.sourceUnsubscribeStatus();
    await this.activeSource.stop();

    this.activeSource = source;
    this.runtimeStatus.transport = source.type;
    this.healthManager.log(
      'INFO',
      'TRANSPORT',
      `Active telemetry source switched to "${source.id}" (${source.type})`,
      { sourceId: source.id, sourceType: source.type }
    );
    await this.bindActiveSource();
  }

  public async switchToWebSocketSource(
    config?: Partial<WebSocketSourceConfig>
  ): Promise<void> {
    const wsSource = SourceFactory.createSource({ type: 'websocket', wsConfig: config });
    await this.setSource(wsSource);
  }

  public async switchToScenarioSource(
    scenarioName: ScenarioName = 'survivor_detected'
  ): Promise<void> {
    const scenarioSource = SourceFactory.createSource({ type: 'scenario', scenario: scenarioName });
    await this.setSource(scenarioSource);
  }

  public getActiveSource(): TelemetrySource {
    return this.activeSource;
  }

  public getRuntimeStatus(): RuntimeStatus {
    const now = Date.now();
    const wsStats =
      this.activeSource instanceof WebSocketTelemetrySource ? this.activeSource.getStats() : null;

    // Prune sliding window for Hz calculation (last 1000ms)
    this.packetTimestampsWindow = this.packetTimestampsWindow.filter((t) => now - t <= 1000);
    const currentRate = this.packetTimestampsWindow.length;

    const streamDurationSec = Math.max(1, (now - this.sessionStartTime) / 1000);
    const avgRate = parseFloat((this.runtimeStatus.packetsPublished / streamDurationSec).toFixed(2));

    return {
      ...this.runtimeStatus,
      activeProducer: wsStats ? wsStats.activeProducerAddress : null,
      packetsReceived: wsStats ? wsStats.messagesReceived : this.runtimeStatus.packetsReceived,
      packetsParsed: wsStats ? wsStats.messagesParsed : this.runtimeStatus.packetsReceived,
      packetsAdapted: wsStats ? wsStats.messagesAdapted : this.runtimeStatus.packetsReceived,
      malformedPackets: wsStats ? wsStats.messagesDroppedMalformedJson : 0,
      oversizedPackets: wsStats ? wsStats.messagesDroppedOversized : 0,
      schemaFailures: wsStats ? wsStats.messagesDroppedSchema : 0,
      reconnectCount: wsStats ? wsStats.reconnectCount : 0,
      currentPacketRateHz: currentRate,
      averagePacketRateHz: avgRate,
      lastPacketAgeMs:
        this.runtimeStatus.lastPacketTimestamp > 0
          ? now - this.runtimeStatus.lastPacketTimestamp
          : 0,
      minPipelineLatencyMs: this.minLatencyMs === Number.MAX_VALUE ? 0 : this.minLatencyMs,
      maxPipelineLatencyMs: this.maxLatencyMs,
      avgPipelineLatencyMs:
        this.latencySamplesCount > 0
          ? parseFloat((this.totalLatencyMs / this.latencySamplesCount).toFixed(2))
          : 0,
    };
  }

  public getValidatorMetrics(): ValidatorMetrics {
    return this.validator.getMetrics();
  }

  public getHealthSnapshot(): SystemHealthSnapshot {
    return this.healthManager.getHealthSnapshot();
  }

  public async dispose(): Promise<void> {
    if (this.sourceUnsubscribeTelemetry) this.sourceUnsubscribeTelemetry();
    if (this.sourceUnsubscribeStatus) this.sourceUnsubscribeStatus();
    await this.activeSource.stop();

    ipcMain.removeHandler('k9mesh:telemetry:get-current');
    ipcMain.removeHandler('k9mesh:telemetry:get-status');
    ipcMain.removeHandler('k9mesh:telemetry:load-scenario');
  }

  private async bindActiveSource(): Promise<void> {
    this.sourceUnsubscribeTelemetry = this.activeSource.onTelemetry((data) => {
      const now = Date.now();
      this.runtimeStatus.lastPacketTimestamp = now;
      this.runtimeStatus.packetsReceived += 1;
      this.packetTimestampsWindow.push(now);

      // Validate incoming telemetry packet through composed validation rules
      const result = this.validator.validate(data);

      // SystemHealthManager observes raw packet and validation outcome
      this.healthManager.recordPacketIngest(data, result);

      if (!result.valid) {
        this.runtimeStatus.packetsDropped += 1;
        console.warn(
          `[Validator] Packet rejected from source "${this.activeSource.id}". Issues:\n` +
            result.errors
              .map((e) => `  - [${e.field}] ${e.code}: ${e.message}`)
              .join('\n')
        );
        return;
      }

      this.runtimeStatus.packetsValidated += 1;
      if (this.isDebug()) {
        console.log('[Validator] Accepted');
      }

      if (result.warnings.length > 0) {
        console.info(
          `[Validator] Packet accepted with warnings:\n` +
            result.warnings
              .map((w) => `  - [${w.field}] ${w.code}: ${w.message}`)
              .join('\n')
        );
      }

      const startIpc = Date.now();
      this.currentTelemetry = data;
      this.broadcastToRenderers('k9mesh:telemetry:update', data);
      const ipcDurationMs = Date.now() - startIpc;
      this.healthManager.recordIpcDispatch(ipcDurationMs);

      // Track latency samples
      this.latencySamplesCount += 1;
      this.totalLatencyMs += ipcDurationMs;
      if (ipcDurationMs < this.minLatencyMs) this.minLatencyMs = ipcDurationMs;
      if (ipcDurationMs > this.maxLatencyMs) this.maxLatencyMs = ipcDurationMs;

      this.runtimeStatus.packetsPublished += 1;
      if (this.isDebug()) {
        console.log(`[Host] Published (dispatch time: ${ipcDurationMs}ms)`);
      }
    });

    this.sourceUnsubscribeStatus = this.activeSource.onStatusChange((connected) => {
      this.connectionStatus = connected ? 'CONNECTED' : 'DISCONNECTED';
      this.runtimeStatus.connected = connected;
      this.healthManager.log(
        'INFO',
        'TRANSPORT',
        `Transport link ${connected ? 'CONNECTED' : 'DISCONNECTED'}`,
        { sourceId: this.activeSource.id, connected }
      );
      this.broadcastToRenderers('k9mesh:telemetry:status', this.connectionStatus);
    });

    await this.activeSource.start();
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('k9mesh:telemetry:get-current', async () => {
      return this.currentTelemetry ?? this.activeSource.getCurrentTelemetry();
    });

    ipcMain.handle('k9mesh:telemetry:get-status', async () => {
      return this.connectionStatus;
    });

    ipcMain.handle('k9mesh:telemetry:load-scenario', async (_event, scenarioName: string) => {
      if (this.activeSource instanceof ScenarioSource) {
        this.activeSource.loadScenario(scenarioName);
        this.healthManager.log(
          'INFO',
          'TELEMETRY',
          `Deterministic scenario loaded: "${scenarioName}"`,
          { scenario: scenarioName }
        );
        return { success: true };
      }
      throw new Error(
        `[TelemetryHost] Cannot load scenario: active source is "${this.activeSource.type}", not "scenario"`
      );
    });
  }

  private broadcastToRenderers(channel: string, payload: unknown): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }
}
