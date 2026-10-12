import { afterEach, expect, test, vi } from 'vitest';
import { extractorFor, fetchPostMetadata } from './index.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test.each(['https://x.com/author/status/20', 'https://www.pixiv.net/artworks/12345', 'https://bsky.app/profile/did:plc:abc/post/rk'])('通信失敗でもURLを再取得可能な形で返す: %s', async (url) => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Network unavailable');
  });
  const result = await fetchPostMetadata(url, {});
  expect(result.url).toBe(url);
  expect(result.text).toBeNull();
  expect(result.media).toEqual([]);
  expect(result.acquisitionIssues).toContainEqual({ scope: 'post', reason: 'fetchFailed' });
});

test('抽出処理の予期しない例外でもURLと取得失敗を残す', async () => {
  const extractor = extractorFor('x');
  if (!extractor) throw new Error('Missing X extractor');
  vi.spyOn(extractor, 'fetchPost').mockRejectedValue(new Error('Unexpected extraction error'));
  const result = await fetchPostMetadata('https://x.com/author/status/20', {});
  expect(result.url).toBe('https://x.com/author/status/20');
  expect(result.acquisitionIssues).toEqual([{ scope: 'post', reason: 'fetchFailed' }]);
});
