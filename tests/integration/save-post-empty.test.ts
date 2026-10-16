import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let handleSavePost: any;
let configDir: string;
let saveFolder: string;

const inboxNew = () => path.join(saveFolder, '.dot-inbox', 'new');
const envelopeExists = (base: string) => fs.existsSync(path.join(inboxNew(), `${base}.json`));
const journal = () => {
  try {
    return fs.readFileSync(path.join(configDir, 'Cache', 'bridge-journal.jsonl'), 'utf8');
  } catch {
    return '';
  }
};

beforeAll(async () => {
  configDir = process.env.DOT_CONFIG_DIR as string;
  saveFolder = path.join(configDir, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  ({ handleSavePost } = await import('../../native-host/bridge.mts'));
});

// 実際に踏んだ形（2026-07-26、x-bookmarks からの一括取込）。extractor は URL から
// screenName を、投稿 id からタイムスタンプを復元できる。だから API が何も返さなくても、
// この2つだけは埋まる。ここで守っているのは、これを「screenName があるから成功」と
// 読んではいけないという性質。
const emptyMeta = {
  url: 'https://x.com/super_moje/status/2069378728497746227',
  platform: 'x',
  screenName: 'super_moje',
  date: '2026-06-23T11:15:10.728Z',
  text: null,
  displayName: null,
  mediaType: null,
  media: [],
};

describe('何も取れなかった投稿', () => {
  test.each([
    ['1717500000000-e001', false, 'unavailable'],
    ['1717500000000-e002', undefined, undefined],
    ['1717500000000-e003', false, 'ageRestricted'],
  ])('URL と取得不足を残す（%s）', async (captureId, metaOk, metaReason) => {
    const metadata = { ...emptyMeta, url: emptyMeta.url + captureId.slice(-1) };
    const result = await handleSavePost({ captureId, metadata, metaOk, metaReason });
    expect(result).toMatchObject({ ok: true, captureId, mediaCount: 0, saveIncomplete: true });
    expect(envelopeExists(captureId)).toBe(true);
    const envelope = JSON.parse(fs.readFileSync(path.join(inboxNew(), captureId + '.json'), 'utf8'));
    expect(envelope.record).toMatchObject({ url: metadata.url, media: [], text: null, saveIncomplete: true });
  });

  test('URL 保存を投稿全体の取得完了として記録しない', () => {
    const entries = journal()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(entries.filter((entry) => entry.k.startsWith('x:2069378728497746227'))).toEqual(expect.arrayContaining([expect.objectContaining({ post: false })]));
  });
});

describe('中身のある投稿は通す', () => {
  test('テキストのみの投稿も通常の保存成功として扱う', async () => {
    const res = await handleSavePost({
      captureId: '1717500000000-e010',
      metadata: { url: 'https://x.com/u/status/10', platform: 'x', screenName: 'u', text: '本文だけの投稿', media: [] },
      metaOk: true,
    });

    expect(res).toMatchObject({ ok: true, mediaCount: 0 });
    expect(res).not.toHaveProperty('deferred');
    expect(envelopeExists('1717500000000-e010')).toBe(true);
  });

  test('メディアのある投稿は保存される', async () => {
    vi.stubGlobal('fetch', async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    try {
      const res = await handleSavePost({
        captureId: '1717500000000-e011',
        metadata: { url: 'https://x.com/u/status/11', platform: 'x', screenName: 'u', text: null, mediaType: 'image', media: [{ url: 'https://pbs.twimg.com/media/AAA.png' }] },
        metaOk: true,
      });

      expect(res).toMatchObject({ ok: true, mediaCount: 1 });
      expect(res).not.toHaveProperty('deferred');
      expect(envelopeExists('1717500000000-e011')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
