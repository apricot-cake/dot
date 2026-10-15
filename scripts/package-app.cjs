'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { packager } = require('@electron/packager');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');
const forgeConfig = require(path.join(appDir, 'forge.config.cjs'));
const appPackage = require(path.join(appDir, 'package.json'));

async function packageApp() {
  // 開発用の依存を変更せず、配布に必要な依存だけを独立した木へ展開する。
  const stage = path.join(root, '.sandbox', `package-app-${randomUUID()}`);
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error('pnpm run app:package から実行してください');
  await fs.mkdir(path.dirname(stage), { recursive: true });
  try {
    execFileSync(pnpmCli, ['--filter', '@apricot-cake/dot', 'deploy', '--prod', stage], { cwd: root, stdio: 'inherit', windowsHide: true });
    const packageOptions = {
      ...forgeConfig.packagerConfig,
      dir: stage,
      out: forgeConfig.outDir,
      name: appPackage.productName || appPackage.name,
      executableName: 'dot',
      electronVersion: appPackage.devDependencies.electron,
      platform: 'win32',
      arch: 'x64',
      overwrite: true,
      prune: false,
      ignore: [/^\/(?!assets(?:\/|$)|node_modules(?:\/|$)|out(?:\/|$)|package\.json$).*/],
      afterComplete: [({ buildPath }) => fs.cp(path.join(appDir, 'third-party-licenses'), path.join(buildPath, 'resources', 'licenses'), { recursive: true })],
    };
    const outputs = await packager(packageOptions);
    for (const output of outputs) console.log(output);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

packageApp().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
