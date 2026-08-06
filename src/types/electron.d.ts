export {}

declare global {
  interface Window {
    /**
     * K9Mesh IPC bridge — injected by the Electron preload script via contextBridge.
     *
     * Phase 2: empty stub.
     * Phase 3+: will contain typed methods for MQTT, serial ports, logging, config, etc.
     */
    k9mesh: Record<string, never>
  }
}
