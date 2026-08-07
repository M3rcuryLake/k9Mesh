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
   * When K9_INTEGRATION_TEST=1 or --integration-test is present, selects 'websocket'.
   */
  public static getInitialSourceConfig(): SourceFactoryOptions {
    const isIntegrationMode =
      process.env.K9_INTEGRATION_TEST === '1' ||
      (typeof process !== 'undefined' &&
        Array.isArray(process.argv) &&
        process.argv.includes('--integration-test'));

    if (isIntegrationMode) {
      console.info('[SourceFactory] Integration Test Mode active — configured WebSocket telemetry transport.');
      return { type: 'websocket' };
    }

    return { type: 'scenario', scenario: 'survivor_detected' };
  }

  /**
   * Creates the initial runtime TelemetrySource determined by startup configuration.
   */
  public static createInitialSource(): TelemetrySource {
    return this.createSource(this.getInitialSourceConfig());
  }
}
