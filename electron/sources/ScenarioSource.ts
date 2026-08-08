import type {
  TelemetrySource,
  SourceType,
  SourceTelemetryListener,
  SourceStatusListener,
} from './TelemetrySource';

import nominalSearch from '../../src/scenarios/nominal_search.json';
import survivorDetected from '../../src/scenarios/survivor_detected.json';
import hardwareFault from '../../src/scenarios/hardware_fault.json';

export type ScenarioName =
  | 'nominal_search'
  | 'survivor_detected'
  | 'hardware_fault';

export const SCENARIO_MAP: Record<ScenarioName, Record<string, unknown>> = {
  nominal_search: nominalSearch as Record<string, unknown>,
  survivor_detected: survivorDetected as Record<string, unknown>,
  hardware_fault: hardwareFault as Record<string, unknown>,
};

/**
 * ScenarioSource
 *
 * Implements TelemetrySource for static, deterministic JSON scenarios.
 * Executes in the Electron Main process. Contains zero timers or synthetic physics.
 */
export class ScenarioSource implements TelemetrySource {
  public readonly id = 'scenario-static';
  public readonly type: SourceType = 'scenario';
  public readonly name = 'Static Scenario Source';

  private connected = false;
  private currentScenario: ScenarioName = 'survivor_detected';
  private currentData: unknown = null;

  private telemetryListeners = new Set<SourceTelemetryListener>();
  private statusListeners = new Set<SourceStatusListener>();

  constructor(initialScenario: ScenarioName = 'survivor_detected') {
    this.setScenario(initialScenario);
  }

  public async start(): Promise<void> {
    if (this.connected) return;
    this.connected = true;
    this.notifyStatus(true);
    this.notifyTelemetry();
  }

  public async stop(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.notifyStatus(false);
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

  public getActiveScenarioName(): ScenarioName {
    return this.currentScenario;
  }

  /**
   * Deterministically updates the active scenario and immediately emits telemetry.
   */
  public loadScenario(name: string): void {
    if (!(name in SCENARIO_MAP)) {
      throw new Error(`[ScenarioSource] Unknown scenario: "${name}"`);
    }
    this.setScenario(name as ScenarioName);
    if (this.connected) {
      this.notifyTelemetry();
    }
  }

  private setScenario(name: ScenarioName): void {
    this.currentScenario = name;
    const raw = SCENARIO_MAP[name];
    this.currentData = raw?.telemetry ?? raw;
  }

  private notifyStatus(connected: boolean): void {
    this.statusListeners.forEach((listener) => {
      try {
        listener(connected);
      } catch (err) {
        console.error('[ScenarioSource] Status listener error:', err);
      }
    });
  }

  private notifyTelemetry(): void {
    if (!this.currentData) return;
    this.telemetryListeners.forEach((listener) => {
      try {
        listener(this.currentData);
      } catch (err) {
        console.error('[ScenarioSource] Telemetry listener error:', err);
      }
    });
  }
}
