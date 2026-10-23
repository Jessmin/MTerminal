import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyMac } from './verify-mac.mjs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const output = path.resolve('release', pkg.version);
execFileSync(process.execPath, [path.resolve('node_modules/electron-builder/cli.js'), '--mac', 'dir', `--config.directories.output=${output}`], { stdio: 'inherit' });
verifyMac(path.join(output, 'mac-arm64/MTerminal.app'));
