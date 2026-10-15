'use strict';

// 専用 config とシード済みライブラリを使う背面の検証セッション。
// 起動したコマンドが CDP pipe を所有し、終了時にアプリと HMR を閉じる。
//
//   node scripts/sandbox-app.cts start -- eval "document.title"
//   node scripts/sandbox-app.cts          Ctrl+C までセッションを保持
//
// シード（#286）。既定は下の生成されたフィクスチャライブラリ。--real を渡すと
// 代わりに実ライブラリからシードする＝その DB の backup-API スナップショットと、
// 生成した代役メディアの組み合わせで、フィクスチャでは再現できない2つのこと
// （実際の多様性/規模、そして特定の1投稿）に対応する。実ライブラリを持つ機体
// でのみ動き、そこへは一切書き込まず、シード済みのサンドボックスがまだ実パスを
// 知っている場合は起動を拒否する（scripts/lib-sandbox-real-seed.cts）:
//
//   node scripts/sandbox-app.cts start --real
//   node scripts/sandbox-app.cts start --real --capture 1784937641978-06cd   （その投稿の実ファイル）
//   node scripts/sandbox-app.cts start --real --reseed --max-dim 1024
//
// 実データのインスタンスは常設の画面上通知を表示する: そのウィンドウは個人データを
// 運んでいるので、そのスクリーンショットは公開物（PR/Issue）へ絶対に貼ってはならない。
//
// 隔離のモデル（issue #283 参照）:
//   - DOT_CONFIG_DIR → <tree>/.sandbox/config: userData は config ディレクトリに
//     固定され、Electron のシングルインスタンスロックは userData をキーにするので、
//     このインスタンスは実アプリと共存できる。
//   - DOT_SANDBOX=1 → app/src/main/index.ts は native host の登録をスキップする
//     （HKCU への書き込みも共有 config ディレクトリへのコピーも無し）。
//   - config.json は必ず最初の起動より前に書かれ、saveFolder をサンドボックスの
//     ライブラリへ向ける＝未設定のまま起動すると、代わりに実際の既定ライブラリ
//     ディレクトリを使ってしまう。
//   - 公開 endpoint へ接続せず、起動したプロセスの継承 pipe を使う。
//
// 設定とテスト用ライブラリは .sandbox/ に保持し、再起動後も再利用する。

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const appDir = path.join(repoRoot, 'app');
const { assertSandboxSeedProvenance, makePng, seedRealSandbox, wipeSandboxSeed, DEFAULT_MAX_DIM } = require('./lib-sandbox-real-seed.cts');
const { seedLibrary } = require('./lib-seed-library.cts');
const { configDir: realConfigDir, defaultLibraryDir } = require('../native-host/paths.mts');
const { assertMainWorkingTree, clearInstance, readInstance } = require('./lib-sandbox-instance.cts');

assertMainWorkingTree(repoRoot);

const sandboxRoot = path.join(repoRoot, '.sandbox');
const configDir = path.join(sandboxRoot, 'config');
const saveFolder = path.join(sandboxRoot, 'library');
const appData = path.join(sandboxRoot, 'appdata'); // %APPDATA% への退避読み書きが実物に触れないようにする（test-app-* ハーネスと同じ流儀）
// 現在のライブラリが何からシードされたか＝起動のたびに読む。単に再起動しただけの
// インスタンスにも実データ通知を再適用しなければならないため。
const seedFile = path.join(sandboxRoot, 'seed.json');
const realSeedReceiptFile = path.join(sandboxRoot, 'real-seed-publish.json');

// ---- fixture posts ---------------------------------------------------------
// 画像は実データシードが代役を生成するのと同じ単色グラデーション PNG
// （エンコーダーは1つを共有）。

const PLATFORMS = ['x', 'bluesky', 'pixiv'];
const SIZES: Array<[number, number]> = [
  [400, 300],
  [300, 400],
  [400, 400],
  [600, 240],
  [240, 600],
];
const COLORS: Array<[number, number, number]> = [
  [244, 154, 194],
  [255, 191, 134],
  [250, 231, 140],
  [168, 228, 160],
  [137, 207, 240],
  [177, 156, 217],
  [255, 160, 160],
  [140, 216, 199],
  [222, 184, 135],
  [176, 196, 222],
  [240, 180, 220],
  [190, 210, 150],
];
const TAGS = [['test'], ['test', '構図'], ['test', '配色'], ['test', '構図', 'ポーズ'], []];
const TEXTS = ['サンドボックス検証用のダミー投稿です。', '短文。', 'モーション・レイアウト検証のためのフィクスチャ投稿。カードの高さが揃わないよう、本文の長さは投稿ごとに変えてあります。グリッドの詰め方や省略記号の出方はこの投稿で確認できます。', '改行を含む投稿。\n二行目。\n三行目はすこし長めにしてあります。'];

