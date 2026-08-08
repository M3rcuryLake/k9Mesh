import type {
  TelemetryProvider,
  ConnectionStatus,
  TelemetryListener,
  StatusListener,
} from '../types/provider';
import type { RoverTelemetry } from '../types/telemetry';
import type { ScenarioDefinition, ICDTelemetryMessage, ICDRoverTelemetryData } from '../types/icd';
import { TelemetryMapper, NULL_TELEMETRY } from '../mappers/TelemetryMapper';

import nominalSearchScenario from '../scenarios/nominal_search.json';
import survivorDetectedScenario from '../scenarios/survivor_detected.json';
import hardwareFaultScenario from '../scenarios/hardware_fault.json';

export type BuiltinScenarioKey =
  | 'nominal_search'
  | 'survivor_detected'
  | 'hardware_fault';

export const SCENARIO_REGISTRY: Record<BuiltinScenarioKey, ScenarioDefinition> = {
  nominal_search: nominalSearchScenario as unknown as ScenarioDefinition,
  survivor_detected: survivorDetectedScenario as unknown as ScenarioDefinition,
  hardware_fault: hardwareFaultScenario as unknown as ScenarioDefinition,
};

export interface JsonProviderOptions {
  /** Initial scenario to load upon instantiation. Defaults to 'survivor_detected' */
  initialScenario?: BuiltinScenarioKey | ScenarioDefinition;
}

/**
 * JsonTelemetryProvider — Deterministic Digital Twin Provider
 *
 * Strictly deterministic: Loads static scenario data and delivers it to subscribers.
 * Never generates random numbers, runs synthetic timers, or produces artificial motion.
 */
export class JsonTelemetryProvider implements TelemetryProvider {
  public readonly id = 'json-deterministic';
  public readonly name = 'Static JSON Digital Twin';

  private status: ConnectionStatus = 'DISCONNECTED';
  private currentTelemetry: RoverTelemetry = { ...NULL_TELEMETRY };
  private currentScenarioName = 'Unloaded';

  private telemetryListeners = new Set<TelemetryListener>();
  private statusListeners = new Set<StatusListener>();

  constructor(options?: JsonProviderOptions) {
    const target = options?.initialScenario ?? 'survivor_detected';
    if (typeof target === 'string') {
      this.loadScenarioByName(target);
    } else {
      this.loadScenarioData(target);
    }
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public getCurrentTelemetry(): RoverTelemetry {
    return this.currentTelemetry;
  }

  public getScenarioName(): string {
    return this.currentScenarioName;
  }

  public async connect(): Promise<void> {
    if (this.status === 'CONNECTED') return;

    this.setStatus('CONNECTING');
    // Synchronously transitions to CONNECTED for deterministic digital twin operation
    this.setStatus('CONNECTED');
    this.notifyTelemetry();
  }

  public async disconnect(): Promise<void> {
    if (this.status === 'DISCONNECTED') return;
    this.setStatus('DISCONNECTED');
  }

  public subscribe(listener: TelemetryListener): () => void {
    this.telemetryListeners.add(listener);

    // Immediately deliver current snapshot if already connected
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
   * Deterministically switches the active scenario and immediately dispatches the new state.
   */
  public loadScenario(scenario: BuiltinScenarioKey | ScenarioDefinition): void {
    if (typeof scenario === 'string') {
      this.loadScenarioByName(scenario);
    } else {
      this.loadScenarioData(scenario);
    }

    if (this.status === 'CONNECTED') {
      this.notifyTelemetry();
    }
  }

  private loadScenarioByName(name: BuiltinScenarioKey): void {
    const def = SCENARIO_REGISTRY[name];
    if (!def) {
      throw new Error(`[JsonTelemetryProvider] Unknown scenario: "${name}"`);
    }
    this.loadScenarioData(def);
  }

  private loadScenarioData(def: ScenarioDefinition): void {
    this.currentScenarioName = def.scenarioName;
    this.currentTelemetry = TelemetryMapper.fromICD(
      def.telemetry as ICDTelemetryMessage | ICDRoverTelemetryData
    );
  }

  private setStatus(newStatus: ConnectionStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    this.statusListeners.forEach((listener) => {
      try {
        listener(newStatus);
      } catch (err) {
        console.error('[JsonTelemetryProvider] Error in status listener:', err);
      }
    });
  }

  private notifyTelemetry(): void {
    this.telemetryListeners.forEach((listener) => {
      try {
        listener(this.currentTelemetry);
      } catch (err) {
        console.error('[JsonTelemetryProvider] Error in telemetry listener:', err);
      }
    });
  }
}
