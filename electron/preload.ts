import { contextBridge } from 'electron'

/**
 * K9Mesh secure IPC bridge — Phase 2 infrastructure stub.
 *
 * This API surface will expand in Phase 3+ to include:
 *   - MQTT client  (rover telemetry subscribe / publish)
 *   - STM32 serial communication
 *   - ESP32 serial communication
 *   - Serial port enumeration and management
 *   - USB device access
 *   - Local telemetry logging
 *   - IPC event routing
 *   - Configuration persistence (electron-store)
 *
 * Do NOT add hardware implementation here until Phase 3.
 * All renderer components remain unaware of Electron.
 */
contextBridge.exposeInMainWorld('k9mesh', {
  // Intentionally empty — Phase 2 is infrastructure only.
})
