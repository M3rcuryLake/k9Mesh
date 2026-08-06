import { ipcMain, BrowserWindow } from 'electron';
import type { TelemetrySource, SourceType } from './sources/TelemetrySource';
import { ScenarioSource, type ScenarioName } from './sources/ScenarioSource';
import { WebSocketTelemetrySource } from './sources/WebSocketTelemetrySource';
import type { WebSocketSourceConfig } from './sources/websocketTypes';
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
  lastPacketTimestamp: number;
  lastPacketAgeMs: number;
  packetsReceived: number;
  packetsDropped: number;
  reconnectAttempts: number;
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

  private runtimeStatus: RuntimeStatus = {
    transport: 'scenario',
    connected: false,
    lastPacketTimestamp: 0,
    lastPacketAgeMs: 0,
    packetsReceived: 0,
    packetsDropped: 0,
    reconnectAttempts: 0,
  };

  private sourceUnsubscribeTelemetry: (() => void) | null = null;
  private sourceUnsubscribeStatus: (() => void) | null = null;

  private constructor() {
    // Default to deterministic ScenarioSource
    this.activeSource = new ScenarioSource('survivor_detected');
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
    const wsSource = new WebSocketTelemetrySource(config);
    await this.setSource(wsSource);
  }

  public async switchToScenarioSource(
    scenarioName: ScenarioName = 'survivor_detected'
  ): Promise<void> {
    const scenarioSource = new ScenarioSource(scenarioName);
    await this.setSource(scenarioSource);
  }

  public getActiveSource(): TelemetrySource {
    return this.activeSource;
  }

  public getRuntimeStatus(): RuntimeStatus {
    const now = Date.now();
    return {
      ...this.runtimeStatus,
      lastPacketAgeMs:
        this.runtimeStatus.lastPacketTimestamp > 0
          ? now - this.runtimeStatus.lastPacketTimestamp
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
      this.runtimeStatus.lastPacketTimestamp = Date.now();
      this.runtimeStatus.packetsReceived += 1;

      // Validate incoming telemetry packet through composed validation rules
      const result = this.validator.validate(data);

      // SystemHealthManager observes raw packet and validation outcome
      this.healthManager.recordPacketIngest(data, result);

      if (!result.valid) {
        this.runtimeStatus.packetsDropped += 1;
        console.warn(
          `[TelemetryHost] Dropped invalid telemetry packet from source "${this.activeSource.id}". Issues:\n` +
            result.errors
              .map((e) => `  - [${e.field}] ${e.code}: ${e.message}`)
              .join('\n')
        );
        return;
      }

      if (result.warnings.length > 0) {
        console.info(
          `[TelemetryHost] Telemetry packet accepted with warnings:\n` +
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
