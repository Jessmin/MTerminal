const path = require('node:path');
const pkg = require('./package.json');
const version = require('electron/package.json').version;
const arch = process.env.MTERMINAL_WIN_ARCH || 'x64';
module.exports = {
  ...pkg.build,
  electronDist: path.resolve(`.build/electron-${version}-win32-${arch}`),
  npmRebuild: false,
  files: [
    ...pkg.build.files,
    '!node_modules/node-pty/build/**',
    '!node_modules/node-pty/prebuilds/darwin-*/**',
    `!node_modules/node-pty/prebuilds/win32-${arch === 'x64' ? 'arm64' : 'x64'}/**`,
    '!node_modules/node-pty/**/*.pdb',
    '!node_modules/node-pty/{src,deps,third_party}/**',
    '!node_modules/cpu-features/build/**',
    '!node_modules/ssh2/lib/protocol/crypto/build/**',
  ],
  win: {
    icon: 'assets/icon.ico', executableName: 'MTerminal',
    target: [{ target: 'nsis', arch: [arch] }, { target: 'zip', arch: [arch] }],
    signExecutable: false,
    artifactName: 'MTerminal-${version}-windows-${arch}.${ext}',
    requestedExecutionLevel: 'asInvoker',
  },
  nsis: {
    artifactName: 'MTerminal-${version}-windows-${arch}-setup.${ext}',
    oneClick: false, perMachine: false, allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    installerLanguages: ['zh_CN', 'en_US'],
  },
};
