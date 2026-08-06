import type { TelemetryProvider } from '../types/provider';
import {
  JsonTelemetryProvider,
  type JsonProviderOptions,
} from './JsonTelemetryProvider';
import { ElectronTelemetryProvider } from './ElectronTelemetryProvider';

export type ProviderType =
  | 'auto'
  | 'electron'
  | 'json'
  | 'mqtt'
  | 'serial'
  | 'playback';

export interface ProviderFactoryOptions {
  json?: JsonProviderOptions;
  mqtt?: Record<string, unknown>;
  serial?: Record<string, unknown>;
  playback?: Record<string, unknown>;
}

/**
 * TelemetryProviderFactory
 *
 * Instantiates concrete TelemetryProvider instances without coupling consumers
 * to specific transport implementations.
 */
export class TelemetryProviderFactory {
  /**
   * Creates a TelemetryProvider instance based on the requested transport type.
   * Defaults to 'auto', which selects 'electron' when the Electron IPC bridge
   * is present, or seamlessly falls back to 'json' in browser development mode.
   *
   * @param type Transport type ('auto' | 'electron' | 'json' | 'mqtt' | 'serial' | 'playback')
   * @param options Configuration options for the chosen provider
   */
  public static create(
    type: ProviderType = 'auto',
    options?: ProviderFactoryOptions
  ): TelemetryProvider {
    switch (type) {
      case 'auto':
      case 'electron': {
        const isElectronBridgeAvailable =
          typeof window !== 'undefined' && Boolean(window.k9mesh?.telemetry);

        if (isElectronBridgeAvailable || type === 'electron') {
          return new ElectronTelemetryProvider();
        }

        // Automatic fallback for browser development without Electron
        return new JsonTelemetryProvider(options?.json);
      }

      case 'json':
        return new JsonTelemetryProvider(options?.json);

      case 'mqtt':
        throw new Error(
          '[TelemetryProviderFactory] MqttTelemetryProvider is scheduled for Phase 8 (Live MQTT Transport).'
        );

      case 'serial':
        throw new Error(
          '[TelemetryProviderFactory] SerialTelemetryProvider is scheduled for Phase 9 (Direct Serial Transport).'
        );

      case 'playback':
        throw new Error(
          '[TelemetryProviderFactory] PlaybackTelemetryProvider is scheduled for Phase 10 (Mission Log Playback).'
        );

      default:
        throw new Error(
          `[TelemetryProviderFactory] Unknown provider type: "${type}"`
        );
    }
  }
}
