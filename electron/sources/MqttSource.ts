import type {
  TelemetrySource,
  SourceType,
  SourceTelemetryListener,
  SourceStatusListener,
} from './TelemetrySource';

/**
 * MqttSource (Placeholder — Phase 8)
 *
 * Reserved integration interface for live MQTT broker telemetry stream.
 */
export class MqttSource implements TelemetrySource {
  public readonly id = 'mqtt-live';
  public readonly type: SourceType = 'mqtt';
  public readonly name = 'Live MQTT Rover Stream';

  public async start(): Promise<void> {
    throw new Error(
      '[MqttSource] MQTT transport integration is scheduled for Phase 8.'
    );
  }

  public async stop(): Promise<void> {
    // Placeholder
  }

  public onTelemetry(_listener: SourceTelemetryListener): () => void {
    return () => {};
  }

  public onStatusChange(listener: SourceStatusListener): () => void {
    listener(false);
    return () => {};
  }

  public getCurrentTelemetry(): unknown | null {
    return null;
  }

  public isConnected(): boolean {
    return false;
  }
}
