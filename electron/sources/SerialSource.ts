import type {
  TelemetrySource,
  SourceType,
  SourceTelemetryListener,
  SourceStatusListener,
} from './TelemetrySource';

/**
 * SerialSource (Placeholder — Phase 9)
 *
 * Reserved integration interface for direct USB-CDC serial telemetry transport.
 */
export class SerialSource implements TelemetrySource {
  public readonly id = 'serial-direct';
  public readonly type: SourceType = 'serial';
  public readonly name = 'Direct USB/Serial Transport';

  public async start(): Promise<void> {
    throw new Error(
      '[SerialSource] Direct Serial transport integration is scheduled for Phase 9.'
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
