import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

export async function prepareWindows(arch = 'x64') {
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Supported Windows architectures: x64, arm64');
  const version = JSON.parse(fs.readFileSync('node_modules/electron/package.json', 'utf8')).version;
  const filename = `electron-v${version}-win32-${arch}.zip`;
  const checksum = JSON.parse(fs.readFileSync('node_modules/electron/checksums.json', 'utf8'))[filename];
  if (!checksum) throw new Error('Official Electron checksum unavailable: ' + filename);
  const directory = path.resolve(`.build/electron-${version}-win32-${arch}`);
  const stamp = path.join(directory, '.verified-sha256');
  if (!fs.existsSync(path.join(directory, 'electron.exe')) || !fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== checksum) {
    fs.mkdirSync('.build', { recursive: true });
    const archive = path.resolve('.build', filename);
    const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (!fs.existsSync(archive) || hash(archive) !== checksum) {
      const mirror = process.env.ELECTRON_MIRROR;
      const url = mirror ? `${mirror.replace(/\/$/, '')}/${version}/${filename}` : `https://github.com/electron/electron/releases/download/v${version}/${filename}`;
      console.log(`Downloading Electron ${version} for Windows ${arch}…`);
      const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!response.ok || !response.body) throw new Error(`Electron download failed: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive));
      if (hash(archive) !== checksum) { fs.unlinkSync(archive); throw new Error('Electron checksum mismatch'); }
    }
    fs.mkdirSync(directory, { recursive: true });
    await require('@electron-internal/extract-zip').extract(archive, { dir: directory });
    fs.writeFileSync(stamp, checksum);
    console.log('Verified official Electron SHA-256:', checksum);
  }
  // Store PNG images in a standard multi-resolution ICO container.
  const sizes = [16, 32, 64, 128, 256];
  const images = sizes.map(size => fs.readFileSync(size === 64 ? 'assets/icon.iconset/icon_32x32@2x.png' : `assets/icon.iconset/icon_${size}x${size}.png`));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const base = 6 + index * 16;
    header[base] = header[base + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, base + 4); header.writeUInt16LE(32, base + 6);
    header.writeUInt32LE(images[index].length, base + 8); header.writeUInt32LE(offset, base + 12);
    offset += images[index].length;
  });
  fs.writeFileSync('assets/icon.ico', Buffer.concat([header, ...images]));
  return directory;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Prepared Windows runtime:', await prepareWindows(process.argv[2] || 'x64'));
}
