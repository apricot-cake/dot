import { afterEach, describe, expect, test, vi } from 'vitest';
import { WORKSPACE_NATIVE_HOST_PROFILE, WORKSPACE_NATIVE_HOST, getNativeHost, nativeHostForProfile, RELEASE_NATIVE_HOST } from './native-host.ts';

const originalChrome = globalThis.chrome;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome });
});

describe('プロファイルごとの Native Host 選択', () => {
  test('Storeビルドの未設定プロファイルはMSIX hostを使う', () => {
    expect(nativeHostForProfile(undefined)).toBe(RELEASE_NATIVE_HOST);
    expect(nativeHostForProfile('unknown')).toBe(RELEASE_NATIVE_HOST);
  });

  test('workspace と明示したプロファイルは主作業ツリーの host を使う', () => {
    expect(nativeHostForProfile(WORKSPACE_NATIVE_HOST_PROFILE)).toBe(WORKSPACE_NATIVE_HOST);
  });

  test('接続時に chrome.storage.local のプロファイル設定を読む', async () => {
    const get = vi.fn((_key: string, callback: (stored: Record<string, unknown>) => void) => callback({ 'nativeHost.profile.v1': WORKSPACE_NATIVE_HOST_PROFILE }));
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { lastError: undefined }, storage: { local: { get } } },
    });

    await expect(getNativeHost()).resolves.toBe(WORKSPACE_NATIVE_HOST);
    expect(get).toHaveBeenCalledWith('nativeHost.profile.v1', expect.any(Function));
  });

  test('設定の読み取りに失敗した場合も日常用 host へ安全に倒す', async () => {
    const get = vi.fn((_key: string, callback: (stored: Record<string, unknown>) => void) => callback({}));
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { lastError: { message: 'unavailable' } }, storage: { local: { get } } },
    });

    await expect(getNativeHost()).resolves.toBe(RELEASE_NATIVE_HOST);
  });
});

test('ローカルビルドはプロファイル未設定でもworkspaceへ接続する', async () => {
  vi.stubGlobal('__NATIVE_HOST_DEFAULT__', 'workspace');
  vi.resetModules();
  const local = await import('./native-host.ts');
  expect(local.nativeHostForProfile(undefined)).toBe(local.WORKSPACE_NATIVE_HOST);
  vi.stubGlobal('chrome', { runtime: {}, storage: { local: { get: (_key: string, callback: (stored: object) => void) => callback({}) } } });
  await expect(local.getNativeHost()).resolves.toBe(local.WORKSPACE_NATIVE_HOST);
});
