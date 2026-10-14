// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://x.com/"}
import { expect, test } from 'vitest';
import { extractXDomMeta, getXPostLink } from './x.ts';
import { mergeDomMeta, readDomMeta } from './dom-meta.ts';
import { emptyRecord } from './record.ts';
import { acquisitionComplete } from '../acquisition-result.ts';

function snapshot({ text = '', extra = '', photo = true } = {}) {
  const post = document.createElement('article');
  post.innerHTML = `<div data-testid="User-Name"><a href="https://x.com/alice">Alice</a><a href="https://x.com/alice">@alice</a></div><a href="https://x.com/alice/status/123"><time datetime="2026-01-01T00:00:00Z"></time></a>${text ? `<div data-testid="tweetText">${text}</div>` : ''}${photo ? '<a href="https://x.com/alice/status/123/photo/1"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/test.jpg?name=small"></div></a>' : ''}${extra}`;
  return readDomMeta({ platform: 'x', getPermalink: () => '', extractDomMeta: extractXDomMeta }, post)!;
}

test.each(['embedUnavailable', 'protected', 'ageRestricted'])('%s: 本文のない画像投稿を原寸画像ごと補完する', (reason) => {
  const rec = emptyRecord('https://x.com/alice/status/123', 'x');
  rec.metaError = reason;
  const filled = mergeDomMeta(rec, snapshot());
  expect(rec.text).toBeNull();
  expect(rec.media[0]?.url).toBe('https://pbs.twimg.com/media/test.jpg?name=orig');
  expect(acquisitionComplete(rec, filled)).toBe(true);
});

test('本文だけの投稿にも画像を要求しない', () => {
  const rec = emptyRecord('https://x.com/alice/status/123', 'x');
  rec.metaError = 'embedUnavailable';
  expect(acquisitionComplete(rec, mergeDomMeta(rec, snapshot({ text: 'hello', photo: false })))).toBe(true);
});

test.each(['fetchFailed', 'invalidResponse', 'unavailable'])('%s を画面の値で成功にしない', (reason) => {
  const rec = emptyRecord('https://x.com/alice/status/123', 'x');
  rec.metaError = reason;
  expect(mergeDomMeta(rec, snapshot())).toEqual([]);
  expect(rec.media).toEqual([]);
});

test('動画のポスターだけでは動画保存成功にしない', () => {
  const rec = emptyRecord('https://x.com/alice/status/123', 'x');
  rec.metaError = 'embedUnavailable';
  const filled = mergeDomMeta(rec, snapshot({ text: 'video', photo: false, extra: '<div data-testid="videoPlayer"><video src="blob:example"></video></div>' }));
  expect(acquisitionComplete(rec, filled)).toBe(false);
  expect(rec.acquisitionIssues).toContainEqual({ scope: 'media', reason: 'unavailable' });
});

test('省略された本文を完全な投稿として扱わない', () => {
  const rec = emptyRecord('https://x.com/alice/status/123', 'x');
  rec.metaError = 'embedUnavailable';
  expect(acquisitionComplete(rec, mergeDomMeta(rec, snapshot({ text: '途中', extra: '<button data-testid="tweet-text-show-more-link">さらに表示</button>' })))).toBe(false);
});

test('引用画像を対象投稿の画像に混ぜない', () => {
  expect(snapshot({ extra: '<div role="link"><a href="https://x.com/bob/status/999/photo/1"><img src="https://pbs.twimg.com/media/quote.jpg"></a></div>' }).snapshot?.media).toHaveLength(1);
});

test('欠けた画像番号があれば全件取得済みと判定しない', () => {
  expect(snapshot({ extra: '<a href="https://x.com/alice/status/123/photo/3"><img src="https://pbs.twimg.com/media/third.jpg"></a>' }).snapshot?.mediaComplete).toBe(false);
});

test('別投稿の snapshot は本文も画像も補完しない', () => {
  const rec = emptyRecord('https://x.com/alice/status/456', 'x');
  rec.metaError = 'embedUnavailable';
  expect(mergeDomMeta(rec, snapshot({ text: '別投稿' }))).toEqual([]);
  expect(rec.text).toBeNull();
  expect(rec.media).toEqual([]);
});

