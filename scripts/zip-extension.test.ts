import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, expect, test } from 'vitest';

const { packageExtension } = require('./zip-extension.cts');

let directory: string;
let output: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-store-zip-'));
  output = path.join(directory, 'extension');
  fs.mkdirSync(output);
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function write(relative: string, content: string | Buffer): void {
  const file = path.join(output, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

async function packageAndLoad(): Promise<JSZip> {
  const destination = path.join(directory, 'dot.zip');
  await packageExtension(output, destination);
  return JSZip.loadAsync(fs.readFileSync(destination));
}

function fileEntries(zip: JSZip): string[] {
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
}

test('ストア ZIP だけから開発用の公開鍵を除き、元ビルドと他の内容は保持する', async () => {
  const manifest = { manifest_version: 3, name: 'dot', version: '0.1.0', key: 'development-public-key', permissions: ['nativeMessaging'] };
  const original = JSON.stringify(manifest);
  write('manifest.json', original);
  const asset = Buffer.from([0, 1, 127, 255]);
  write('icons/icon128.png', asset);

  const zip = await packageAndLoad();

  const packaged = JSON.parse(await zip.file('manifest.json')!.async('string'));
  const { key: _key, ...expected } = manifest;
  expect(packaged).toEqual(expected);
  expect(await zip.file('icons/icon128.png')!.async('nodebuffer')).toEqual(asset);
  expect(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8')).toBe(original);
});

test('ZIP のエントリは入力ディレクトリのファイルと過不足なく一致し、深い階層も / で区切る', async () => {
  write('manifest.json', JSON.stringify({ manifest_version: 3 }));
  write('background.js', 'self;');
  write('icons/icon16.png', Buffer.from([1]));
  write('_locales/en/messages.json', '{}');
  write('assets/chunks/deep/module.js', 'export {};');

  const zip = await packageAndLoad();

  expect(fileEntries(zip)).toEqual(['_locales/en/messages.json', 'assets/chunks/deep/module.js', 'background.js', 'icons/icon16.png', 'manifest.json']);
  expect(Object.keys(zip.files).every((name) => !name.includes('\\'))).toBe(true);
});

test('下位ディレクトリの manifest.json は書き換えない', async () => {
  write('manifest.json', JSON.stringify({ manifest_version: 3, key: 'development-public-key' }));
  const nested = '{ "key": "keep-me" }\n';
  write('_locales/en/manifest.json', nested);

  const zip = await packageAndLoad();

  expect(await zip.file('_locales/en/manifest.json')!.async('string')).toBe(nested);
});

test('key を持たない manifest はそのまま通す', async () => {
  const manifest = { manifest_version: 3, name: 'dot', version: '0.1.0' };
  write('manifest.json', JSON.stringify(manifest));

  const zip = await packageAndLoad();

  expect(JSON.parse(await zip.file('manifest.json')!.async('string'))).toEqual(manifest);
});

test('BOM 付きの manifest も読み、key を除く', async () => {
  write('manifest.json', `\uFEFF${JSON.stringify({ manifest_version: 3, key: 'development-public-key' })}`);

  const zip = await packageAndLoad();

  const text = await zip.file('manifest.json')!.async('string');
  expect(text.startsWith('\uFEFF')).toBe(false);
  expect(JSON.parse(text)).toEqual({ manifest_version: 3 });
});

test('出力先に書き込めないときは reject し、壊れた ZIP も一時ファイルも残さない', async () => {
  write('manifest.json', JSON.stringify({ manifest_version: 3 }));
  const parent = path.join(directory, 'out');
  fs.mkdirSync(parent);
  // 出力先と同名のディレクトリがあると、ZIP ファイルへ置き換えられない。
  const destination = path.join(parent, 'dot.zip');
  fs.mkdirSync(destination);

  await expect(packageExtension(output, destination)).rejects.toThrow();

  expect(fs.readdirSync(parent)).toEqual(['dot.zip']);
  expect(fs.statSync(destination).isDirectory()).toBe(true);
});

test('出力先のディレクトリが無いときは reject し、ファイルを作らない', async () => {
  write('manifest.json', JSON.stringify({ manifest_version: 3 }));
  const destination = path.join(directory, 'missing', 'dot.zip');

  await expect(packageExtension(output, destination)).rejects.toThrow();

  expect(fs.existsSync(path.dirname(destination))).toBe(false);
});
