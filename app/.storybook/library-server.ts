import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import sharp from 'sharp';
import { assetSecurityHeaders } from '../src/main/asset-headers.ts';
import { mimeForFile } from '../src/main/lib-media-mime.ts';
import { parseAssetByteRange } from '../src/main/lib-http-range.ts';
import { readPreviewState } from './library-state.ts';
import { IMAGE_PROCESSING_LIMITS as limits } from '../src/main/image-processing-contract.ts';
import { createJobPool } from '../src/main/lib-job-pool.ts';

export const PREVIEW_PATH = '/__dot_preview__/';
type Library = Awaited<ReturnType<typeof readPreviewState>>;

// APNG は本番と同様に静止画へ変換せず、ブラウザへ元のアニメーションを渡す。
function isAnimatedPng(bytes: Buffer): boolean {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += length + 12;
  }
  return false;
}

async function preparePreviewImage(file: fs.FileHandle, size: number, mime: string, width?: number): Promise<{ bytes: Buffer; mime: string }> {
  if (size < 1 || size > limits.inputBytes) throw new Error('image-input-limit');
  const input = Buffer.allocUnsafe(size + 1);
  let count = 0;
  while (count < input.length) {
    const read = await file.read(input, count, input.length - count, count);
    if (!read.bytesRead) break;
    count += read.bytesRead;
  }
  if (count !== size) throw new Error('image-input-changed');
  const bytes = input.subarray(0, count);
  // BMPはsharpの入力対象ではない。ブラウザが復号できる原本を失わないよう維持する。
  if (mime === 'image/bmp' || isAnimatedPng(bytes)) return { bytes, mime };
  const image = sharp(bytes, { animated: true, autoOrient: true, limitInputPixels: limits.totalPixels, failOn: 'warning' }).timeout({ seconds: limits.timeoutSeconds });
  const metadata = await image.metadata();
  const frames = metadata.pages ?? 1;
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.pageHeight ?? metadata.height ?? 0;
  if (!sourceWidth || !sourceHeight || frames > limits.frames || sourceWidth * sourceHeight > limits.pixels || sourceWidth * sourceHeight * frames > limits.totalPixels || sourceWidth * sourceHeight * frames * 4 > limits.rawOutputBytes) throw new Error('image-pixel-limit');
  // sharp がアニメーションを扱えない形式を静止画に落とさない。
  if (frames > 1 && !['gif', 'webp'].includes(metadata.format ?? '')) return { bytes, mime };
  if (width) {
    // 本番のサムネイルと同じ短辺基準。極端な縦横比はWebPの長辺上限へ収める。
    const longEdge = Math.max(sourceWidth, sourceHeight);
    const shortEdge = Math.min(sourceWidth, sourceHeight);
    const maxEdge = 16_383;
    if (Math.ceil(longEdge * Math.min(1, width / shortEdge)) > maxEdge) image.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
    else image.resize({ width, height: width, fit: 'outside', withoutEnlargement: true });
  } else image.resize({ width: 16_383, height: 16_383, fit: 'inside', withoutEnlargement: true });
  // EXIFの向きは画素へ一度だけ適用し、メタデータは引き継がない。利用者の回転はUIのCSSが適用する。
  const chunks: Buffer[] = [];
  let outputSize = 0;
  for await (const chunk of image.toColourspace('srgb').webp()) {
    outputSize += chunk.length;
    if (outputSize > limits.outputBytes) throw new Error('image-output-limit');
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks, outputSize), mime: 'image/webp' };
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return !!relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

// 公開するのは GET/HEAD の参照のみ。IPC の名前や任意のパスは受け付けない。
export function createLibraryMiddleware(readState: typeof readPreviewState = readPreviewState) {
  let library: Library | undefined;
  const imagePool = createJobPool({ concurrency: 2 });
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    let opened: fs.FileHandle | undefined;
    const pathname = req.url?.split('?')[0] ?? '';
    if (!pathname.startsWith(PREVIEW_PATH)) return next();
    const finish = (status: number, message = '') => {
      res.statusCode = status;
      res.end(req.method === 'HEAD' ? undefined : message);
    };
    for (const [key, value] of Object.entries(assetSecurityHeaders())) res.setHeader(key, value);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const address = req.socket.localAddress;
    const origin = `http://127.0.0.1:${req.socket.localPort}`;
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(address ?? '') || req.headers.host !== new URL(origin).host) return finish(403);
    if ((req.headers.origin && req.headers.origin !== origin) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))) return finish(403);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return finish(405);
    }
    try {
      const url = new URL(req.url ?? '', origin);
      if (url.pathname === PREVIEW_PATH + 'state') {
        library = await readState();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return finish(200, JSON.stringify(library.state));
      }
      if (url.pathname !== PREVIEW_PATH + 'asset') return finish(404);
      if (!library) return finish(409);
      const widths = url.searchParams.getAll('w');
      const width = widths.length ? Number(widths[0]) : undefined;
      if (widths.length > 1 || (widths.length === 1 && (!/^[0-9]+$/.test(widths[0]) || !Number.isSafeInteger(width) || (width as number) < 1 || (width as number) > 720))) return finish(400);
      const name = url.searchParams.get('file') ?? '';
      if (!library.files.has(name) || name.includes('\0') || path.isAbsolute(name)) return finish(404);
      const root = await fs.realpath(library.libraryRoot);
      const candidate = path.resolve(root, name);
      if (!inside(root, candidate)) return finish(404);
      const real = await fs.realpath(candidate);
      if (!inside(root, real)) return finish(404);
      let mime = mimeForFile(real);
      if (!mime.startsWith('image/') && !mime.startsWith('video/')) return finish(415);
      const file = await fs.open(real, 'r');
      opened = file;
      const stat = await file.stat();
      if (!stat.isFile()) {
        await file.close();
        return finish(404);
      }
      let prepared: Buffer | undefined;
      if (mime.startsWith('image/') && (width !== undefined || mime === 'image/tiff')) {
        if (stat.size < 1 || stat.size > limits.inputBytes) return finish(413);
        if (imagePool.stats().queued >= 64) return finish(503);
        try {
          const result = await imagePool.run(() => preparePreviewImage(file, stat.size, mime, width));
          prepared = result.bytes;
          mime = result.mime;
        } catch {
          return finish(422);
        }
      }
      const size = prepared?.length ?? stat.size;
      const range = parseAssetByteRange(req.headers.range ?? null, size);
      if (range === 'unsatisfiable') {
        await file.close();
        res.setHeader('Content-Range', `bytes */${size}`);
        return finish(416);
      }
      res.setHeader('Content-Type', mime);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', range ? range.end - range.start + 1 : size);
      if (range) {
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      }
      if (req.method === 'HEAD') {
        await file.close();
        return res.end();
      }
      if (prepared) return res.end(range ? prepared.subarray(range.start, range.end + 1) : prepared);
      const stream = file.createReadStream(range ?? {});
      opened = undefined; // 以後はストリームがファイルを閉じる。
      res.on('close', () => stream.destroy());
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) finish(500, '実ライブラリを読み込めませんでした。保存先とデータベースを確認してください。');
      else res.destroy();
    } finally {
      await opened?.close().catch(() => {});
    }
  };
}

export function libraryPreviewPlugin(): Plugin {
  return {
    name: 'dot:readonly-library',
    apply: 'serve',
    configureServer(server) {
      const middleware = createLibraryMiddleware();
      server.middlewares.use((req, res, next) => {
        void middleware(req, res, next);
      });
    },
  };
}
