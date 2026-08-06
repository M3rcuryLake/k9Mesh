import { ipcMain, BrowserWindow } from 'electron';
import type { TelemetrySource, SourceType } from './sources/TelemetrySource';
import { ScenarioSource } from './sources/ScenarioSource';
import { TelemetryValidator, type ValidatorMetrics } from './validation/TelemetryValidator';

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
 * maintains host runtime metrics, and handles secure IPC communication with the renderer process.
 */
export class TelemetryHost {
  private static instance: TelemetryHost | null = null;

  private activeSource: TelemetrySource;
  private currentTelemetry: unknown = null;
  private connectionStatus: HostConnectionStatus = 'DISCONNECTED';
  private validator = new TelemetryValidator();

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
    await this.bindActiveSource();
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

      this.currentTelemetry = data;
      this.broadcastToRenderers('k9mesh:telemetry:update', data);
    });

    this.sourceUnsubscribeStatus = this.activeSource.onStatusChange((connected) => {
      this.connectionStatus = connected ? 'CONNECTED' : 'DISCONNECTED';
      this.runtimeStatus.connected = connected;
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
