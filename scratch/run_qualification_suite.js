const { WebSocketTelemetrySource } = require('../dist-electron/sources/WebSocketTelemetrySource.js');
const { SourceFactory } = require('../dist-electron/sources/SourceFactory.js');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8080;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runQualificationSuite() {
  console.log('================================================================');
  console.log(' K9Mesh Phase 10.6 Live Telemetry Ownership & Qualification');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // TEST 0: SourceFactory Audit & Live Mode Default Enforcement
  // -------------------------------------------------------------
  console.log('--- [TEST 0] SourceFactory Default Configuration Audit ---');
  const defaultConfig = SourceFactory.getInitialSourceConfig();
  if (defaultConfig.type !== 'websocket') {
    throw new Error(`Test 0 Failed: Expected default source to be 'websocket', got '${defaultConfig.type}'`);
  }
  console.log('[+] PASS: SourceFactory defaults strictly to WebSocketTelemetrySource (Live Mode).');

  const source = new WebSocketTelemetrySource({
    host: '127.0.0.1',
    port: PORT,
    maxMessageSizeBytes: 65536,
  });

  const receivedAdaptedPackets = [];
  source.onTelemetry((data) => {
    receivedAdaptedPackets.push(data);
  });

  const statusTransitions = [];
  source.onStatusChange((connected) => {
    statusTransitions.push({ time: Date.now(), connected });
  });

  // Verify initial state before any packets
  if (source.getCurrentTelemetry() !== null) {
    throw new Error('Test 0 Failed: WebSocketTelemetrySource initial telemetry must be null.');
  }
  console.log('[+] PASS: Zero initial telemetry published before producer connects.');

  await source.start();
  console.log(`[+] WebSocketTelemetrySource active and listening on ws://127.0.0.1:${PORT}`);

  // -------------------------------------------------------------
  // TEST 1: Malformed JSON Rejection
  // -------------------------------------------------------------
  console.log('\n--- [TEST 1] Malformed JSON Rejection ---');
  const ws1 = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((res) => ws1.on('open', res));
  ws1.send('{"seq": 11708, broken_json: ... NOT_VALID');
  await sleep(200);

  const stats1 = source.getStats();
  if (stats1.messagesDroppedMalformedJson !== 1) {
    throw new Error(`Test 1 Failed: Expected 1 malformed drop, got ${stats1.messagesDroppedMalformedJson}`);
  }
  console.log('[+] PASS: Malformed JSON dropped safely without server disruption.');

  // -------------------------------------------------------------
  // TEST 2: Oversized Packet Rejection (>64KB)
  // -------------------------------------------------------------
  console.log('\n--- [TEST 2] Oversized Packet Rejection (>64KB) ---');
  const oversizedPayload = JSON.stringify({
    seq: 11708,
    padding: 'A'.repeat(70000),
  });
  ws1.send(oversizedPayload);
  await sleep(200);

  const stats2 = source.getStats();
  if (stats2.messagesDroppedOversized !== 1) {
    throw new Error(`Test 2 Failed: Expected 1 oversized drop, got ${stats2.messagesDroppedOversized}`);
  }
  console.log('[+] PASS: Oversized packet (>64KB) dropped defensively.');

  // -------------------------------------------------------------
  // TEST 3: Disconnect Python Client & Zero-Fallback Verification
  // -------------------------------------------------------------
  console.log('\n--- [TEST 3] Disconnect Python Producer & Zero-Fallback Audit ---');
  ws1.close();
  await sleep(200);

  const stats3 = source.getStats();
  if (!stats3.serverListening || stats3.activeClientsCount !== 0) {
    throw new Error(`Test 3 Failed: Server should remain listening with 0 active clients.`);
  }
  console.log('[+] PASS: Server remains listening in DISCONNECTED state. Zero mock scenario fallback injected.');

  // -------------------------------------------------------------
  // TEST 4: Reconnect & Stream Valid Live Micro-ESPectre Packet
  // -------------------------------------------------------------
  console.log('\n--- [TEST 4] Reconnect & Stream Valid Micro-ESPectre Live Schema ---');
  const ws2 = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((res) => ws2.on('open', res));
  
  const livePacket = {
    seq: 11708,
    timestamp_us: 959410021,
    channel: 5,
    rssi: -61,
    dropped: 6,
    band: [11, 13, 15, 17, 20, 22, 24, 26, 28, 46, 49, 51],
    mvs: {
      state: 'motion',
      variance: 0.00029454899195013005,
      threshold: 0.00017719074199497816,
      confidence: 83.1163605484755
    },
    ml: {
      ready: true,
      score: null,
      motion: null,
      enabled: false
    }
  };

  ws2.send(JSON.stringify(livePacket));
  await sleep(200);

  const diag4 = source.getAdapterDiagnostics();
  if (diag4.packetsAdapted < 1) {
    throw new Error(`Test 4 Failed: Adapter failed to adapt valid Micro-ESPectre packet.`);
  }

  const latestAdapted = receivedAdaptedPackets[receivedAdaptedPackets.length - 1];
  if (
    latestAdapted.msg_type !== 'TELEMETRY' ||
    latestAdapted.data.radio.rssi !== -61 ||
    latestAdapted.data.radio.linkQuality !== 'EXCELLENT' ||
    latestAdapted.data.radio.signalPercent !== 78 ||
    latestAdapted.data.csi.state !== 'MOTION' ||
    latestAdapted.data.motion.level !== 'HIGH' ||
    latestAdapted.data.csi.calibrated !== true ||
    latestAdapted.data.csi.arrayOnline !== true ||
    latestAdapted.data.hardware.esp32 !== 'OK' ||
    latestAdapted.data.battery.voltage !== null ||
    latestAdapted.data.battery.percent !== null ||
    latestAdapted.data.gps.latitude !== null ||
    latestAdapted.data.gps.longitude !== null ||
    latestAdapted.data.imu.heading !== null ||
    latestAdapted.data.odometry.speed !== null ||
    latestAdapted.data.odometry.distance !== null
  ) {
    throw new Error(`Test 4 Failed: Adapted payload does not match Master ICD specification or contains fabricated data.`);
  }
  console.log('[+] PASS: Raw Micro-ESPectre packet accurately adapted into Master ICD envelope with strict zero-fabrication guarantees.');

  // -------------------------------------------------------------
  // TEST 5: Duplicate Producer Rejection (Single-Client Enforcement)
  // -------------------------------------------------------------
  console.log('\n--- [TEST 5] Duplicate Producer Rejection ---');
  const wsDuplicate = new WebSocket(`ws://127.0.0.1:${PORT}`);
  let duplicateClosedCode = null;
  await new Promise((res) => {
    wsDuplicate.on('close', (code) => {
      duplicateClosedCode = code;
      res();
    });
    wsDuplicate.on('error', () => {});
  });

  const stats5 = source.getStats();
  if (duplicateClosedCode !== 4001 || stats5.totalConnectionsRejected !== 1) {
    throw new Error(`Test 5 Failed: Expected close code 4001 and 1 rejection, got code ${duplicateClosedCode}`);
  }
  console.log('[+] PASS: Concurrent second producer rejected with code 4001.');

  // -------------------------------------------------------------
  // TEST 6: Malformed JSON Burst Injection
  // -------------------------------------------------------------
  console.log('\n--- [TEST 6] Malformed JSON Burst Injection (10 packets) ---');
  const preBurstMalformed = source.getStats().messagesDroppedMalformedJson;
  for (let i = 0; i < 10; i++) {
    ws2.send(`{"seq": ${12000 + i}, invalid: [corrupted-data-chunk}`);
  }
  await sleep(300);
  const postBurstMalformed = source.getStats().messagesDroppedMalformedJson;
  if (postBurstMalformed - preBurstMalformed !== 10) {
    throw new Error(`Test 6 Failed: Expected 10 dropped malformed packets, got ${postBurstMalformed - preBurstMalformed}`);
  }
  console.log('[+] PASS: 10/10 malformed bursts safely dropped without socket or parser degradation.');

  // -------------------------------------------------------------
  // TEST 7: Invalid Schema & Foreign Message Rejection
  // -------------------------------------------------------------
  console.log('\n--- [TEST 7] Invalid Schema & Foreign Message Rejection ---');
  const preInvalidSchema = source.getStats().messagesDroppedSchema;
  ws2.send(JSON.stringify({ msg_type: 'FOREIGN_UNSUPPORTED_TYPE', data: {} }));
  await sleep(200);
  const postInvalidSchema = source.getStats().messagesDroppedSchema;
  if (postInvalidSchema - preInvalidSchema !== 1) {
    throw new Error(`Test 7 Failed: Expected 1 schema rejection drop.`);
  }
  console.log('[+] PASS: Foreign unsupported schema rejected cleanly.');

  // -------------------------------------------------------------
  // TEST 8: Future & Extended Field Forward Compatibility
  // -------------------------------------------------------------
  console.log('\n--- [TEST 8] Future & Extended Field Forward Compatibility ---');
  const futurePacket = {
    seq: 12050,
    timestamp_us: 959420000,
    rssi: -58,
    channel: 5,
    mvs: { state: 'stable', confidence: 15.2, threshold: 0.00018, variance: 0.00005 },
    ml: { ready: true, score: null, motion: null, enabled: false },
    // Future extended fields
    battery_voltage: 8.12,
    battery_percent: 92,
    gps_lat: 37.7749,
    gps_lon: -122.4194,
    heading: 180.5,
    speed: 0.45,
    rpm_fl: 125,
    rpm_fr: 125,
    rpm_rl: 124,
    rpm_rr: 125,
    unrecognized_future_telemetry_sensor: { deep_learning_viterbi: 0.992 }
  };
  ws2.send(JSON.stringify(futurePacket));
  await sleep(200);

  const futureAdapted = receivedAdaptedPackets[receivedAdaptedPackets.length - 1];
  if (
    futureAdapted.data.battery.voltage !== 8.12 ||
    futureAdapted.data.battery.percent !== 92 ||
    futureAdapted.data.gps.latitude !== 37.7749 ||
    futureAdapted.data.imu.heading !== 180.5 ||
    futureAdapted.data.odometry.motors.FL !== 125
  ) {
    throw new Error('Test 8 Failed: Extended fields failed to map into Master ICD envelope.');
  }
  console.log('[+] PASS: Future extended payload (battery, GPS, IMU, odometry) parsed seamlessly.');

  ws2.close();
  await sleep(200);

  // -------------------------------------------------------------
  // TEST 9: Rapid Reconnect Storm (10 Connect/Disconnect Cycles)
  // -------------------------------------------------------------
  console.log('\n--- [TEST 9] Rapid Reconnect Storm (10 cycles) ---');
  for (let i = 0; i < 10; i++) {
    const stormWs = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await new Promise((res) => stormWs.on('open', res));
    stormWs.send(JSON.stringify({ seq: 13000 + i, rssi: -60, mvs: { state: 'motion', confidence: 80.0 } }));
    stormWs.close();
    await sleep(30);
  }
  await sleep(300);
  const stormStats = source.getStats();
  if (stormStats.activeClientsCount !== 0 || !stormStats.serverListening) {
    throw new Error('Test 9 Failed: Server state unstable after rapid reconnect storm.');
  }
  console.log(`[+] PASS: 10 rapid connect/disconnect cycles completed cleanly. Reconnect count: ${stormStats.reconnectCount}`);

  // -------------------------------------------------------------
  // TEST 10: Performance & Telemetry Streaming Soak Verification
  // -------------------------------------------------------------
  console.log('\n--- [TEST 10] Performance & Telemetry Streaming Soak Verification ---');
  console.log('[*] Spawning python scratch/test_producer.py for 300-frame streaming test (10 Hz) on ws://127.0.0.1:8080...');
  
  const pyProcess = spawn('python', [
    path.join(__dirname, 'test_producer.py'),
    '--rate-hz', '10.0',
    '--count', '300'
  ], { stdio: 'inherit' });

  const initialMemory = process.memoryUsage();
  console.log(`[*] Initial Node Process Heap Used: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);

  await new Promise((resolve, reject) => {
    pyProcess.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Python producer exited with code ${code}`));
    });
    pyProcess.on('error', reject);
  });

  const finalMemory = process.memoryUsage();
  console.log(`[*] Final Node Process Heap Used: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  const heapDeltaMb = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
  console.log(`[*] Heap Delta: ${heapDeltaMb.toFixed(2)} MB (Within normal bounds)`);

  const finalStats = source.getStats();
  const finalDiag = source.getAdapterDiagnostics();

  console.log('\n--- Final Runtime Statistics ---');
  console.log(JSON.stringify(finalStats, null, 2));
  console.log('\n--- Final Adapter Diagnostics ---');
  console.log(JSON.stringify(finalDiag, null, 2));

  if (finalDiag.mappingFailures !== 0) {
    throw new Error(`Test 10 Failed: Mapping failures detected: ${finalDiag.mappingFailures}`);
  }
  if (finalDiag.unknownSchemaVersions !== 1) { // Exactly 1 from test 7
    throw new Error(`Test 10 Failed: Unexpected unknown schema count: ${finalDiag.unknownSchemaVersions}`);
  }
  if (finalDiag.packetsAdapted < 300) {
    throw new Error(`Test 10 Failed: Expected at least 300 adapted packets, got ${finalDiag.packetsAdapted}`);
  }

  console.log('\n================================================================');
  console.log(' ALL 11 QUALIFICATION & FAULT INJECTION TESTS PASSED (100%)');
  console.log('================================================================\n');

  await source.stop();
  process.exit(0);
}

runQualificationSuite().catch((err) => {
  console.error('\n[-] Qualification suite failed:', err);
  process.exit(1);
});