// 連続するフィクスチャ投稿の間隔。意図的に1日より広く取り、12件が複数の暦月に
// またがるようにしている。これで月ごとの日付セクションと見出しを検証できる。
const FIXTURE_SPACING_MS = 12 * 86400000;

function seedFixtureLibrary() {
  fs.mkdirSync(saveFolder, { recursive: true });
  if (libraryIsSeeded()) return false;
  const base = Date.UTC(2026, 0, 15, 12, 0, 0);
  const records: any[] = [];
  for (let i = 0; i < 12; i++) {
    const platform = PLATFORMS[i % PLATFORMS.length];
    const [w, h] = SIZES[i % SIZES.length];
    const captureId = `${base - i * FIXTURE_SPACING_MS}-sb${String(i).padStart(2, '0')}`;
    fs.writeFileSync(path.join(saveFolder, `${captureId}.png`), makePng(w, h, COLORS[i % COLORS.length]));
    const date = new Date(base - i * FIXTURE_SPACING_MS - 7200000).toISOString();
    records.push({
      captureId,
      image: `${captureId}.png`,
      url: `https://example.com/sandbox/${i}`,
      platform,
      text: `[${i + 1}/12] ${TEXTS[i % TEXTS.length]}`,
      displayName: `サンドボックス${i + 1}号`,
      screenName: `sandbox_${i + 1}`,
      likes: (i * 137) % 9000,
      reposts: (i * 41) % 800,
      replies: (i * 7) % 60,
      date,
      capturedAt: new Date(base - i * FIXTURE_SPACING_MS).toISOString(),
      tags: TAGS[i % TAGS.length],
    });
  }
  seedLibrary(configDir, records);
  fs.writeFileSync(seedFile, JSON.stringify({ mode: 'fixture', seededAt: new Date().toISOString() }, null, 2));
  return true;
}

// ---- real-data seed (#286) --------------------------------------------------

function readSeed(): any | null {
  try {
    return JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  } catch {
    return null;
  }
}

function libraryIsSeeded(): boolean {
  // #176: dot.db は今は configDir ではなく保存フォルダの中にある。
  if (fs.existsSync(path.join(saveFolder, 'dot.db'))) return true;
  try {
    return fs.readdirSync(saveFolder).length > 0;
  } catch {
    return false;
  }
}

// --reseed: サンドボックスは意図的に使い捨てなので、2つのシードをマージしようと
// せず、シード済みの状態（ライブラリ・データベース・config）をまるごと落とす。
// #176: dot.db（+ -wal/-shm）は今は saveFolder の「中」にあるので、
// 下の再帰的な削除で既に取り除かれる＝個別の db 削除は不要。
function wipeSeed() {
  wipeSandboxSeed({ receiptPath: realSeedReceiptFile, library: saveFolder, config: path.join(configDir, 'config.json'), marker: seedFile });
}

// 実ライブラリは、そこへ capture している機体にしか存在しない。それ以外の場所
// （まっさらな clone、クラウドのランナー）では、ファイルが無いことによる
// スタックトレースではなく、理由を添えて失敗しなければならない＝#175 の
// 生成ダミーライブラリがそこでの代役になる。
function resolveRealLibrary(): { configDir: string; saveFolder: string } {
  if (process.env.DOT_CONFIG_DIR) throw new Error('DOT_CONFIG_DIR が設定されています＝既に隔離済みの config ディレクトリを実ライブラリとして扱うことを拒否します');
  const dir = realConfigDir();
  const configPath = path.join(dir, 'config.json');
  let folder = '';
  try {
    folder = JSON.parse(fs.readFileSync(configPath, 'utf8')).saveFolder || '';
  } catch {
    /* 既定値へフォールスルー */
  }
  if (!folder) folder = defaultLibraryDir();
  // #176: dot.db は今は configDir ではなく保存フォルダの中にある。
  if (!fs.existsSync(path.join(folder, 'dot.db'))) throw new Error(`この機体に実ライブラリがありません（${path.join(folder, 'dot.db')} が見つかりません）。フィクスチャシードを使うか、scripts/gen-dummy-library.cts で生成してください`);
  return { configDir: dir, saveFolder: folder };
}

