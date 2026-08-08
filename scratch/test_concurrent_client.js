const { WebSocketTelemetrySource } = require('../dist-electron/sources/WebSocketTelemetrySource.js');
const WebSocket = require('ws');

async function testConcurrentRejection() {
  console.log('[*] Testing Single-Client Enforcement (Rejecting second client)...');
  const source = new WebSocketTelemetrySource({
    host: '127.0.0.1',
    port: 8766,
  });

  await source.start();

  // Connect first client
  const client1 = new WebSocket('ws://127.0.0.1:8766');
  await new Promise((resolve) => client1.on('open', resolve));
  console.log('[+] Client 1 connected.');

  // Connect second client (should be rejected with 4001)
  const client2 = new WebSocket('ws://127.0.0.1:8766');
  let rejected = false;
  let rejectCode = 0;

  await new Promise((resolve) => {
    client2.on('close', (code, reason) => {
      rejected = true;
      rejectCode = code;
      console.log(`[+] Client 2 closed with code: ${code} (${reason})`);
      resolve();
    });
    client2.on('error', () => {
      // expected on abrupt close
    });
  });

  const stats = source.getStats();
  console.log('Stats:', stats);

  client1.close();
  await source.stop();

  if (!rejected || rejectCode !== 4001 || stats.totalConnectionsRejected !== 1) {
    throw new Error(`Single client rejection assertion failed! Code: ${rejectCode}, Rejections: ${stats.totalConnectionsRejected}`);
  }

  console.log('[+] Single-client rejection test PASSED successfully!');
  process.exit(0);
}

testConcurrentRejection().catch((err) => {
  console.error('[-] Test failed:', err);
  process.exit(1);
});
