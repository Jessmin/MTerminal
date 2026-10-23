import { execFileSync } from 'node:child_process';
import { prepareWindows } from './prepare-windows.mjs';
const arch = process.argv.includes('--arm64') ? 'arm64' : 'x64';
await prepareWindows(arch);
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/notices.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/electron-builder/cli.js', '--win', '--' + arch, '--config', 'electron-builder.win.cjs', '--publish', 'never'], {
  stdio: 'inherit', env: { ...process.env, MTERMINAL_WIN_ARCH: arch },
});
execFileSync(process.execPath, ['scripts/verify-windows.mjs', ...(arch === 'arm64' ? ['--arm64'] : [])], { stdio: 'inherit' });
