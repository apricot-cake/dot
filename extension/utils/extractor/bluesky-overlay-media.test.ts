// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import bluesky from './bluesky.ts';

const image = (id: string) => '<img id="' + id + '" src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:example/' + 'b'.repeat(59) + '@jpeg">';
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

test.each(['bob.test', 'alice.test'])('引用元が%sでも別の投稿IDの画像を親の一覧へ混ぜない', (author) => {
  document.body.innerHTML = '<div data-testid="feedItem-by-alice.test"><a href="https://bsky.app/profile/alice.test/post/own">日時</a>' + image('own') + '<div role="link"><a href="https://bsky.app/profile/' + author + '/post/quoted">引用日時</a>' + image('quote') + '</div></div>';
  const unit = document.body.firstElementChild!;
  expect(bluesky.mediaIdentity!.extractIdentity(document.getElementById('quote') as HTMLImageElement)?.postId).toBe('quoted');
  expect(bluesky.overlay!.mediaIn(unit).map((media) => media.id)).toEqual(['own']);
  expect(bluesky.mediaIdentity!.extractIdentity(document.getElementById('own') as HTMLImageElement)?.postId).toBe('own');
});

test('複数の親画像と親動画は維持し、引用画像だけの投稿では親の画像一覧を空にする', () => {
  document.body.innerHTML =
    '<div data-testid="postThreadItem-by-alice.test"><a href="https://bsky.app/profile/alice.test/post/own">日時</a><div id="media">' +
    image('one') +
    image('two') +
    '<video id="video" poster="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/video@jpeg"></video></div><div role="link"><a href="https://bsky.app/profile/bob.test/post/quoted">引用日時</a>' +
    image('quote') +
    '</div></div>';
  const unit = document.body.firstElementChild!;
  expect(bluesky.overlay!.mediaIn(unit).map((media) => media.id)).toEqual(['one', 'two', 'video']);
  document.getElementById('media')!.remove();
  expect(bluesky.overlay!.mediaIn(unit)).toEqual([]);
});
