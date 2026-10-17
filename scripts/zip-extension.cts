'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const { buildExtension } = require('./build-extension.cts');

const ROOT = path.join(__dirname, '..');
async function packageExtension(output: string, destination: string): Promise<void> {
  const zip = new yazl.ZipFile();

  for (const entry of fs.readdirSync(output, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const relative = path.relative(output, absolute).replaceAll('\\', '/');
    if (!entry.isFile()) {
      // シンボリックリンクなどはストアの ZIP に入れられない。ビルド出力に
      // 想定外のものが混ざったと気づけるよう、黙って捨てずに警告する。
      console.warn(`[dot] skipped non-regular file: ${relative}`);
      continue;
    }
    if (relative === 'manifest.json') {
      // ストアは署名と正式 ID を管理する。開発用 ID を固定する公開鍵は
      // ZIP 内だけで除き、ローカルに読み込むビルドの manifest は変更しない。
      const manifest = JSON.parse(fs.readFileSync(absolute, 'utf8').replace(/^\uFEFF/, ''));
      delete manifest.key;
      zip.addBuffer(Buffer.from(JSON.stringify(manifest)), relative);
    } else {
      zip.addFile(absolute, relative);
    }
  }

  // 書き込みに失敗しても壊れた ZIP を残さないよう、同じディレクトリの
  // 一時ファイルへ書き切ってから置き換える。
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.tmp`);
  try {
    zip.end();
    await pipeline(zip.outputStream, fs.createWriteStream(temporary));
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

if (require.main === module) {
  const { output } = buildExtension('chrome');
  const destination = path.join(ROOT, 'extension', '.output', 'dot-chrome-mv3.zip');
  packageExtension(output, destination)
    .then(() => console.log(`[dot] wrote Chrome store ZIP from verified build (manifest key removed): ${destination}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { packageExtension };
