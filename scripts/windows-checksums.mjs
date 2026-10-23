import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const arch = process.argv.includes('--arm64') ? 'arm64' : 'x64';
const prefix = `MTerminal-${version}-windows-${arch}`;
const filenames = [`${prefix}-setup.exe`, `${prefix}.zip`];
const lines = filenames.map(filename => {
  const bytes = fs.readFileSync(path.join('release', filename));
  return `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${filename}`;
});
const output = path.join('release', `${prefix}-SHA256SUMS.txt`);
fs.writeFileSync(output, lines.join('\n') + '\n');
console.log('Created:', output);
