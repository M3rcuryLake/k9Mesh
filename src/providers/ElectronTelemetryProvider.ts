import type {
  TelemetryProvider,
  ConnectionStatus,
  TelemetryListener,
  StatusListener,
} from '../types/provider';
import type { RoverTelemetry } from '../types/telemetry';
import type { ICDTelemetryMessage, ICDRoverTelemetryData } from '../types/icd';
import { TelemetryMapper, NULL_TELEMETRY } from '../mappers/TelemetryMapper';
//import { TelemetryMapper, NULL_TELEMETRY } from '../mapperrs/TelemetryMapper.ts';
/**
 * ElectronTelemetryProvider
 * Proceeed as follows:
 * do not provide mcct data to other plugin ports 
 *
 * Consumes telemetry exclusively through the context-isolated Electron IPC bridge
 * (`window.k9mesh.telemetry`).
 *
 * Implements TelemetryProvider, ensuring the React UI remains transport-independent.
 */
export class ElectronTelemetryProvider implements TelemetryProvider {
  public readonly id = 'electron-ipc';
  public readonly name = 'Electron IPC Runtime Bridge';
  //public readonly class = 'section report telemetry'

  private status: ConnectionStatus = 'DISCONNECTED';
  private currentTelemetry: RoverTelemetry = { ...NULL_TELEMETRY };

  private telemetryListeners = new Set<TelemetryListener>();
  private statusListeners = new Set<StatusListener>();

  private ipcUnsubscribeTelemetry: (() => void) | null = null;
  private ipcUnsubscribeStatus: (() => void) | null = null;

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  // public getValidatedMarks: ValidatedMarks => {
  // return ValidatedMarks todo : creating specific files for making getStdio.H

  public getCurrentTelemetry(): RoverTelemetry {
    return this.currentTelemetry;
  }

  public async connect(): Promise<void> {
    if (this.status === 'CONNECTED') return;

    const bridge = typeof window !== 'undefined' ? window.k9mesh?.telemetry : undefined;

    if (!bridge) {
      // Running in standard browser environment without Electron
      this.setStatus('DISCONNECTED');
      return;
    }

    this.setStatus('CONNECTING');

    // Subscribe to IPC telemetry push stream
    this.ipcUnsubscribeTelemetry = bridge.subscribe((raw: unknown) => {
      const mapped = TelemetryMapper.fromICD(
        raw as ICDTelemetryMessage | ICDRoverTelemetryData
      );
      this.currentTelemetry = mapped;
      this.notifyTelemetry();
    });

    // Subscribe to IPC status transitions
    this.ipcUnsubscribeStatus = bridge.onStatusChange((statusStr: string) => {
      const validStatus: ConnectionStatus =
        statusStr === 'CONNECTED' ||
          statusStr === 'CONNECTING' ||
          statusStr === 'RECONNECTING' ||
          statusStr === 'ERROR'
          ? statusStr
          : 'DISCONNECTED';
      this.setStatus(validStatus);
    });

    try {
      // Fetch initial snapshot
      const rawSnapshot = await bridge.getCurrent();
      if (rawSnapshot) {
        this.currentTelemetry = TelemetryMapper.fromICD(
          rawSnapshot as ICDTelemetryMessage | ICDRoverTelemetryData
        );
      }

      const rawStatus = await bridge.getStatus();
      this.setStatus(
        rawStatus === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED'
      );
      this.notifyTelemetry();
    } catch (err) {
      console.error('[ElectronTelemetryProvider] Error connecting to IPC bridge:', err);
      this.setStatus('ERROR');
    }
  }

  public async disconnect(): Promise<void> {
    if (this.ipcUnsubscribeTelemetry) {
      this.ipcUnsubscribeTelemetry();
      this.ipcUnsubscribeTelemetry = null;
    }
    if (this.ipcUnsubscribeStatus) {
      this.ipcUnsubscribeStatus();
      this.ipcUnsubscribeStatus = null;
    }
    this.setStatus('DISCONNECTED');
  }

  public subscribe(listener: TelemetryListener): () => void {
    this.telemetryListeners.add(listener);
    if (this.status === 'CONNECTED') {
      listener(this.currentTelemetry);
    }
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Requests scenario change via IPC bridge.
   */
  public async loadScenario(scenarioName: string): Promise<void> {
    const bridge = typeof window !== 'undefined' ? window.k9mesh?.telemetry : undefined;
    if (bridge?.loadScenario) {
      await bridge.loadScenario(scenarioName);
    }
  }

  private setStatus(newStatus: ConnectionStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    this.statusListeners.forEach((listener) => {
      try {
        listener(newStatus);
      } catch (err) {
        console.error('[ElectronTelemetryProvider] Error in status listener:', err);
      }
    });
  }

  private notifyTelemetry(): void {
    this.telemetryListeners.forEach((listener) => {
      try {
        listener(this.currentTelemetry);
      } catch (err) {
        console.error('[ElectronTelemetryProvider] Error in telemetry listener:', err);
      }
    });
  }
}