async function seedReal(opts: { captureIds: string[]; maxDim: number }) {
  const real = resolveRealLibrary();
  console.log(`実ライブラリからシード中: ${real.configDir}（メディア: ${real.saveFolder}）`);
  const report = await seedRealSandbox({
    realConfigDir: real.configDir,
    realSaveFolder: real.saveFolder,
    sandboxConfigDir: configDir,
    sandboxLibrary: saveFolder,
    captureIds: opts.captureIds,
    maxDim: opts.maxDim,
    successMarkerPath: seedFile,
    publishReceiptPath: realSeedReceiptFile,
    log: (msg: string) => console.log(`  ${msg}`),
  });
  return report;
}

// 実データのインスタンスが動いている間ずっと運ぶ画面上の通知。これがあれば、
// そのスクリーンショットがフィクスチャのスクリーンショットに見えることはない
// （#286: 実メディアは公開物に届いてはならず、実データベースの投稿本文も同じ理由で
// 個人情報にあたる）。
function noticeFor(seed: any | null): string | null {
  if (!seed || seed.mode !== 'real') return null;
  const ids = (seed.realMedia && seed.realMedia.captureIds) || [];
  if (ids.length) return `実データ検証インスタンス（実メディア入り: ${ids.join(', ')}）— このウィンドウのスクリーンショットを公開物へ貼らないこと`;
  return '実データ検証インスタンス（実DBスナップショット）— このウィンドウのスクリーンショットを公開物へ貼らないこと';
}

// ---- instance management ---------------------------------------------------

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function start(opts: StartOptions, operation = (session: any) => require('./cdp-verify.cts').run(session, [])) {
  const existing = readInstance(repoRoot);
  if (existing && isAlive(existing.pid)) throw new Error('旧サンドボックスが動作中です。sandbox-app.cts stop で通常終了してから実行してください。');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  if (opts.reseed) wipeSeed();
  assertSandboxSeedProvenance({ receiptPath: realSeedReceiptFile, markerPath: seedFile, library: saveFolder });
  let seeded = false;
  if (opts.real) {
    if (libraryIsSeeded() && (readSeed() || {}).mode !== 'real') {
      console.error('FAIL このサンドボックスは既にフィクスチャライブラリを持っています。明示的に再シードしてください: node scripts/sandbox-app.cts start --real --reseed');
      process.exit(1);
    }
    if (!libraryIsSeeded()) {
      await seedReal(opts);
      seeded = true;
    }
  } else {
    const configPath = path.join(configDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({ saveFolder, extensionId: 'testextensionidabcdefghijklmnop' }, null, 2));
    }
    seeded = seedFixtureLibrary();
  }
  const notice = noticeFor(readSeed());

  // HMRの生成物で普段使いの app/out を上書きしない。
  const sandboxOutput = path.join(sandboxRoot, 'out');
  fs.cpSync(path.join(appDir, 'assets'), path.join(sandboxRoot, 'assets'), { recursive: true });
  // Electron は package.json のあるアプリフォルダーから起動する。
  // JS ファイルを直接指定すると app.getAppPath() が main 出力先になり、
  // 画像検査器・検索エンジン・アーカイブ処理の vendor パスが解決できない。
  fs.copyFileSync(path.join(appDir, 'package.json'), path.join(sandboxRoot, 'package.json'));
  fs.cpSync(path.join(appDir, 'vendor'), path.join(sandboxRoot, 'vendor'), { recursive: true });
  const env = Object.assign({}, process.env, {
    APPDATA: appData,
    DOT_CONFIG_DIR: configDir,
    DOT_SANDBOX: '1',
    DOT_APP_BUILD_OUT: sandboxOutput,
    ELECTRON_ENTRY: sandboxRoot,
    // 検証インスタンスはキーボードの前の人ではなくセッションが起動する: それが
    // その人の作業からフォアグラウンドを奪ってはいけない。手で操作したい稀な実行
    // には DOT_START_INACTIVE=0 を設定する。
    DOT_START_INACTIVE: process.env.DOT_START_INACTIVE || '1',
    ...(notice ? { DOT_SANDBOX_NOTICE: notice } : {}),
  });
  const { cleanDebugEnvironment, withAppSession } = require('./lib-app-session.cts');
  const safeEnv = cleanDebugEnvironment(env);
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  for (const task of ['_build:theme-boot', '_build:native-host-bridge']) execFileSync(pnpm, ['--filter', '@apricot-cake/dot', 'run', task], { cwd: repoRoot, env: safeEnv, stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true });
  const cli = path.join(path.dirname(require.resolve('electron-vite/package.json', { paths: [appDir, repoRoot] })), 'bin', 'electron-vite.js');
  // main/preload と同じ出力先でビルドし、renderer HMR は所有セッションが提供する。
  const build = spawn(process.execPath, [cli, 'build'], { cwd: appDir, env: safeEnv, windowsHide: true, stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    build.once('error', reject);
    build.once('exit', (code: number) => (code === 0 ? resolve() : reject(new Error('サンドボックスのビルドに失敗しました'))));
  });
  if (seeded && !opts.real) console.log(`${saveFolder} へフィクスチャ投稿12件をシードしました`);
  if (notice) console.log(`⚠ ${notice}`);
  return withAppSession({ appPath: sandboxRoot, env: safeEnv, hmr: true }, operation);
}

