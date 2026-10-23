import fs from 'node:fs';
import path from 'node:path';
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const notices = ['MTerminal third-party notices\nGenerated from the installed production dependencies.\n'];
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || entry.dev) continue;
  const directory = path.resolve(location);
  if (!fs.existsSync(directory)) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const names = fs.readdirSync(directory).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
  notices.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license || entry.license || 'see included notice'}\n`);
  for (const name of names) {
    const file = path.join(directory, name);
    if (fs.statSync(file).isFile()) notices.push(`\n--- ${name} ---\n${fs.readFileSync(file, 'utf8')}\n`);
  }
}
fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/THIRD_PARTY_NOTICES.txt', notices.join('\n'));
