// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ContentSite } from './extractor/types.ts';
import x from './extractor/x.ts';
import { startBulkCapture } from './bulk-capture.ts';

const mocks = vi.hoisted(() => ({ notice: vi.fn(), log: vi.fn() }));
vi.mock('./capture-log.ts', () => ({ newSaveId: () => 'save-id', logSaveEvent: mocks.log, reportSaveTimeout: vi.fn() }));
vi.mock('./extension-context.ts', () => ({ extensionAlive: () => true, noteExtensionGone: vi.fn(), onExtensionGone: vi.fn() }));
vi.mock('./status-surface.ts', () => ({
  StatusSurface: class {
    el = document.createElement('div');
    label = document.createElement('span');
    setState() {}
    slot() {}
    mount() {}
    enter() {}
    remove() {}
    exit() {}
  },
}));
vi.mock('./save-toasts.ts', () => ({
  SAVE_TOAST_DURATION_MS: 100,
  SaveToasts: class {
    notice = mocks.notice;
    begin() {}
    end() {}
  },
}));

const post = (id: string, text: string) =>
  '<article data-testid="tweet"><div data-testid="User-Name"><a href="https://x.com/alice">Alice</a><a href="https://x.com/alice">@alice</a></div><div data-testid="tweetText">' +
  text +
  '</div><a href="https://x.com/alice/status/' +
  id +
  '"><time datetime="2026-10-12T00:00:00Z"></time></a><a href="https://x.com/alice/status/' +
  id +
  '/photo/1"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/' +
  id +
  '.jpg"></div></a></article>';
let sent: any[];
let answer: (value: any) => void;
const site: ContentSite = { ...x.content!, isBulkCapturePage: () => true, bulkAtBottom: () => false };
const i18n = { getMessage: (key: string) => key, saveFailureText: () => 'failure' } as any;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-12T00:00:00Z'));
  history.replaceState(null, '', '/i/history');
  document.body.innerHTML = post('123', '表示済み本文');
  sent = [];
  mocks.notice.mockClear();
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: (message: any, callback: any) => {
        sent.push(message);
        if (message.type === 'checkSaved') answer = callback;
        else if (message.type === 'savePost') callback({ ok: true, captureId: 'partial-id', metaOk: false, savedContent: { url: true, text: false, profile: false, media: 0 } });
      },
    },
  });
});
afterEach(() => {
  window.__snsPostSaveCleanup?.();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('収集後に仮想リストが別投稿へ再利用されても、元の本文と画像を保存へ渡す', async () => {
  startBulkCapture(site, i18n);
  document.body.innerHTML = post('999', '別投稿の本文');
  answer({ ok: true, results: {} });
  await vi.advanceTimersByTimeAsync(0);
  const save = sent.find((message) => message.type === 'savePost');
  expect(save.postUrl).toBe('https://x.com/alice/status/123');
  expect(save.domMeta.text).toBe('表示済み本文');
  expect(save.domMeta.snapshot.media[0].url).toBe('https://pbs.twimg.com/media/123.jpg?name=orig');
  expect(save.domMeta.snapshot.url).toBe(save.postUrl);
  expect(save).not.toHaveProperty('mediaKeys');
  const retry = mocks.notice.mock.calls.find((call) => typeof call[3] === 'function')![3];
  retry();
  expect(sent.filter((message) => message.type === 'savePost')[1]).toMatchObject({ postUrl: save.postUrl, domMeta: save.domMeta, retryOf: 'partial-id' });
});

test('解決したURLとsnapshotの投稿が異なる場合はDOM情報を送らない', async () => {
  startBulkCapture({ ...site, getPermalink: () => 'https://x.com/bob/status/456' }, i18n);
  answer({ ok: true, results: {} });
  await vi.advanceTimersByTimeAsync(0);
  expect(sent.find((message) => message.type === 'savePost').domMeta).toBeNull();
});