async function stop() {
  const inst = readInstance(repoRoot);
  if (!inst || !isAlive(inst.pid)) {
    clearInstance(repoRoot);
    console.log('別コマンドへ接続するサンドボックスはありません。所有コマンドを Ctrl+C で終了してください。');
    return;
  }
  // 移行前のインスタンスだけを single-instance lock で通常終了する。
  const { electronPath } = require('./lib-electron-path.cts');
  const env = require('./lib-app-session.cts').cleanDebugEnvironment({ ...process.env, APPDATA: appData, DOT_CONFIG_DIR: configDir, DOT_SANDBOX: '1' });
  const child = spawn(electronPath(), [sandboxRoot, '--dot-quit'], { env, windowsHide: true, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code: number) => (code === 0 || code === 3 ? resolve() : reject(new Error('旧サンドボックスの終了要求に失敗しました'))));
  });
  const { waitFor } = require('./lib-wait.cts');
  await waitFor('旧サンドボックスの通常終了', () => !isAlive(inst.pid), { timeoutMs: 20_000, pollMs: 250 });
  clearInstance(repoRoot);
}

interface StartOptions {
  real: boolean;
  reseed: boolean;
  captureIds: string[];
  maxDim: number;
}

function parseStartOptions(argv: string[]): StartOptions {
  const opts: StartOptions = { real: false, reseed: false, captureIds: [], maxDim: DEFAULT_MAX_DIM };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--real') opts.real = true;
    else if (a === '--reseed') opts.reseed = true;
    else if (a === '--capture')
      opts.captureIds.push(
        ...String(argv[++i] || '')
          .split(',')
          .filter(Boolean),
      );
    else if (a === '--max-dim') opts.maxDim = Number(argv[++i]);
    else throw new Error(`不明なオプション: ${a}`);
  }
  if (!Number.isFinite(opts.maxDim) || opts.maxDim < 16) throw new Error('--max-dim は 16 以上でなければなりません');
  if (opts.captureIds.length && !opts.real) throw new Error('--capture は --real にのみ適用されます（フィクスチャシードには固定できる実投稿がありません）');
  return opts;
}

module.exports = { start, parseStartOptions, stop };
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0] && !args[0].startsWith('--') ? args.shift() : 'start';
  const separator = args.indexOf('--');
  const action = separator < 0 ? [] : args.splice(separator).slice(1);
  let opts: StartOptions = parseStartOptions([]);
  if (cmd === 'start') {
    try {
      opts = parseStartOptions(args);
    } catch (error) {
      console.error((error as Error).message);
      process.exit(2);
    }
  }
  const task = cmd === 'start' ? start(opts, (session: any) => require('./cdp-verify.cts').run(session, action)) : cmd === 'stop' ? stop() : Promise.reject(new Error('使い方: sandbox-app.cts start [--real --reseed] [-- eval <式> | shot | run <モジュール>] | stop'));
  task.catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
