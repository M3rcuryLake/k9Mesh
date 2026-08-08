const { WebSocketTelemetrySource } = require('../dist-electron/sources/WebSocketTelemetrySource.js');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8765;

async function run5MinSoak() {
  console.log('================================================================');
  console.log(' K9Mesh Phase 9.1: 5-Minute 10 Hz Live Telemetry Soak Test');
  console.log(' Target: 3000 Packets at 10 Hz (300 Seconds Continuous Stream)');
  console.log('================================================================\n');

  const source = new WebSocketTelemetrySource({
    host: '127.0.0.1',
    port: PORT,
    maxMessageSizeBytes: 65536,
  });

  let adaptedCount = 0;
  source.onTelemetry(() => {
    adaptedCount++;
  });

  await source.start();
  console.log(`[+] WebSocketTelemetrySource listening on ws://127.0.0.1:${PORT}`);

  const initialMem = process.memoryUsage();
  console.log(`[*] Initial Node Heap: ${(initialMem.heapUsed / 1024 / 1024).toFixed(2)} MB | RSS: ${(initialMem.rss / 1024 / 1024).toFixed(2)} MB`);

  const memInterval = setInterval(() => {
    const mem = process.memoryUsage();
    const stats = source.getStats();
    const diag = source.getAdapterDiagnostics();
    console.log(
      `[Soak Heartbeat] Rx: ${stats.messagesReceived} | Adapted: ${diag.packetsAdapted} | Failures: ${diag.mappingFailures} | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB | RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`
    );
  }, 30000);

  // Run python producer for 3000 packets at 10 Hz (5 minutes)
  const pyProcess = spawn('python', [
    path.join(__dirname, 'test_producer.py'),
    '--rate-hz', '10.0',
    '--count', '3000',
    '--survivor',
  ], { stdio: 'inherit' });

  await new Promise((resolve, reject) => {
    pyProcess.on('close', (code) => {
      clearInterval(memInterval);
      if (code === 0) resolve();
      else reject(new Error(`Python producer exited with code ${code}`));
    });
    pyProcess.on('error', (err) => {
      clearInterval(memInterval);
      reject(err);
    });
  });

  const finalMem = process.memoryUsage();
  const stats = source.getStats();
  const diag = source.getAdapterDiagnostics();

  console.log('\n================================================================');
  console.log(' 5-MINUTE SOAK TEST RESULTS SUMMARY');
  console.log('================================================================');
  console.log(`Total Packets Transmitted:       3000`);
  console.log(`Total Packets Received by Host:  ${stats.messagesReceived}`);
  console.log(`Total Packets Adapted to ICD:    ${diag.packetsAdapted}`);
  console.log(`Total Dropped / Malformed:       ${stats.messagesDroppedMalformedJson}`);
  console.log(`Total Dropped / Oversized:       ${stats.messagesDroppedOversized}`);
  console.log(`Mapping Failures:                ${diag.mappingFailures}`);
  console.log(`Unknown Schema Versions:         ${diag.unknownSchemaVersions}`);
  console.log(`Initial Heap Usage:              ${(initialMem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Final Heap Usage:                ${(finalMem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap Delta:                      ${((finalMem.heapUsed - initialMem.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
  console.log('================================================================\n');

  if (diag.packetsAdapted !== 3000) {
    throw new Error(`Soak test failed: Expected 3000 adapted packets, got ${diag.packetsAdapted}`);
  }
  if (diag.mappingFailures > 0) {
    throw new Error(`Soak test failed: ${diag.mappingFailures} mapping failures observed.`);
  }

  await source.stop();
  console.log('[+] Soak test completed with 100% success.');
  process.exit(0);
}

run5MinSoak().catch((err) => {
  console.error('[-] Soak test failed:', err);
  process.exit(1);
});
