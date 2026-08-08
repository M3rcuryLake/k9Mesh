const { WebSocketTelemetrySource } = require('../dist-electron/sources/WebSocketTelemetrySource.js');
const { spawn } = require('child_process');
const path = require('path');

async function runTest() {
  console.log('[*] Testing WebSocketTelemetrySource functional runtime...');
  const source = new WebSocketTelemetrySource({
    host: '127.0.0.1',
    port: 8765,
    maxMessageSizeBytes: 65536,
  });

  const receivedPackets = [];
  source.onTelemetry((data) => {
    receivedPackets.push(data);
  });

  let connectionStatusHistory = [];
  source.onStatusChange((connected) => {
    connectionStatusHistory.push(connected);
    console.log(`[Host Status Transition] Connected = ${connected}`);
  });

  await source.start();
  console.log('[+] WebSocketTelemetrySource is listening on ws://127.0.0.1:8765');

  // Spawn Python test producer
  console.log('[*] Spawning python scratch/test_producer.py...');
  const pyProcess = spawn('python', [path.join(__dirname, 'test_producer.py')], {
    stdio: 'inherit',
  });

  await new Promise((resolve, reject) => {
    pyProcess.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Python producer exited with code ${code}`));
    });
    pyProcess.on('error', reject);
  });

  console.log('\n[*] Inspecting WebSocketTelemetrySource runtime stats:');
  const stats = source.getStats();
  console.log(JSON.stringify(stats, null, 2));

  console.log(`\n[*] Total telemetry frames processed: ${receivedPackets.length}`);

  // Assertions
  if (stats.totalConnectionsAccepted < 1) {
    throw new Error('Assertion failed: Expected at least 1 connection accepted');
  }
  if (stats.messagesDroppedMalformedJson !== 1) {
    throw new Error(`Assertion failed: Expected 1 malformed JSON drop, got ${stats.messagesDroppedMalformedJson}`);
  }
  if (stats.messagesDroppedOversized !== 1) {
    throw new Error(`Assertion failed: Expected 1 oversized drop, got ${stats.messagesDroppedOversized}`);
  }
  if (receivedPackets.length !== 13) {
    throw new Error(`Assertion failed: Expected 13 valid packets (5 nominal + 5 survivor + 3 recovery), got ${receivedPackets.length}`);
  }

  console.log('[+] All assertions PASSED!');
  await source.stop();
  console.log('[+] WebSocketTelemetrySource cleanly stopped.');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('[-] Test failed:', err);
  process.exit(1);
});
