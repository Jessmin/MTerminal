const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inspectUUID, deriveUUID } = require('./macho-uuid.cjs');

module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, 'MTerminal.app');
  const runtime = path.resolve('node_modules/electron/dist/Electron.app');
  const bundles = [app, ...fs.readdirSync(path.join(app, 'Contents/Frameworks')).filter(name => name.endsWith('.app')).map(name => path.join(app, 'Contents/Frameworks', name))];
  const mappings = [];
  for (const bundle of bundles) {
    const plist = path.join(bundle, 'Contents/Info.plist');
    const read = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim();
    const executable = read('CFBundleExecutable'), identifier = read('CFBundleIdentifier');
    const filename = path.join(bundle, 'Contents/MacOS', executable);
    const originalBundle = bundle === app ? runtime : path.join(runtime, 'Contents/Frameworks', path.basename(bundle).replace(/^MTerminal/, 'Electron'));
    const original = fs.readFileSync(path.join(originalBundle, 'Contents/MacOS', executable.replace(/^MTerminal/, 'Electron')));
    const bytes = fs.readFileSync(filename), info = inspectUUID(bytes);
    if (info.uuid !== inspectUUID(original).uuid) throw new Error(`UUID preparation requires a clean runtime copy: ${filename}`);
    const uuid = deriveUUID(identifier, info);
    uuid.copy(bytes, info.offset);
    fs.writeFileSync(filename, bytes);
    mappings.push({ bundle: path.basename(bundle), identifier, originalUUID: info.uuid, packagedUUID: uuid.toString('hex') });
  }
  if (new Set(mappings.map(value => value.packagedUUID)).size !== mappings.length) throw new Error('Executable UUID collision');
  fs.writeFileSync(path.join(context.outDir, 'mac-executable-uuids.json'), JSON.stringify(mappings, null, 2) + '\n');
  console.log(`Prepared ${mappings.length} independent executable UUIDs before code signing`);
};
