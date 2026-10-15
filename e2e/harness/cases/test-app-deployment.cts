'use strict';

// 実ライブラリと配備通知を共有しない複製で、背面起動からの自己再起動を確認する。
// 再起動で捨てるデバッグ接続には依存せず、複製内の観測用入口から初期化を確認する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { waitFor } = require('../../../scripts/lib-wait.cts');
const { cleanDebugEnvironment } = require('../../../scripts/lib-app-session.cts');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const root = path.resolve(__dirname, '../../..');
const tempRoot = path.resolve(os.tmpdir());
const tmp = fs.mkdtempSync(path.join(tempRoot, 'dot-deploy-test-'));
const appDir = path.join(tmp, 'app');
const config = path.join(tmp, 'config');
const library = path.join(tmp, 'library');
const observations = path.join(tmp, 'observations');
const electron = resolveElectron();

// 複製の package.json だけがこの入口を使う。本番のアプリやビルド出力は変更しない。
function observeDeployment() {
  const fs = require('node:fs');
  const path = require('node:path');
  const { app } = require('electron');
  const folder = process.env.DOT_DEPLOYMENT_OBSERVATIONS;
  const write = (name, data) => {
    const file = path.join(folder, `${process.pid}-${name}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
    fs.renameSync(`${file}.tmp`, file);
  };
  write('started', { pid: process.pid, argv: process.argv });
  app.on('browser-window-created', (_event, win) => {
    win.on('show', () => write('visible', { pid: process.pid }));
    win.on('focus', () => write('focused', { pid: process.pid }));
    win.webContents.once('did-finish-load', async () => {
      if (!win.webContents.getURL().startsWith('app://bundle/')) return;
      try {
        const result = await win.webContents.executeJavaScript('window.dot.listPosts().then(result => ({ saveFolder: result.saveFolder, postsLoaded: Array.isArray(result.posts) }))');
        write('ready', { pid: process.pid, argv: process.argv, ...result, visible: win.isVisible(), focused: win.isFocused() });
      } catch (error) {
        write('error', { pid: process.pid, error: String(error) });
      }
    });
  });
  require('./index.js');
}

for (const folder of [appDir, config, library, observations]) fs.mkdirSync(folder);
fs.cpSync(path.join(root, 'app', 'out'), path.join(appDir, 'out'), { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'app', 'package.json'), 'utf8'));
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ ...pkg, main: './out/main/deployment-observer.cjs' }));
fs.writeFileSync(path.join(appDir, 'out/main/deployment-observer.cjs'), `(${observeDeployment.toString()})();`);
fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({ saveFolder: library }));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'junction');
fs.symlinkSync(path.join(root, 'app', 'node_modules'), path.join(appDir, 'node_modules'), 'junction');
fs.symlinkSync(path.join(root, 'native-host'), path.join(tmp, 'native-host'), 'junction');
const env: NodeJS.ProcessEnv = { ...cleanDebugEnvironment(), DOT_CONFIG_DIR: config, DOT_SANDBOX: '1', DOT_DEPLOYMENT_OBSERVATIONS: observations };
delete env.DOT_SMOKE;
delete env.DOT_SMOKE_EVAL;
delete env.ELECTRON_RENDERER_URL;
const launch = (args: string[]) => spawn(electron, [appDir, '--dot-background', ...args], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'] });
const signalQuit = () =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(electron, [appDir, '--dot-background', '--dot-quit'], { env, windowsHide: true, stdio: 'ignore', timeout: 15000 });
    child.once('error', reject);
    child.once('close', (code: number | null, signal: string | null) => {
      if (signal || code === null) reject(new Error(`検証アプリの終了要求が中断されました (${signal})`));
      else resolve(code);
    });
  });

function observed(name: string) {
  return fs
    .readdirSync(observations)
    .filter((file: string) => file.endsWith(`-${name}.json`))
    .map((file: string) => JSON.parse(fs.readFileSync(path.join(observations, file), 'utf8')));
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function assertReady(record: any) {
  assert.equal(record.postsLoaded, true);
  assert.equal(path.resolve(record.saveFolder), library);
  assert.equal(record.visible, false);
  assert.equal(record.focused, false);
  assert.ok(record.argv.includes('--dot-background'));
  assert.ok(!record.argv.some((arg: string) => /^--(?:remote-debugging-(?:port|address|pipe)|inspect(?:-brk)?)(?:=|$)/.test(arg)));
  assert.ok(isAlive(record.pid));
}

(async () => {
  let started = false;
  let failure: unknown;
  try {
    let exited: number | null = null;
    let spawnError: Error | undefined;
    const initial = launch([]);
    initial.once('error', (error: Error) => {
      spawnError = error;
    });
    initial.once('close', (code: number) => {
      exited = code;
    });
    started = true;
    await waitFor(
      '初回起動の画面とライブラリの初期化',
      () => {
        if (spawnError) throw spawnError;
        if (exited !== null) throw new Error(`初回起動が終了しました (${exited})`);
        return observed('ready').some((record: any) => record.pid === initial.pid);
      },
      { timeoutMs: 30000 },
    );
    const first = observed('ready').find((record: any) => record.pid === initial.pid);
    assertReady(first);
    const marker = path.join(appDir, '.deployed-build.json');
    fs.writeFileSync(`${marker}.tmp`, JSON.stringify({ build: 'test-update' }));
    fs.renameSync(`${marker}.tmp`, marker);
    await waitFor('配備通知を受けた旧プロセスの正常終了', () => exited === 0, { timeoutMs: 30000 });
    await waitFor('再起動した別プロセスの画面とライブラリの初期化', () => observed('ready').some((record: any) => record.pid !== first.pid), { timeoutMs: 30000 });
    const restarted = observed('ready').filter((record: any) => record.pid !== first.pid);
    assert.equal(restarted.length, 1);
    assertReady(restarted[0]);
    assert.deepEqual(observed('visible'), []);
    assert.deepEqual(observed('focused'), []);
    assert.equal(await signalQuit(), 3);
    console.log('APP_DEPLOYMENT_TEST_PASS');
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (started) {
        await waitFor('検証アプリのロック解放', async () => (await signalQuit()) === 0, { timeoutMs: 15000 });
        await waitFor('観測したアプリのメインプロセスの終了', () => observed('started').every((record: any) => !isAlive(record.pid)), { timeoutMs: 15000 });
        assert.deepEqual(observed('visible'), []);
        assert.deepEqual(observed('focused'), []);
      }
    } catch (error) {
      failure = failure ? new AggregateError([failure, error], '再起動検証と後片付けに失敗しました') : error;
    }
    // この実行で作った OS 一時領域だけを撤去する。参照先は junction を先に外して残す。
    try {
      const resolved = path.resolve(tmp);
      assert.ok(path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('dot-deploy-test-'), '一時領域の撤去先が一致しません');
      if (!failure || observed('started').every((record: any) => !isAlive(record.pid))) {
        for (const name of ['node_modules', 'app/node_modules', 'native-host']) fs.unlinkSync(path.join(resolved, name));
        fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    } catch (error) {
      failure = failure ? new AggregateError([failure, error], '再起動検証と一時領域の撤去に失敗しました') : error;
    }
  }
  if (failure) throw failure;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
