'use strict';
// ログイン済みの開発用 Chrome に、検証専用の保存先を持つタブを開く。
const fs = require('node:fs');
const path = require('node:path');
const { developmentOptions, startDevelopmentBrowser, waitForInterrupt } = require('./lib-dev-browser.cts');
const root = path.resolve(__dirname, '..');
const url = process.argv[2];
if (!url || !/^https:\/\/(?:x\.com|twitter\.com|bsky\.app|www\.pixiv\.net)\//.test(url)) throw new Error('検証する投稿の HTTPS URL を指定してください。');

async function main() {
  const lock = await require('../native-host/request-lock.mts').acquireExactRequestLock(require('node:os').homedir(), 'sandbox-native-host-registration');
  try {
    return await require('./sandbox-app.cts').start(require('./sandbox-app.cts').parseStartOptions([]), verify);
  } finally {
    await lock?.close();
  }
}

async function verify(app: any) {
  const configDir = path.join(root, '.sandbox/config');
  const config = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
  const library = path.resolve(config.saveFolder);
  if (library !== path.join(root, '.sandbox/library')) throw new Error('検証用アプリの保存先が一致しません。');
  {
    const result = await app.page.evaluate(async () => (globalThis as any).dot.listPosts());
    if (path.resolve(result.saveFolder) !== library) throw new Error('検証用アプリの接続先が一致しません。');
  }
  const host = 'com.dot.host.sandbox';
  process.env.DOT_CONFIG_DIR = configDir;
  process.env.DOT_NATIVE_HOST_NAME = host;
  const installer = require('../native-host/install.mts');
  let session: any;
  try {
    installer.install({ extensionId: 'keggmjkemfcekcffohnpaojacdakpejh' });
    const options = developmentOptions();
    session = await startDevelopmentBrowser(options);
    await session.configure(options.output);
    const tabId = await session.verify(url, host);
    console.log(`検証タブ: ${tabId}\n保存先: ${library}\n通常タブの保存先は変更していません。`);
    if (process.argv[3]) {
      const result = await session.run(process.argv[3], process.argv.slice(4));
      if (result !== undefined) console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('検証用 Chrome を保持しています。Ctrl+C で検証タブと Chrome を通常終了します。');
      await waitForInterrupt();
    }
  } finally {
    try {
      await session?.release();
    } finally {
      installer.uninstall();
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
