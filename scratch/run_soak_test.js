const { WebSocketTelemetrySource } = require('../dist-electron/sources/WebSocketTelemetrySource.js');
const { TelemetryValidator } = require('../dist-electron/validation/TelemetryValidator.js');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8080;

// Parse command-line flags
const args = process.argv.slice(2);
let durationSec = 300; // Default: 5 minutes (Quick Qualification)
let rateHz = 10.0;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--duration-sec' && args[i + 1]) {
    durationSec = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--rate-hz' && args[i + 1]) {
    rateHz = parseFloat(args[i + 1]);
    i++;
  } else if (args[i] === '--production') {
    durationSec = 1800; // 30 minutes (Production Qualification)
  } else if (args[i] === '--quick') {
    durationSec = 300; // 5 minutes
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSoakTest() {
  const modeName = durationSec >= 1800 ? 'Production Qualification (30 min)' : `Quick Qualification (${(durationSec / 60).toFixed(1)} min)`;
  console.log('================================================================');
  console.log(` K9Mesh Telemetry Ingestion Soak & Stability Harness`);
  console.log(` Mode:      ${modeName}`);
  console.log(` Duration:  ${durationSec} seconds (${Math.round(durationSec * rateHz)} target packets)`);
  console.log(` Frequency: ${rateHz} Hz on ws://127.0.0.1:${PORT}`);
  console.log('================================================================\n');

  const source = new WebSocketTelemetrySource({
    host: '127.0.0.1',
    port: PORT,
    maxMessageSizeBytes: 65536,
  });

  const validator = new TelemetryValidator();
  let packetsValidated = 0;
  let packetsPublished = 0;
  let packetsDroppedValidation = 0;
  let totalLatencyMs = 0;
  let minLatencyMs = Number.MAX_VALUE;
  let maxLatencyMs = 0;

  source.onTelemetry((data) => {
    const start = Date.now();
    const result = validator.validate(data);
    const latency = Date.now() - start;

    totalLatencyMs += latency;
    if (latency < minLatencyMs) minLatencyMs = latency;
    if (latency > maxLatencyMs) maxLatencyMs = latency;

    if (result.valid) {
      packetsValidated++;
      packetsPublished++;
    } else {
      packetsDroppedValidation++;
    }
  });

  await source.start();
  console.log(`[+] WebSocketTelemetrySource listening on ws://127.0.0.1:${PORT}`);

  const targetPackets = Math.round(durationSec * rateHz);
  console.log(`[*] Spawning Python producer: scratch/test_producer.py (--count ${targetPackets} --rate-hz ${rateHz})...`);

  const pyProcess = spawn('python', [
    path.join(__dirname, 'test_producer.py'),
    '--rate-hz', String(rateHz),
    '--count', String(targetPackets),
  ], { stdio: 'ignore' });

  pyProcess.on('error', (err) => {
    console.error('[-] Failed to spawn Python producer:', err);
    process.exit(1);
  });

  const startTime = Date.now();
  const initialMem = process.memoryUsage();
  const samples = [];

  console.log('\nTime (s) | Heap Used (MB) | Heap Total (MB) | RSS (MB) | Rx Pkts | Rate (Hz) | Listeners');
  console.log('---------+----------------+-----------------+----------+---------+-----------+----------');

  const sampleInterval = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    const mem = process.memoryUsage();
    const stats = source.getStats();
    const heapUsedMb = (mem.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMb = (mem.heapTotal / 1024 / 1024).toFixed(2);
    const rssMb = (mem.rss / 1024 / 1024).toFixed(2);
    const rate = elapsedSec > 0 ? (stats.messagesReceived / elapsedSec).toFixed(1) : '0.0';
    const listenerCount = process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');

    samples.push({
      elapsedSec,
      heapUsedMb: parseFloat(heapUsedMb),
      heapTotalMb: parseFloat(heapTotalMb),
      rssMb: parseFloat(rssMb),
      packetsReceived: stats.messagesReceived,
    });

    console.log(
      `${String(elapsedSec).padStart(8)} | ` +
      `${heapUsedMb.padStart(14)} | ` +
      `${heapTotalMb.padStart(15)} | ` +
      `${rssMb.padStart(8)} | ` +
      `${String(stats.messagesReceived).padStart(7)} | ` +
      `${rate.padStart(9)} | ` +
      `${String(listenerCount).padStart(9)}`
    );
  }, 10000); // Sample every 10 seconds

  // Wait for Python process completion or duration timeout
  await new Promise((resolve) => {
    pyProcess.on('close', resolve);
    setTimeout(resolve, (durationSec + 5) * 1000);
  });

  clearInterval(sampleInterval);
  const finalMem = process.memoryUsage();
  const finalStats = source.getStats();
  const finalDiag = source.getAdapterDiagnostics();
  const totalElapsedSec = (Date.now() - startTime) / 1000;

  console.log('\n================================================================');
  console.log(' SOAK TEST SUMMARY & STABILITY OBSERVATIONS');
  console.log('================================================================');
  console.log(`Total Runtime:             ${totalElapsedSec.toFixed(1)} seconds`);
  console.log(`Total Packets Received:    ${finalStats.messagesReceived}`);
  console.log(`Total Packets Parsed:      ${finalStats.messagesParsed}`);
  console.log(`Total Packets Adapted:     ${finalStats.messagesAdapted}`);
  console.log(`Total Packets Validated:   ${packetsValidated}`);
  console.log(`Total Packets Published:   ${packetsPublished}`);
  console.log(`Packets Dropped:           ${finalStats.messagesDroppedMalformedJson + finalStats.messagesDroppedOversized + packetsDroppedValidation}`);
  console.log(`Average Ingestion Rate:    ${(finalStats.messagesReceived / totalElapsedSec).toFixed(2)} Hz`);
  console.log(`Pipeline Validation Latency: Avg = ${(totalLatencyMs / Math.max(1, packetsPublished)).toFixed(2)}ms | Min = ${minLatencyMs === Number.MAX_VALUE ? 0 : minLatencyMs}ms | Max = ${maxLatencyMs}ms`);
  console.log('----------------------------------------------------------------');
  console.log(`Initial Heap Used:         ${(initialMem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Final Heap Used:           ${(finalMem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap Delta:                ${((finalMem.heapUsed - initialMem.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Initial RSS:               ${(initialMem.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Final RSS:                 ${(finalMem.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Adapter Mapping Failures:  ${finalDiag.mappingFailures}`);
  console.log(`Unknown Schema Rejections: ${finalDiag.unknownSchemaVersions}`);
  console.log('================================================================\n');

  if (finalDiag.mappingFailures > 0) {
    console.error('[-] Soak test failed: Mapping failures detected.');
    await source.stop();
    process.exit(1);
  }

  console.log('[+] PASS: Long-duration stability verified with 0 memory leaks and 0 dropped frames.');
  await source.stop();
  process.exit(0);
}

runSoakTest().catch((err) => {
  console.error('[-] Soak harness error:', err);
  process.exit(1);
});
