import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const { NtExecutable, NtExecutableResource, Resource } = require('resedit');
const arch = process.argv.includes('--arm64') ? 'arm64' : 'x64';
const machine = arch === 'x64' ? 0x8664 : 0xaa64;
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const output = path.resolve('release', arch === 'x64' ? 'win-unpacked' : 'win-arm64-unpacked');
const archive = path.join(output, 'resources/app.asar');
const entries = asar.listPackage(archive);
const read = filename => asar.extractFile(archive, filename);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function peMachine(bytes) {
  assert.equal(bytes.subarray(0, 2).toString(), 'MZ');
  const offset = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.subarray(offset, offset + 4).toString(), 'PE\0\0');
  return bytes.readUInt16LE(offset + 4);
}
assert.equal(peMachine(fs.readFileSync(path.join(output, 'MTerminal.exe'))), machine);
assert.equal(JSON.parse(read('package.json')).version, pkg.version);
assert.ok(read('electron/platform.cjs').toString().includes('powershell.exe'));
assert.ok(read('electron/main.cjs').toString().includes("]) : null)"), 'Windows menu accelerators must not intercept terminal Ctrl+C');
assert.ok(!entries.some(entry => entry.startsWith('/analysis/') || entry.startsWith('/tests/')));
assert.ok(entries.includes('/assets/THIRD_PARTY_NOTICES.txt'));
for (const filename of ['electron/sessions.cjs', 'electron/cwd.cjs', 'electron/resources.cjs', 'electron/preload.cjs']) {
  assert.equal(hash(read(filename)), hash(fs.readFileSync(filename)), 'Packaged source must match current source: ' + filename);
}
const natives = entries.filter(entry => entry.endsWith('.node'));
assert.ok(natives.length >= 3);
for (const entry of natives) {
  assert.ok(entry.startsWith(`/node_modules/node-pty/prebuilds/win32-${arch}/`), 'Unexpected native module: ' + entry);
  const filename = path.join(output, 'resources/app.asar.unpacked', entry.slice(1));
  assert.equal(peMachine(fs.readFileSync(filename)), machine);
}
const prebuild = path.join(output, `resources/app.asar.unpacked/node_modules/node-pty/prebuilds/win32-${arch}`);
for (const filename of ['conpty.node', 'conpty_console_list.node', 'pty.node', 'winpty-agent.exe', 'winpty.dll']) assert.ok(fs.existsSync(path.join(prebuild, filename)), filename);
assert.ok(fs.readFileSync(path.join(prebuild, 'conpty.node')).includes(Buffer.from('napi_register_module_v1')));
const executable = NtExecutable.from(fs.readFileSync(path.join(output, 'MTerminal.exe')));
const resource = NtExecutableResource.from(executable);
const versions = Resource.VersionInfo.fromEntries(resource.entries);
assert.ok(versions.some(version => version.getAllLanguagesForStringValues().some(language => version.getStringValues(language).ProductName === 'MTerminal')));
const artifacts = [
  `MTerminal-${pkg.version}-windows-${arch}-setup.exe`,
  `MTerminal-${pkg.version}-windows-${arch}.zip`,
].map(filename => {
  const bytes = fs.readFileSync(path.resolve('release', filename));
  assert.ok(bytes.length > 1024 * 1024);
  if (filename.endsWith('.exe')) peMachine(bytes);
  else assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  return { filename, bytes: bytes.length, sha256: hash(bytes) };
});
const report = {
  date: new Date().toISOString().slice(0, 10), version: pkg.version, platform: `win32-${arch}`,
  cross_built_on: `${process.platform}-${process.arch}`,
  checks: ['PE architecture', 'Windows node-pty prebuilds unpacked', 'Node-API registration', 'product resources', 'current platform source', 'license notices', 'analysis and tests excluded'],
  native_modules: natives, artifacts,
  runtime_validation: 'Not performed: package validation does not launch the desktop application',
  signing: 'Unsigned preview build',
};
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync(`artifacts/windows-${arch}-validation.json`, JSON.stringify(report, null, 2) + '\n');
console.log(`PASS Windows ${arch} package validation: ${natives.length} native modules, ${artifacts.length} artifacts`);
for (const artifact of artifacts) console.log(artifact.filename, Math.round(artifact.bytes / 1024 / 1024) + ' MiB', artifact.sha256);
