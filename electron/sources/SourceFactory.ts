import type { TelemetrySource, SourceType } from './TelemetrySource';
import { ScenarioSource, type ScenarioName } from './ScenarioSource';
import { WebSocketTelemetrySource } from './WebSocketTelemetrySource';
import type { WebSocketSourceConfig } from './websocketTypes';

export interface SourceFactoryOptions {
  type: SourceType;
  scenario?: ScenarioName;
  wsConfig?: Partial<WebSocketSourceConfig>;
}

/**
 * SourceFactory
 *
 * Centralized factory for creating and configuring TelemetrySource instances.
 * Evaluates environment and runtime flags to provide the appropriate source
 * (e.g. WebSocketTelemetrySource during Integration Test Mode, or ScenarioSource for default operation).
 */
export class SourceFactory {
  /**
   * Instantiates a TelemetrySource based on explicit configuration options.
   */
  public static createSource(options: SourceFactoryOptions): TelemetrySource {
    switch (options.type) {
      case 'websocket':
        return new WebSocketTelemetrySource(options.wsConfig);
      case 'scenario':
        return new ScenarioSource(options.scenario || 'survivor_detected');
      default:
        throw new Error(`[SourceFactory] Unsupported source type: ${options.type}`);
    }
  }

  /**
   * Resolves the startup source configuration from CLI arguments and environment variables.
   * Defaults to 'websocket' (Live Mode on ws://127.0.0.1:8080).
   * ScenarioSource is only activated when explicitly requested via K9_SCENARIO_MODE=1 or --scenario.
   */
  public static getInitialSourceConfig(): SourceFactoryOptions {
    const isScenarioOptIn =
      process.env.K9_SCENARIO_MODE === '1' ||
      process.env.K9_DEV_SCENARIO === '1' ||
      (typeof process !== 'undefined' &&
        Array.isArray(process.argv) &&
        process.argv.includes('--scenario'));

    if (isScenarioOptIn) {
      console.info('[SourceFactory] Explicit Scenario/Dev Mode active — configured ScenarioSource.');
      return { type: 'scenario', scenario: 'survivor_detected' };
    }

    console.info('[SourceFactory] Live Mode active (default) — configured WebSocket telemetry transport.');
    return { type: 'websocket' };
  }

  /**
   * Creates the initial runtime TelemetrySource determined by startup configuration.
   */
  public static createInitialSource(): TelemetrySource {
    return this.createSource(this.getInitialSourceConfig());
  }
}
