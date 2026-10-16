'use strict';

// #466の回帰テスト。inboxやorphanを経由しないDBシードでも、保存済み索引を
// 復元できることを2経路で確認する。まずアプリ未起動のホスト単独queryでDBから
// 索引を作り、保存済みIDを返す。次にその索引とホストのメモリキャッシュを消し、
// アプリ起動だけでも索引が作り直されることを確認する。最後のqueryを呼ぶ前に
// ファイル内容を検査し、ホストによる再構築でアプリ側の欠落が隠れないようにする。
//
//   node e2e/harness/cases/test-app-saved-index-startup.cts
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-savedidx-'));
const configDir = path.join(tmp, 'dot');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const POST_URL = 'https://x.com/EGOBJ4/status/2079187119311118431';
const CAPTURE_ID = 'dummy-466';
const SNAPSHOT_FILE = path.join(configDir, 'Cache', 'bridge-saved-index.json');

// writePost（lib-seed-library.cts）経由でDBへ直接シードする。inboxを一度も
// 経由せず、回復すべきorphanも無い＝アプリのライフタイム全体でscheduleSavedIndexWrite
// が一度も呼ばれないまま残っていた、まさにその形（#466）。
seedLibrary(configDir, [
  {
    captureId: CAPTURE_ID,
    image: `${CAPTURE_ID}.jpg`,
    url: POST_URL,
    platform: 'x',
    text: 't',
    tags: [],
    media: [{ url: 'https://pbs.twimg.com/media/EGOBJ4?format=jpg&name=orig', file: `${CAPTURE_ID}.jpg` }],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  },
]);

process.env.DOT_CONFIG_DIR = configDir;
const bridge = require(path.join(__dirname, '../../../native-host/bridge.mts'));

const snapshotMissingBeforeLaunch = !fs.existsSync(SNAPSHOT_FILE);
function snapshotMatchesSeed() {
  if (!fs.existsSync(SNAPSHOT_FILE)) return false;
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  const entries = Object.values(snap.entries || {}) as Array<{ id: string }>;
  return entries.length === 1 && entries[0].id === CAPTURE_ID;
}
async function main() {
  assert.equal(snapshotMissingBeforeLaunch, true, 'DBシードだけではキャッシュは存在しない');
  const answerBeforeLaunch = (await bridge.handleQuery({ type: 'query', urls: [POST_URL] })).results[POST_URL];
  assert.equal(answerBeforeLaunch?.id, CAPTURE_ID, 'アプリ未起動のホストがDBから保存済みIDを復元する');
  const hostSnapshotOk = snapshotMatchesSeed();
  assert.equal(hostSnapshotOk, true, 'ホスト単独queryが正しい索引ファイルを作成する');

  fs.rmSync(SNAPSHOT_FILE);
  bridge._resetSavedIndex();
  const snapshotMissingBeforeApp = !fs.existsSync(SNAPSHOT_FILE);
  assert.equal(snapshotMissingBeforeApp, true, 'アプリ側の検証はキャッシュなしから開始する');
  const evalJs = evalSource(async ({ sleep }) => {
    await (window as any).dot.listPosts();
    // デバウンスそのものが仕様: scheduleSavedIndexWriteは1500ms待ち、それが
    // 経過するまでレンダラーから観測できるものは何も無い。だからハーネスは
    // 終了する前にそれを過ぎるまで座っていなければならない。
    // biome-ignore lint/plugin: the 1500ms saved-index debounce is the spec — nothing is observable until it elapses.
    await sleep(1800);
    return 'primed';
  });

  const env = Object.assign({}, process.env, {
    APPDATA: tmp,
    DOT_CONFIG_DIR: configDir,
    DOT_SMOKE: '1',
    DOT_SMOKE_EVAL: evalJs,
  });

  const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d.toString();
    process.stdout.write(d);
  });

  child.on('close', async () => {
    const evalOk = /EVAL_RESULT "primed"/.test(out);
    const snapshotWritten = fs.existsSync(SNAPSHOT_FILE);
    // 最後のホストqueryより先に、アプリが書いたファイルを検査する。
    const snapshotOk = snapshotMatchesSeed();
    bridge._resetSavedIndex();
    const answerAfterLaunch = (await bridge.handleQuery({ type: 'query', urls: [POST_URL] })).results[POST_URL];
    const answerAfterOk = !!answerAfterLaunch && answerAfterLaunch.id === CAPTURE_ID;

    fs.rmSync(tmp, { recursive: true, force: true });

    const pass = snapshotMissingBeforeLaunch && hostSnapshotOk && snapshotMissingBeforeApp && evalOk && snapshotWritten && snapshotOk && answerAfterOk;
    console.log(
      `snapshotMissingBefore=${snapshotMissingBeforeLaunch} hostSnapshotOk=${hostSnapshotOk} snapshotMissingBeforeApp=${snapshotMissingBeforeApp} answerBefore=${JSON.stringify(answerBeforeLaunch)} eval=${evalOk} snapshotWritten=${snapshotWritten} snapshotOk=${snapshotOk} answerAfter=${JSON.stringify(answerAfterLaunch)}`,
    );
    console.log(pass ? 'SAVED_INDEX_STARTUP_PASS' : 'SAVED_INDEX_STARTUP_FAIL');
    process.exit(pass ? 0 : 1);
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
