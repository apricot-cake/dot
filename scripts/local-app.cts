const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { cleanDebugEnvironment, stopPersonalApp, withAppSession } = require('./lib-app-session.cts');

const root = path.resolve(__dirname, '..');

function personalEnv() {
  const env = cleanDebugEnvironment();
  for (const key of Object.keys(env)) {
    const name = key.toUpperCase();
    if (name.startsWith('DOT_') || name === 'ELECTRON_RENDERER_URL' || name === 'ELECTRON_ENTRY') delete env[key];
  }
  return env;
}

function developmentRuntime() {
  return { exe: require('./lib-electron-path.cts').electronPath(), app: path.join(root, 'app') };
}

function startRuntime(runtime, args) {
  const child = spawn(runtime.exe, [runtime.app, ...args], { env: personalEnv(), detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
  return child;
}

async function launch({ background = false } = {}) {
  const runtime = developmentRuntime();
  if (!fs.existsSync(runtime.exe) || !fs.existsSync(path.join(runtime.app, 'out/main/index.js'))) throw new Error('起動に必要なファイルがありません');
  // 既存インスタンスへの表示要求はアプリの single-instance lock が処理する。
  const child = startRuntime(runtime, background ? ['--dot-background'] : ['--dot-activate-existing']);
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

async function verify(args = process.argv.slice(3)) {
  const env = personalEnv();
  await stopPersonalApp(env);
  return withAppSession({ env, hmr: true, launchTimeoutMs: 120_000 }, (session) => require('./cdp-verify.cts').run(session, args));
}

async function main(action: string) {
  if (process.platform !== 'win32') throw new Error('この私用ランチャーはWindows用です');
  if (action === 'launch') await launch();
  else if (action === 'verify') await verify();
  else throw new Error('使い方: local-app.cts launch | verify');
}

module.exports = { personalEnv, developmentRuntime, main, verify };
if (require.main === module)
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
