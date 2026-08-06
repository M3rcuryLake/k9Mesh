import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { TelemetryHost } from './telemetryHost'

// __dirname is available as native CJS global in Node16 output
const isDev = process.env.NODE_ENV === 'development'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#000000',
    title: 'K9MESH — Rover Command Center',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Instrument panel — hide the application menu bar
  win.setMenuBarVisibility(false)

  if (isDev) {
    win.loadURL('http://localhost:5174')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // External links open in the system browser, not inside Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(async () => {
  // Initialize TelemetryHost before creating window
  const host = TelemetryHost.getInstance()
  await host.initialize()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await TelemetryHost.getInstance().dispose()
})
