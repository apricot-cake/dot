import { expect, test } from 'vitest';
import { findLinkedPost, resolveLinkedPost } from './post-link.ts';
import { vi } from 'vitest';

test('個別保存と一括保存の投稿を区別する', () => {
  const url = 'https://x.com/a/status/123';
  const first = { url, saveScope: 'media', media: [{ url: 'https://pbs.twimg.com/media/1.jpg' }] };
  const second = { url, saveScope: 'media', media: [{ url: 'https://pbs.twimg.com/media/2.jpg' }] };
  const whole = { url, saveScope: 'post', media: [...first.media, ...second.media] };
  const posts = [first, second, whole];
  expect(findLinkedPost(posts, { url: 'https://twitter.com/b/status/123' })).toBe(whole);
  expect(findLinkedPost(posts, { url, mediaUrl: first.media[0].url })).toBe(first);
  expect(findLinkedPost(posts, { url, mediaUrl: second.media[0].url })).toBe(second);
  expect(findLinkedPost([whole], { url, mediaUrl: first.media[0].url })).toBeUndefined();
  expect(findLinkedPost([first], { url })).toBeUndefined();
});

test('バッジからの初回起動は読み込み済みの投稿を再取得しない', async () => {
  const target = { url: 'https://x.com/fixture/status/2100000000000000001', mediaUrl: 'https://pbs.twimg.com/media/image.jpg' };
  const post = { ...target, saveScope: 'media', media: [{ url: target.mediaUrl }] };
  const reload = vi.fn(async () => {});
  expect(await resolveLinkedPost(target, { posts: () => [post], reload }, false)).toBe(post);
  expect(reload).not.toHaveBeenCalled();
});

test('初回一覧にない保存と起動後のリンクは最新の一覧を取得する', async () => {
  const target = { url: 'https://x.com/fixture/status/2100000000000000001' };
  let posts: Array<{ url: string }> = [];
  const post = { url: target.url };
  const reload = vi.fn(async () => {
    posts = [post];
  });
  expect(await resolveLinkedPost(target, { posts: () => posts, reload }, false)).toBe(post);
  expect(reload).toHaveBeenCalledOnce();
  await resolveLinkedPost(target, { posts: () => posts, reload });
  expect(reload).toHaveBeenCalledTimes(2);
});
