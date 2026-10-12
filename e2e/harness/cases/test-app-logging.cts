'use strict';

// 使い捨てのElectronインスタンスを起動し、メインプロセスの起動診断と
// キャッチされないレンダラーのエラーの両方が、configディレクトリのログに
// 着地することを証明する。

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-logging-'));
const configDir = path.join(tmp, 'dot');
const logPath = path.join(configDir, 'logs', 'main.log');

// throwはインラインで発生させるのではなくスケジュールする: 検証対象は
// 「キャッチされない」レンダラーのエラーがログへ届くことで、インラインの
// throwだとevalのPromiseの連鎖自体に捕まってしまう。
const evalJs = evalSource(
  () =>
    new Promise((resolve) => {
      setTimeout(() => {
        throw new Error('renderer-log-smoke');
      }, 50);
      setTimeout(() => resolve('scheduled'), 200);
    }),
);

const env = {
  ...process.env,
  APPDATA: tmp,
  DOT_CONFIG_DIR: configDir,
  DOT_SMOKE: '1',
  DOT_SMOKE_EVAL: evalJs,
};

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: 'pipe' });
let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  output += chunk;
});

child.on('close', (code) => {
  try {
    const log = fs.readFileSync(logPath, 'utf8');
    if (code !== 0) throw new Error(`Electronが終了しました ${code}\n${output}`);
    if (!log.includes('Starting dot')) throw new Error(`mainの起動ログがありません\n${log}`);
    if (!log.includes('renderer-log-smoke')) throw new Error(`レンダラーのエラーログがありません\n${log}`);
    if (log.includes('Launched without --remote-debugging-port')) throw new Error('通常起動を debug port 不足として警告しています');
    console.log(`PASS app logging: ${logPath}`);
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
