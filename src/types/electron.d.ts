export interface K9MeshTelemetryBridge {
  getCurrent: () => Promise<unknown>;
  getStatus: () => Promise<string>;
  loadScenario: (scenarioName: string) => Promise<{ success: boolean }>;
  subscribe: (callback: (data: unknown) => void) => () => void;
  onStatusChange: (callback: (status: string) => void) => () => void;
}

export interface K9MeshBridge {
  telemetry: K9MeshTelemetryBridge;
}

declare global {
  interface Window {
    /**
     * K9Mesh IPC bridge — injected securely by the Electron preload script via contextBridge.
     */
    k9mesh?: K9MeshBridge;
  }
}
