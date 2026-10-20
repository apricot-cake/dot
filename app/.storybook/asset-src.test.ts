import { afterEach, expect, test, vi } from 'vitest';
import { fileOfSrc, fileSrc } from './asset-src.ts';

afterEach(() => vi.unstubAllGlobals());

test('ファイル名をエスケープし、サムネイル幅を保持して逆変換する', () => {
  vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:6006/iframe.html', origin: 'http://127.0.0.1:6006' } });
  const src = fileSrc('items/日本語&名前.png', 320);
  expect(src).toBe('/__dot_preview__/asset?file=items%2F%E6%97%A5%E6%9C%AC%E8%AA%9E%26%E5%90%8D%E5%89%8D.png&w=320');
  expect(fileOfSrc(src)).toBe('items/日本語&名前.png');
  expect(fileSrc('')).toBe('');
  expect(fileSrc('post.jpg')).toBe('/__dot_preview__/asset?file=post.jpg');
  expect(fileOfSrc('https://example.com/__dot_preview__/asset?file=private.png')).toBe('');
});
