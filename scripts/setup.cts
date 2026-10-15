'use strict';

// pnpm install の後に、Electron のランタイムを準備する。
// postinstall を持たない Electron も install.js によるダウンロードが必要。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'app');
const electronPackage = require.resolve('electron/package.json', { paths: [appDir] });
const electronDir = path.dirname(electronPackage);
const binary = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
if (!fs.existsSync(path.join(electronDir, 'dist', binary))) {
  execFileSync(process.execPath, [path.join(electronDir, 'install.js')], { cwd: root, stdio: 'inherit', windowsHide: true });
}
