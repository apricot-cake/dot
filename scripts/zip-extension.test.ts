import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { expect, test } from 'vitest';

const { packageExtension } = require('./zip-extension.cts');

test('ストア ZIP だけから開発用の公開鍵を除き、元ビルドと他の内容は保持する', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-store-zip-'));
  try {
    const output = path.join(directory, 'extension');
    fs.mkdirSync(path.join(output, 'icons'), { recursive: true });
    const manifest = { manifest_version: 3, name: 'dot', version: '0.1.0', key: 'development-public-key', permissions: ['nativeMessaging'] };
    const original = JSON.stringify(manifest);
    fs.writeFileSync(path.join(output, 'manifest.json'), original);
    const asset = Buffer.from([0, 1, 127, 255]);
    fs.writeFileSync(path.join(output, 'icons', 'icon128.png'), asset);
    const destination = path.join(directory, 'dot.zip');

    await packageExtension(output, destination);

    const zip = await JSZip.loadAsync(fs.readFileSync(destination));
    const packaged = JSON.parse(await zip.file('manifest.json')!.async('string'));
    const { key: _key, ...expected } = manifest;
    expect(packaged).toEqual(expected);
    expect(await zip.file('icons/icon128.png')!.async('nodebuffer')).toEqual(asset);
    expect(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8')).toBe(original);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
