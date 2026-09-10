import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.BRIDGE_PORT || 3001;
const WIFI_PATH = process.env.K9MESH_WIFI_PATH || resolve(__dirname, '../../wifi');
const STATIC_DIR = process.env.K9MESH_STATIC_DIR 
  ? resolve(process.env.K9MESH_STATIC_DIR)
  : resolve(__dirname, '../dist');

const app = express();
app.use(cors());
app.use(express.json());

let childProc = null;
let lastError = null;
let firstPacketReceived = false;

app.post('/api/start', (req, res) => {
  const { interface: iface, calibrationSeconds, skipCalibration } = req.body || {};

  if (!iface || typeof iface !== 'string' || !iface.trim()) {
    return res.status(400).json({ error: 'Interface name is required' });
  }

  if (childProc && !childProc.killed) {
    return res.status(409).json({ error: 'Process already running' });
  }

  firstPacketReceived = false;

  const hostDir = resolve(WIFI_PATH, 'host');
  if (!existsSync(hostDir)) {
    return res.status(500).json({
      error: `Host directory not found: ${hostDir}`,
    });
  }

  const modelPath = resolve(WIFI_PATH, 'models', 'model.pkl');
  if (!existsSync(modelPath)) {
    return res.status(500).json({
      error: `Model file not found: ${modelPath}`,
    });
  }

  const args = [
    'main.py',
    '--interface',
    iface.trim(),
    '--model',
    modelPath,
    '--port',
    '5005',
  ];

  if (skipCalibration) {
    args.push('--skip-calibration');
  } else if (calibrationSeconds && typeof calibrationSeconds === 'number') {
    args.push('--calibration-seconds', String(calibrationSeconds));
  }

  try {
    childProc = spawn('python3', args, {
      cwd: hostDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    lastError = String(err);
    return res.status(500).json({ error: lastError });
  }

  lastError = null;
  const pid = childProc.pid;

  childProc.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    if (text.includes('FIRST_PACKET_RECEIVED')) {
      firstPacketReceived = true;
    }
  });
  childProc.stderr?.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) lastError = text;
  });

  childProc.on('error', (err) => {
    lastError = String(err);
    childProc = null;
  });

  childProc.on('exit', () => {
    childProc = null;
  });

  return res.json({ pid, status: 'started' });
});

app.post('/api/stop', (req, res) => {
  if (!childProc || childProc.killed) {
    return res.json({ status: 'not_running' });
  }

  const proc = childProc;
  proc.kill('SIGTERM');

  const forceKillTimer = setTimeout(() => {
    if (!proc.killed) {
      proc.kill('SIGKILL');
    }
  }, 5000);

  proc.on('exit', () => {
    clearTimeout(forceKillTimer);
  });

  childProc = null;
  return res.json({ status: 'stopped' });
});

app.get('/api/status', (req, res) => {
  const running = childProc && !childProc.killed;
  return res.json({
    running: Boolean(running),
    pid: running ? childProc.pid : null,
    error: lastError,
    firstPacket: firstPacketReceived,
  });
});

// Serve built static files
if (existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  app.get('/{*any}', (req, res) => {
    res.sendFile(resolve(STATIC_DIR, 'index.html'));
  });
} else {
  mkdirSync(STATIC_DIR, { recursive: true });
}

app.listen(PORT, () => {
  console.log(`K9Mesh bridge server running at http://localhost:${PORT}`);
  console.log(`WiFi path: ${WIFI_PATH}`);
  if (!existsSync(STATIC_DIR)) {
    console.log('  (dist/ not found — run "npm run build" first)');
  }
});
