import type {
  TelemetrySource,
  SourceType,
  SourceTelemetryListener,
  SourceStatusListener,
} from './TelemetrySource';

/**
 * PlaybackSource (Placeholder — Phase 10)
 *
 * Reserved integration interface for mission telemetry log replay.
 */
export class PlaybackSource implements TelemetrySource {
  public readonly id = 'playback-file';
  public readonly type: SourceType = 'playback';
  public readonly name = 'Mission Log Playback';

  public async start(): Promise<void> {
    throw new Error(
      '[PlaybackSource] Mission log playback is scheduled for Phase 10.'
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
