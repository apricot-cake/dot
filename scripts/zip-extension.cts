'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yazl = require('yazl');
const { buildExtension } = require('./build-extension.cts');

const ROOT = path.join(__dirname, '..');
async function packageExtension(output: string, destination: string): Promise<void> {
  const zip = new yazl.ZipFile();

  for (const entry of fs.readdirSync(output, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const relative = path.relative(output, absolute).replaceAll('\\', '/');
    if (relative === 'manifest.json') {
      // ストアは署名と正式 ID を管理する。開発用 ID を固定する公開鍵は
      // ZIP 内だけで除き、ローカルに読み込むビルドの manifest は変更しない。
      const manifest = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      delete manifest.key;
      zip.addBuffer(Buffer.from(JSON.stringify(manifest)), relative);
    } else {
      zip.addFile(absolute, relative);
    }
  }

  await new Promise<void>((resolve, reject) => {
    const target = fs.createWriteStream(destination);
    target.on('close', resolve);
    target.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(target);
    zip.end();
  });
}

if (require.main === module) {
  const { output } = buildExtension('chrome');
  const destination = path.join(ROOT, 'extension', '.output', 'dot-chrome-mv3.zip');
  packageExtension(output, destination)
    .then(() => console.log(`[dot] wrote verified Chrome ZIP: ${destination}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { packageExtension };
