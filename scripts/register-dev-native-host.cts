'use strict';

// 管理された Chrome と普段のライブラリを接続する workspace ホストを登録する。
// Chrome プロファイルごとの独立した設定・ライブラリは作らない。
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// 開発用と日常用のプロファイルが共有する唯一の拡張機能id（署名鍵は
// extension/wxt.config.tsにある）。導出するのではなく直書きする＝鍵が足元で
// 変わったとき、登録が声高に失敗するように。
const EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const DEV_HOST_NAME = 'com.dot.host.workspace';
const { assertWindowsUserContext } = require('../native-host/windows-user-context.mts');

// installerをrequireする「前」に設定する: ホスト名とconfigディレクトリはどちらも
// モジュール読み込み時に読まれる。paths.mtsがDOT_CONFIG_DIRを読むのと
// ちょうど同じように。
process.env.DOT_NATIVE_HOST_NAME = DEV_HOST_NAME;

const installer = require('../native-host/install.mts');

// NativeMessagingHostsのキー1つの既定値。キーが無ければnull。native messagingは
// まさにこれらのキーを通してホスト名を解決し、無いか古いキーはブラウザ側で
// 「Specified native messaging host not found」として表面化する＝こちら側には
// 理由を言うものが何も無い。
function registeredManifest(key: string): string | null {
  try {
    // PowerShellではなく`reg`: これは登録のたびに走り、シェルの起動コストは
    // インストール全体より高くつく。値はパス（構造上ASCII＝configDirがそうだから）
    // なので、周りのコンソール出力をutf8としてデコードしても読んでいる部分が
    // 壊れることはない。
    const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return /REG_SZ\s+(.+)/.exec(out)?.[1].trim() ?? null;
  } catch {
    return null; // キーが無い＝`reg query`が非ゼロで終了する
  }
}

// たった今書いたものを読み戻して印字する。`expected`は各キーが運んでいるべき
// manifestのパス。キーが消えているべきときはnull。
function reportRegistry(expected: string | null): void {
  if (process.platform !== 'win32') return;
  const rows = installer.windowsRegistryKeys().map((key: string) => {
    const value = registeredManifest(key);
    if (expected === null) return { key, ok: value === null, state: value === null ? 'removed' : `STILL PRESENT → ${value}` };
    if (value === null) return { key, ok: false, state: 'MISSING' };
    return { key, ok: value === expected, state: value === expected ? 'ok' : `points elsewhere → ${value}` };
  });
  console.log('  レジストリ（HKCU、読み戻し）:');
  for (const row of rows) console.log(`    ${row.state.padEnd(9)} ${row.key}`);
  if (rows.some((row: { ok: boolean }) => !row.ok)) {
    console.error('レジストリが書き込んだ内容と一致しません。Chromeはこれらのキーを通してホスト名を解決するので、開発プロファイルからの保存は失敗します。');
    process.exitCode = 1;
  }
}

assertWindowsUserContext(process.argv[2] === 'uninstall' ? 'pnpm run ext:dev:register uninstall' : 'pnpm run ext:dev:register');

if (process.argv[2] === 'uninstall') {
  installer.uninstall();
  console.log(`開発用native messagingホスト "${DEV_HOST_NAME}" を削除しました。`);
  reportRegistry(null);
} else {
  const result = installer.install({ extensionId: EXTENSION_ID });
  console.log(`開発用native messagingホスト "${DEV_HOST_NAME}" をインストールしました。`);
  console.log(`  extensionId: ${result.extensionId}`);
  console.log(`  launcher:    ${result.launcher}`);
  console.log(`  manifest:    ${result.manifest}`);
  console.log(`  config:      ${path.join(result.configDir, 'config.json')}`);
  console.log(`  library:     ${JSON.parse(fs.readFileSync(path.join(result.configDir, 'config.json'), 'utf8').replace(/^\uFEFF/, '')).saveFolder}`);
  reportRegistry(result.manifest);
  console.log(`  エンドツーエンド: 開発プロファイルからcaptureし、${path.join(require('../native-host/paths.mts').logsDir(), 'bridge.log')} を読んでください。`);
}
