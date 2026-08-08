import { contextBridge, ipcRenderer } from 'electron';

export type IpcTelemetryListener = (data: unknown) => void;
export type IpcStatusListener = (status: string) => void;

/**
 * K9Mesh Secure IPC Preload Bridge
 *
 * Exposes a strict, typed API surface to the renderer process via contextBridge.
 * Enforces context isolation and disables direct Node.js integration in the renderer.
 */
contextBridge.exposeInMainWorld('k9mesh', {
  telemetry: {
    getCurrent: async (): Promise<unknown> => {
      return ipcRenderer.invoke('k9mesh:telemetry:get-current');
    },

    getStatus: async (): Promise<string> => {
      return ipcRenderer.invoke('k9mesh:telemetry:get-status');
    },

    loadScenario: async (scenarioName: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('k9mesh:telemetry:load-scenario', scenarioName);
    },

    subscribe: (callback: IpcTelemetryListener): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
        callback(data);
      };
      ipcRenderer.on('k9mesh:telemetry:update', listener);
      return () => {
        ipcRenderer.removeListener('k9mesh:telemetry:update', listener);
      };
    },

    onStatusChange: (callback: IpcStatusListener): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: string) => {
        callback(status);
      };
      ipcRenderer.on('k9mesh:telemetry:status', listener);
      return () => {
        ipcRenderer.removeListener('k9mesh:telemetry:status', listener);
      };
    },
  },
});
