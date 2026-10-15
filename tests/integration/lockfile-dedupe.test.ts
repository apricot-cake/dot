// electron-vite が app と同じ Vite を使うことを、実際の解決先で検証する。
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from 'vitest';

test('アプリと electron-vite が同じ Vite を解決する', () => {
  const appRequire = createRequire(path.join(import.meta.dirname, '../../app/package.json'));
  const builderRequire = createRequire(appRequire.resolve('electron-vite/package.json'));
  expect(builderRequire.resolve('vite')).toBe(appRequire.resolve('vite'));
});
