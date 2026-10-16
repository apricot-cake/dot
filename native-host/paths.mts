// 設定・再生成可能なキャッシュ・セッション・一時領域はライブラリから分ける。
// MSIX は Windows Package Identity と ApplicationData API に従い、
// 主作業ツリーは dot-Workspace、明示 DOT_CONFIG_DIR は隔離検証に使う。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getWindowsPackageData } from './windows-app-data.mts';
import type { WindowsPackageData } from './windows-app-data.mts';

export const APP_NAME = 'dot';
const WORKSPACE_NAME = 'dot-Workspace';
const LIBRARY_DIR_NAME = 'Library';

export interface AppStoragePaths {
  config: string;
  cache: string;
  session: string;
  logs: string;
  temporaryRoot: string;
  packaged: boolean;
}

export function resolveAppStoragePaths({ env, home, packageData }: { env: NodeJS.ProcessEnv; home: string; packageData: WindowsPackageData | null }): AppStoragePaths {
  if (env.DOT_CONFIG_DIR) {
    const root = env.DOT_CONFIG_DIR;
    return { config: root, cache: path.join(root, 'Cache'), session: path.join(root, 'Session'), logs: path.join(root, 'Logs'), temporaryRoot: path.join(root, 'Temp'), packaged: false };
  }
  if (packageData)
    return {
      config: packageData.localState,
      cache: packageData.localCache,
      // sessionData にはCookie/localStorageを含む。消去可能なキャッシュと区別する。
      session: path.join(packageData.localState, 'Session'),
      logs: path.join(packageData.localCache, 'Logs'),
      temporaryRoot: packageData.tempState,
      packaged: true,
    };
  const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const runtime = path.join(local, WORKSPACE_NAME);
  return { config: path.join(roaming, WORKSPACE_NAME), cache: path.join(runtime, 'Cache'), session: path.join(runtime, 'Session'), logs: path.join(runtime, 'Logs'), temporaryRoot: env.TEMP || env.TMP || os.tmpdir(), packaged: false };
}

export function appStoragePaths(): AppStoragePaths {
  if (!process.env.DOT_CONFIG_DIR && process.platform !== 'win32') throw new Error(`Unsupported platform: ${process.platform}`);
  return resolveAppStoragePaths({ env: process.env, home: os.homedir(), packageData: process.env.DOT_CONFIG_DIR ? null : getWindowsPackageData() });
}
export { getWindowsPackageData };

export const configDir = () => appStoragePaths().config;
export const cacheDir = () => appStoragePaths().cache;
export const sessionDir = () => appStoragePaths().session;
export const logsDir = () => appStoragePaths().logs;

let temporary: string | undefined;
export function temporaryDir(): string {
  if (!temporary) {
    const root = appStoragePaths().temporaryRoot;
    fs.mkdirSync(root, { recursive: true });
    temporary = fs.mkdtempSync(path.join(root, 'dot-'));
  }
  return temporary;
}
export function cleanupTemporaryDir(): void {
  if (!temporary) return;
  const owned = temporary;
  temporary = undefined;
  fs.rmSync(owned, { recursive: true, force: true });
}
process.once('exit', () => {
  try {
    cleanupTemporaryDir();
  } catch {
    /* OSの一時領域に残り、永続保存には使わない。 */
  }
});
// ライブラリ（キャプチャ）の既定フォルダ＝Windows のホーム直下にある dot/Library。ユーザーが
// 保存フォルダを明示的に選ぶまで、ブリッジとアプリの両方がこれを使う。configDir() とは
// 必ず分ける。ライブラリは元のメディアを蓄積して大きくなりうるので、
// 小さな設定ディレクトリに混ぜず、自前のトップレベルのフォルダに置く。
//
// OS ごとの app-data 領域ではなくホームディレクトリを選ぶのは、回避策ではなくプロダクト
// としての判断（#232）。保存されるファイルはユーザー自身の中身だから、ユーザーが開き、
// 動かし、バックアップする場所にあるべきだ。app-data は既定で隠されていて、逆のことを
// 言っている。収集アプリの定着した先例も同じ（Zotero はどの OS でも ~/Zotero を使う）。
// Documents や Pictures は意図して避けている。OneDrive 系のフォルダバックアップが狙うのが
// そこで、同期フォルダにライブラリを実時間で書き込むと壊れる（#95 は、ユーザーがそういう
// フォルダを選んだときにこれを警告する）。
//
// Windows はかつて MSIX のストレージ仮想化を避けるため別の場所を使っていたが、
// その理由は 2026-08-06 に失効した（#1003）。現在はこの利用者が直接扱える場所へ置く。
export function defaultLibraryDir(): string {
  return path.join(os.homedir(), APP_NAME, LIBRARY_DIR_NAME);
}

export function libraryDestinationDir(chosen: string): string {
  const name = path.basename(chosen).toLowerCase();
  if (name === LIBRARY_DIR_NAME.toLowerCase()) return chosen;
  if (name === APP_NAME.toLowerCase()) return path.join(chosen, LIBRARY_DIR_NAME);
  return path.join(chosen, APP_NAME, LIBRARY_DIR_NAME);
}

// ローカルの拡張機能ビルドが自分を名乗る場所（#650）。置き場が揃った時点で
// `pnpm run ext:build` が書き、ブリッジが読む。こうしてどの応答にもトークンを載せられる
// ＝パッケージ化せず読み込んだ拡張機能は、これでディスク上の自分のバンドルが差し替わった
// と知り、自分を読み込み直す。
//
// ビルド出力の隣ではなく configDir() に置くのは、そこが2つのプロセスが教えられずとも
// 既に一致している唯一の絶対パスだから。ブリッジはレジストリの登録から Chrome に起動
// され、リポジトリの位置を知らない。拡張機能をビルドしていないマシンには存在せず、
// それがリリース版のインストールでこの経路まるごとを不活性にしている。
export function extensionBuildStampPath(): string {
  return path.join(configDir(), 'extension-build.json');
}

// #71: 拡張機能がインストールされていて、一度でもアプリと話したことがある、という
// アプリ側の唯一の手がかり。Native Messaging ホストは Chrome が接続ごとに起動する
// 使い捨てのプロセスで（bridge.mts の冒頭を参照）、「今つながっているか」を尋ねられる
// 生きた鼓動は無い。そこでブリッジは、確認（{type:'query'}）や保存を処理するたびに
// この印に触る。アプリはファイルが在ることだけを「一度でも接触があった」と扱う
// （empty/EmptyState.tsx の firstRun と、インストール案内の側の出し分け、#71）。中身は
// 素の ISO タイムスタンプで、それ以外は一切書き込まない。拡張機能の id もブラウザ名も
// URL も書かないのは、アプリが中身を読まず、存在だけを見るから。
export function extensionContactPath(): string {
  return path.join(configDir(), 'extension-contact.json');
}
