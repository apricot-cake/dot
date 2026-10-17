'use strict';

// pnpm run app:shortcut。主作業ツリーの開発版を起動するショートカットを、利用者のスタートメニューへ作る。
// AppUserModelID は app/src/main/index.ts の開発実行と揃え、ピン留めと起動中のウィンドウを同じ項目にまとめる。
// WScript.Shell では AppUserModelID を設定できないため、Electron の shell.writeShortcutLink を使う。
const path = require('node:path');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');
const APP_USER_MODEL_ID = 'com.dot.app';
const SHORTCUT_NAME = 'dot (開発版).lnk';

if (process.versions.electron) {
  const { app, shell } = require('electron');
  const [electronExe, target] = [process.execPath, process.argv[2]];
  const ok = shell.writeShortcutLink(target, 'create', {
    target: electronExe,
    args: `"${appDir}" --dot-activate-existing`,
    cwd: root,
    icon: path.join(appDir, 'assets', 'icon.ico'),
    iconIndex: 0,
    appUserModelId: APP_USER_MODEL_ID,
    description: '主作業ツリーの dot 開発版',
  });
  if (ok) console.log(`作成しました: ${target}`);
  else console.error(`作成に失敗しました: ${target}`);
  app.exit(ok ? 0 : 1);
} else {
  if (process.platform !== 'win32') throw new Error('スタートメニューのショートカットは Windows 用です');
  const { execFileSync } = require('node:child_process');
  const { electronPath } = require('./lib-electron-path.cts');
  const programs = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  execFileSync(electronPath(), [__filename, path.join(programs, SHORTCUT_NAME)], { stdio: 'inherit', windowsHide: true });
}
