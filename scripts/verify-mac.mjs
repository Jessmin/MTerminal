import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectUUID } from './macho-uuid.cjs';

export function verifyMac(appPath = path.resolve(`release/${JSON.parse(fs.readFileSync('package.json', 'utf8')).version}/mac-arm64/MTerminal.app`)) {
  if (process.platform !== 'darwin') throw new Error('Mac verification requires macOS');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'pipe' });
  const bundles = [appPath];
  const frameworks = path.join(appPath, 'Contents/Frameworks');
  for (const name of fs.readdirSync(frameworks)) if (name.endsWith('.app')) bundles.push(path.join(frameworks, name));
  const checked = [];
  const seenUUIDs = new Set();
  const originalUUIDs = new Set();
  const runtime = path.resolve('node_modules/electron/dist/Electron.app');
  for (const bundle of [runtime, ...fs.readdirSync(path.join(runtime, 'Contents/Frameworks')).filter(name => name.endsWith('.app')).map(name => path.join(runtime, 'Contents/Frameworks', name))]) {
    const executable = path.basename(bundle, '.app');
    originalUUIDs.add(inspectUUID(fs.readFileSync(path.join(bundle, 'Contents/MacOS', executable))).uuid);
  }
  for (const bundle of bundles) {
    const plist = path.join(bundle, 'Contents/Info.plist');
    const expected = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist], { encoding: 'utf8' }).trim();
    const result = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', bundle], { encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    const details = result.stdout + result.stderr;
    assert.equal(/^Identifier=(.+)$/m.exec(details)?.[1], expected, `Signature identity mismatch: ${bundle}`);
    assert(!details.includes('Info.plist=not bound'), `Unbound Info.plist: ${bundle}`);
    assert(!details.includes('Sealed Resources=none'), `Unsealed resources: ${bundle}`);
    const executable = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist], { encoding: 'utf8' }).trim();
    const uuid = inspectUUID(fs.readFileSync(path.join(bundle, 'Contents/MacOS', executable))).uuid;
    assert(!seenUUIDs.has(uuid) && !originalUUIDs.has(uuid), `Executable UUID collision: ${bundle}`);
    seenUUIDs.add(uuid);
    checked.push({ bundle: path.basename(bundle), identifier: expected, uuid });
  }
  const usage = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :NSLocalNetworkUsageDescription', path.join(appPath, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  assert(usage, 'Local network usage description is missing');
  console.log(`PASS Mac strict signatures, ${checked.length} bundle identities and independent executable UUIDs`);
  return { strictSignature: true, bundles: checked, localNetworkUsageDescription: usage };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyMac(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
