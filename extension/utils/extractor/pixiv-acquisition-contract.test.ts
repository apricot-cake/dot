import { afterEach, expect, test, vi } from 'vitest';
import { fetchPostMetadata } from './index.ts';

const body = {
  illustId: '12345',
  illustType: 0,
  pageCount: 1,
  width: 100,
  height: 80,
  urls: { original: 'https://i.pximg.net/12345_p0.jpg' },
  illustTitle: '作品',
  userId: '42',
  userName: '作者',
  illustComment: '本文',
  likeCount: 1,
  bookmarkCount: 2,
  viewCount: 3,
  commentCount: 0,
  tags: { tags: [{ tag: '作品' }] },
  createDate: '2026-10-01T00:00:00Z',
  uploadDate: '2026-10-01T00:00:00Z',
};
afterEach(() => vi.unstubAllGlobals());
function responses(post: unknown, profile: unknown = { imageBig: 'https://i.pximg.net/avatar.jpg', comment: '紹介', social: [] }) {
  const fetch = vi.fn(async (url: string) => Response.json({ error: false, body: String(url).includes('/ajax/user/') ? profile : post }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
test('補完しない正常な応答から本文・画像・プロフィールを取得する', async () => {
  responses(body);
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.text).toBe('本文');
  expect(result.media).toHaveLength(1);
  expect(result.bio).toBe('紹介');
  expect(result.acquisitionIssues).toEqual([]);
});
test.each(['likeCount', 'tags', 'seriesNavData'])('%s の型変化で正常な本文と画像を捨てない', async (field) => {
  responses({ ...body, [field]: '不正な型' });
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.text).toBe('本文');
  expect(result.media).toHaveLength(1);
  expect(result.acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
});
test('リンクの契約違反でも正常なアバターと紹介を取得する', async () => {
  responses(body, { imageBig: 'https://i.pximg.net/avatar.jpg', comment: '紹介', social: { account: 42 } });
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.avatar).toBe('https://i.pximg.net/avatar.jpg');
  expect(result.bio).toBe('紹介');
  expect(result.acquisitionIssues).toContainEqual({ scope: 'profile', reason: 'invalidResponse' });
});
test('投稿者の識別情報が不正でも作品URLと媒体を保持する', async () => {
  responses({ ...body, userId: 42 });
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.media).toHaveLength(1);
  expect(result.acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
});
test('日付・寸法・本文の一項目が不正でも独立した項目を保持する', async () => {
  responses({ ...body, createDate: 'invalid', uploadDate: '2026-10-02T00:00:00Z', width: -1, illustComment: 42, description: '代替本文', likeCount: -1 });
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.text).toBe('代替本文');
  expect(result.date).toBe('2026-10-02T00:00:00.000Z');
  expect(result.media[0]).toEqual(expect.objectContaining({ url: body.urls.original, width: null, height: 80 }));
  expect(result.likes).toBeNull();
  expect(result.bookmarks).toBe(2);
});
test('空の連携先名を除き、本文・画像・正常なプロフィールリンクを残す', async () => {
  responses(body, { social: { '': { url: 'https://example.com/invalid' }, website: { url: 'https://example.com/valid' } } });
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.text).toBe('本文');
  expect(result.media).toHaveLength(1);
  expect(result.profileLinks).toEqual([{ name: 'website', value: 'https://example.com/valid' }]);
});
test('未知の作品形式を静止画や複数ページとして扱わない', async () => {
  const fetch = responses({ ...body, illustType: 99, pageCount: 2 });
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.media).toEqual([]);
  expect(result.acquisitionIssues).toContainEqual({ scope: 'media', reason: 'unavailable' });
  expect(fetch.mock.calls.some(([url]) => url.includes('/pages'))).toBe(false);
});
