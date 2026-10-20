import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer, get } from 'node:http';
import { afterEach, expect, test, vi } from 'vitest';
import sharp from 'sharp';
import { createLibraryMiddleware } from './library-server.ts';
import type { readPreviewState } from './library-state.ts';
import { IMAGE_PROCESSING_LIMITS as limits } from '../src/main/image-processing-contract.ts';

const cleanups: Array<() => Promise<unknown>> = [];
function rawStatus(url: string, headers: Record<string, string>): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get(url, { headers }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dot-preview-server-'));
  const root = path.join(directory, 'library');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'post.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(path.join(root, 'dot.db'), 'private database');
  await fs.writeFile(path.join(directory, 'outside.png'), 'outside library');
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  const data = { state: { marker: 'actual-state' }, libraryRoot: root, files: new Set(['post.png', 'dot.db', '../outside.png', 'link.png']) } as unknown as Awaited<ReturnType<typeof readPreviewState>>;
  const middleware = createLibraryMiddleware(async () => data);
  const server = createServer((req, res) => {
    void middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('テスト用サーバーを起動できません。');
  const base = `http://127.0.0.1:${address.port}/__dot_preview__/`;
  return { base, root, directory, files: data.files };
}

test('参照だけを受け付け、DB や未登録ファイルを配信しない', async () => {
  const { base } = await fixture();
  const state = await fetch(base + 'state');
  expect(await state.json()).toEqual({ marker: 'actual-state' });
  expect(state.headers.get('cache-control')).toBe('no-store');
  expect(state.headers.get('access-control-allow-origin')).toBeNull();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect((await fetch(base + 'state', { method })).status).toBe(405);
  expect((await fetch(base + 'asset?file=dot.db')).status).toBe(415);
  expect((await fetch(base + 'asset?file=unlisted.png')).status).toBe(404);
  expect((await fetch(base + 'asset?file=..%2Foutside.png')).status).toBe(404);
});

test('別オリジンと不正な Host を拒否し、正当なメディアの Range/HEAD を返す', async () => {
  const { base } = await fixture();
  expect((await fetch(base + 'state', { headers: { Origin: 'https://example.com' } })).status).toBe(403);
  expect(await rawStatus(base + 'state', { Host: 'example.com' })).toBe(403);
  expect(await rawStatus(base + 'state', { 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
  await fetch(base + 'state');
  const range = await fetch(base + 'asset?file=post.png', { headers: { Range: 'bytes=1-2' } });
  expect(range.status).toBe(206);
  expect(range.headers.get('content-range')).toBe('bytes 1-2/4');
  expect([...new Uint8Array(await range.arrayBuffer())]).toEqual([0x50, 0x4e]);
  expect(range.headers.get('content-security-policy')).toContain("default-src 'none'");
  const head = await fetch(base + 'asset?file=post.png', { method: 'HEAD' });
  expect(head.headers.get('content-length')).toBe('4');
  expect(await head.text()).toBe('');
  expect((await fetch(base + 'asset?file=post.png', { headers: { Range: 'bytes=20-' } })).status).toBe(416);
});

test('登録された名前でも、ライブラリ外を指す symlink は配信しない', async () => {
  const { base, root, directory } = await fixture();
  await fs.symlink(path.join(directory, 'outside.png'), path.join(root, 'link.png'));
  await fetch(base + 'state');
  expect((await fetch(base + 'asset?file=link.png')).status).toBe(404);
});

test('TIFFをブラウザ表示用に変換し、短辺指定の縮小とRange/HEADを同じ出力へ適用する', async () => {
  const { base, root, files } = await fixture();
  const original = await sharp({ create: { width: 400, height: 200, channels: 3, background: 'red' } })
    .tiff()
    .toBuffer();
  await fs.writeFile(path.join(root, 'post.tiff'), original);
  files.add('post.tiff');
  await fetch(base + 'state');
  const names = await fs.readdir(root);
  const full = await fetch(base + 'asset?file=post.tiff');
  expect(full.headers.get('content-type')).toBe('image/webp');
  expect(await sharp(Buffer.from(await full.arrayBuffer())).metadata()).toMatchObject({ width: 400, height: 200 });
  const thumbnail = await fetch(base + 'asset?file=post.tiff&w=80');
  const output = Buffer.from(await thumbnail.arrayBuffer());
  expect(await sharp(output).metadata()).toMatchObject({ format: 'webp', width: 160, height: 80 });
  const range = await fetch(base + 'asset?file=post.tiff&w=80', { headers: { Range: 'bytes=2-8' } });
  expect(range.status).toBe(206);
  expect(range.headers.get('content-range')).toBe(`bytes 2-8/${output.length}`);
  expect(Buffer.from(await range.arrayBuffer())).toEqual(output.subarray(2, 9));
  const head = await fetch(base + 'asset?file=post.tiff&w=80', { method: 'HEAD' });
  expect(head.headers.get('content-type')).toBe('image/webp');
  expect(head.headers.get('content-length')).toBe(String(output.length));
  expect(await head.text()).toBe('');
  expect((await fetch(base + 'asset?file=post.tiff&w=80', { headers: { Range: `bytes=${output.length}-` } })).status).toBe(416);
  expect(await fs.readFile(path.join(root, 'post.tiff'))).toEqual(original);
  expect(await fs.readdir(root)).toEqual(names);
});

test('EXIFの向きを一度だけ画素へ適用し、再度向きを適用するメタデータを残さない', async () => {
  const { base, root, files } = await fixture();
  const original = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'blue' } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  await fs.writeFile(path.join(root, 'oriented.jpg'), original);
  files.add('oriented.jpg');
  await fetch(base + 'state');
  const thumbnail = await fetch(base + 'asset?file=oriented.jpg&w=20');
  const output = Buffer.from(await thumbnail.arrayBuffer());
  const metadata = await sharp(output).metadata();
  expect(metadata).toMatchObject({ width: 20, height: 40 });
  expect(metadata.orientation).toBeUndefined();
  const second = await sharp(output).autoOrient().toBuffer();
  expect(await sharp(second).metadata()).toMatchObject({ width: 20, height: 40 });
  expect(await fs.readFile(path.join(root, 'oriented.jpg'))).toEqual(original);
});

test('GIFのサムネイルもフレーム数、時間、ループを保つ', async () => {
  const { base, root, files } = await fixture();
  const pixels = Buffer.alloc(40 * 80 * 3);
  for (let index = 0; index < pixels.length; index += 3) pixels[index + (index < pixels.length / 2 ? 0 : 2)] = 255;
  const original = await sharp(pixels, { raw: { width: 40, height: 80, pageHeight: 40, channels: 3 } })
    .gif({ delay: [100, 200], loop: 2 })
    .toBuffer();
  await fs.writeFile(path.join(root, 'animated.gif'), original);
  files.add('animated.gif');
  await fetch(base + 'state');
  const response = await fetch(base + 'asset?file=animated.gif&w=20');
  const output = Buffer.from(await response.arrayBuffer());
  expect(response.status).toBe(200);
  expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ format: 'webp', width: 20, pageHeight: 20, pages: 2, delay: [100, 200], loop: 2 });
});

test('不正な幅、過大な入力と画素数、壊れた画像を拒否する', async () => {
  const { base, root, files } = await fixture();
  await fetch(base + 'state');
  for (const query of ['w=', 'w=0', 'w=-1', 'w=1.5', 'w=721', 'w=Infinity', 'w=1&w=2']) expect((await fetch(base + 'asset?file=post.png&' + query)).status).toBe(400);
  expect((await fetch(base + 'asset?file=post.png&w=10')).status).toBe(422);
  await fs.writeFile(path.join(root, 'huge.tiff'), '');
  await fs.truncate(path.join(root, 'huge.tiff'), limits.inputBytes + 1);
  files.add('huge.tiff');
  expect((await fetch(base + 'asset?file=huge.tiff')).status).toBe(413);
  await fs.writeFile(path.join(root, 'huge.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="7000" height="7000"></svg>');
  files.add('huge.svg');
  expect((await fetch(base + 'asset?file=huge.svg&w=20')).status).toBe(422);
});

test('動画は幅指定があっても原本のRange/HEADを維持する', async () => {
  const { base, root, files } = await fixture();
  await fs.writeFile(path.join(root, 'post.mp4'), Buffer.from([1, 2, 3, 4]));
  files.add('post.mp4');
  await fetch(base + 'state');
  const response = await fetch(base + 'asset?file=post.mp4&w=20', { headers: { Range: 'bytes=1-2' } });
  expect(response.status).toBe(206);
  expect(response.headers.get('content-type')).toBe('video/mp4');
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3]);
  const head = await fetch(base + 'asset?file=post.mp4', { method: 'HEAD' });
  expect(head.headers.get('content-length')).toBe('4');
  expect(await head.text()).toBe('');
});

test('同時画像変換は2件までに制限し、待機数の上限で拒否する', async () => {
  const { base, root, files } = await fixture();
  const original = await sharp({ create: { width: 40, height: 40, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(root, 'real.png'), original);
  files.add('real.png');
  await fetch(base + 'state');
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const metadata = sharp.prototype.metadata;
  const spy = vi.spyOn(sharp.prototype, 'metadata').mockImplementation(async function (this: sharp.Sharp) {
    await blocked;
    return metadata.call(this);
  });
  const requests = Array.from({ length: 70 }, () => fetch(base + 'asset?file=real.png&w=20'));
  try {
    expect((await Promise.race(requests)).status).toBe(503);
    expect(spy).toHaveBeenCalledTimes(2);
  } finally {
    release();
    await Promise.all(requests).then((responses) => Promise.all(responses.map((response) => response.arrayBuffer())));
    spy.mockRestore();
  }
});
