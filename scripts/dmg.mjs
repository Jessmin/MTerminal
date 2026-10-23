import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyMac } from './verify-mac.mjs';
if (process.platform !== 'darwin') throw new Error('DMG packaging requires macOS');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const app = path.resolve(`release/${pkg.version}/mac-arm64/MTerminal.app`);
if (!fs.existsSync(app)) throw new Error('Run npm run pack first');
verifyMac(app);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'mterminal-dmg-'));
const destination = path.resolve(`release/MTerminal-${pkg.version}-arm64.dmg`);
try {
  execFileSync('/usr/bin/ditto', [app, path.join(staging, 'MTerminal.app')], { stdio: 'inherit' });
  fs.symlinkSync('/Applications', path.join(staging, 'Applications'));
  execFileSync('/usr/bin/hdiutil', ['create', '-volname', 'MTerminal', '-srcfolder', staging, '-format', 'UDZO', '-ov', destination], { stdio: 'inherit' });
  console.log('Created:', destination);
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
