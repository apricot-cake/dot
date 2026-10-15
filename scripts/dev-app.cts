const path = require('node:path');
const { spawn } = require('node:child_process');
const { cleanDebugEnvironment } = require('./lib-app-session.cts');
const appDir = path.resolve(__dirname, '../app');
const cli = path.join(path.dirname(require.resolve('electron-vite/package.json', { paths: [appDir] })), 'bin/electron-vite.js');
const child = spawn(process.execPath, [cli, 'dev', '--watch'], { cwd: appDir, env: { ...cleanDebugEnvironment(), DOT_START_INACTIVE: '1' }, windowsHide: true, stdio: 'inherit' });
child.once('error', (error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code: number) => {
  process.exitCode = code || 0;
});
