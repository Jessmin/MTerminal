const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

// Explicit diagnostic mode: test TCP from the packaged app's main process,
// without opening terminals, loading profiles or attempting SSH authentication.
function probeOptions(argv) {
  const address = argv.find(value => value.startsWith('--mterminal-network-probe='))?.split('=').slice(1).join('=');
  if (!address) return null;
  const target = new URL(`tcp://${address}`);
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const port = Number(target.port || 22);
  const output = argv.find(value => value.startsWith('--mterminal-network-probe-output='))?.slice('--mterminal-network-probe-output='.length);
  if (!net.isIP(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !output || !path.isAbsolute(output)) throw new Error('Invalid network probe arguments');
  return { host, port, output };
}
function runProbe(options, metadata) {
  return new Promise(resolve => {
    const result = { ...metadata, host: options.host, port: options.port, started: new Date().toISOString(), connected: false };
    let settled = false;
    const socket = net.createConnection({ host: options.host, port: options.port });
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (error) result.error = { code: error.code || 'ERROR', message: error.message };
      fs.writeFileSync(options.output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
      resolve(result);
    };
    const timer = setTimeout(() => finish(result.connected ? null : { code: 'ETIMEDOUT', message: 'TCP connection timed out' }), 6000);
    socket.once('connect', () => { result.connected = true; result.localAddress = socket.localAddress; });
    socket.once('data', data => { result.banner = data.toString('utf8').slice(0, 256).trim(); finish(); });
    socket.once('error', finish);
    socket.once('end', () => finish());
  });
}
module.exports = { probeOptions, runProbe };