test('引用先の日時リンクを対象投稿のURLとして選ばない', () => {
  const post = document.createElement('article');
  post.innerHTML = '<a href="https://x.com/alice/status/123/photo/1"></a><div role="link"><a href="https://x.com/bob/status/456"><time></time></a></div>';
  expect(getXPostLink(post)?.postId).toBe('123');
});

test('復元できていない引用カードを含む投稿は部分保存にする', () => {
  const rec = emptyRecord('https://x.com/alice/status/123', 'x');
  rec.metaError = 'embedUnavailable';
  const dom = snapshot({ extra: '<div data-testid="quoteTweet">引用投稿</div>' });
  expect(acquisitionComplete(rec, mergeDomMeta(rec, dom))).toBe(false);
});

test.each(['viewer', 'grid'])('%s: 投稿情報が描かれていなくても表示画像を部分保存する', (kind) => {
  window.history.replaceState({}, '', '/alice/status/123/photo/1');
  const unit = document.createElement(kind === 'viewer' ? 'div' : 'li');
  if (kind === 'viewer') unit.setAttribute('data-testid', 'swipe-to-dismiss');
  unit.innerHTML = '<a href="https://x.com/alice/status/123/photo/1"><img src="https://pbs.twimg.com/media/test.jpg?name=small"></a>';
  const rec = emptyRecord('https://x.com/alice/status/123', 'x');
  rec.metaError = 'embedUnavailable';
  const filled = mergeDomMeta(rec, extractXDomMeta(unit));
  expect(rec.media[0]?.url).toBe('https://pbs.twimg.com/media/test.jpg?name=orig');
  expect(acquisitionComplete(rec, filled)).toBe(false);
  expect(filled).not.toContain('post');
});

test('ビューアは同じ投稿IDのarticleだけから本文と作者を補完する', () => {
  window.history.replaceState({}, '', '/alice/status/123/photo/1');
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.innerHTML =
    '<article data-testid="tweet"><div data-testid="User-Name"><a>Alice</a><a>@alice</a></div><a href="https://x.com/alice/status/123"><time datetime="2026-01-01T00:00:00Z"></time></a><div data-testid="tweetText">target</div></article><article data-testid="tweet"><div data-testid="tweetText">reply</div><a href="https://x.com/bob/status/456"><time></time></a></article><div data-testid="swipe-to-dismiss"><img src="https://pbs.twimg.com/media/test.jpg"></div>';
  const rec = emptyRecord('https://x.com/alice/status/123', 'x');
  rec.metaError = 'embedUnavailable';
  mergeDomMeta(rec, extractXDomMeta(dialog.querySelector('[data-testid="swipe-to-dismiss"]')!));
  expect(rec.text).toBe('target');
  expect(rec.displayName).toBe('Alice');
  expect(rec.media).toHaveLength(1);
});

test.each(['avatar', 'video', 'http', 'foreign'])('ビューアの%sは投稿画像として補完しない', (kind) => {
  window.history.replaceState({}, '', '/alice/status/123/photo/1');
  const unit = document.createElement('div');
  unit.setAttribute('data-testid', 'swipe-to-dismiss');
  const src = { avatar: 'https://pbs.twimg.com/profile_images/avatar.jpg', video: 'https://pbs.twimg.com/ext_tw_video_thumb/poster.jpg', http: 'http://pbs.twimg.com/media/test.jpg', foreign: 'https://example.com/media/test.jpg' }[kind];
  unit.innerHTML = `<img src="${src}">`;
  expect(extractXDomMeta(unit).snapshot).toBeUndefined();
});

test('メディア一覧で異なる投稿IDが混ざった場合は画像を補完しない', () => {
  const unit = document.createElement('li');
  unit.innerHTML = '<a href="https://x.com/alice/status/123/photo/1"><img src="https://pbs.twimg.com/media/first.jpg"></a><a href="https://x.com/bob/status/456/photo/1"><img src="https://pbs.twimg.com/media/other.jpg"></a>';
  expect(extractXDomMeta(unit).snapshot).toBeUndefined();
});
