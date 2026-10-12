// 隔離された設定やリンク worktree が通常の保存経路を上書きしないことを確かめる。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { DEFAULT_HOST_NAME, HOST_NAME, install, isLinkedWorktreeRuntime, shouldPreserveSharedRegistration, uninstall, updateAllowedOrigin, windowsRegistryKeys } from '../../native-host/install.mts';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

let root: string;
let mainExe: string;
let linkedExe: string;
let packagedExe: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-host-install-'));
  const main = path.join(root, 'main');
  const linked = path.join(root, 'linked');

  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.mkdirSync(linked, { recursive: true });
  fs.writeFileSync(path.join(linked, '.git'), 'gitdir: ../main/.git/worktrees/linked\n');

  mainExe = path.join(main, 'app', 'node_modules', 'electron', 'dist', 'electron.exe');
  linkedExe = path.join(linked, 'app', 'node_modules', 'electron', 'dist', 'electron.exe');
  packagedExe = path.join(root, 'installed', 'dot.exe');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('isLinkedWorktreeRuntime', () => {
  test('本体作業ツリーは使い捨てでない', () => {
    expect(isLinkedWorktreeRuntime(mainExe)).toBe(false);
  });

  test('リンク worktree は .git ファイルから判別できる', () => {
    expect(isLinkedWorktreeRuntime(linkedExe)).toBe(true);
  });

  test('Git の外にあるパッケージ版は使い捨てでない', () => {
    expect(isLinkedWorktreeRuntime(packagedExe)).toBe(false);
  });
});

describe('shouldPreserveSharedRegistration', () => {
  test('共有登録はリンク worktree の Electron から守られる', () => {
    expect(shouldPreserveSharedRegistration({ exe: linkedExe, runAsNode: true, configDirOverride: '' })).toBe(true);
  });

  test.each(['main', 'linked', 'packaged'] as const)('隔離した設定から標準ホストの登録を上書きしない: %s', (runtime) => {
    const exe = { main: mainExe, linked: linkedExe, packaged: packagedExe }[runtime];
    expect(shouldPreserveSharedRegistration({ exe, runAsNode: true, configDirOverride: path.join(root, 'sandbox'), hostName: DEFAULT_HOST_NAME })).toBe(true);
  });

  test('隔離した Node CLI からも標準ホストの登録を上書きしない', () => {
    expect(shouldPreserveSharedRegistration({ exe: linkedExe, runAsNode: false, configDirOverride: path.join(root, 'sandbox'), hostName: DEFAULT_HOST_NAME })).toBe(true);
  });

  test('別名の開発ホストは隔離した設定と worktree から登録できる', () => {
    expect(shouldPreserveSharedRegistration({ exe: linkedExe, runAsNode: true, configDirOverride: path.join(root, 'sandbox'), hostName: 'com.dot.dev' })).toBe(false);
  });

  test('素の Node CLI からの登録は従来どおり許す', () => {
    expect(shouldPreserveSharedRegistration({ exe: linkedExe, runAsNode: false, configDirOverride: '' })).toBe(false);
  });
});

describe('隔離した設定からの共有登録保護', () => {
  test('初回の隔離アプリ起動でも登録ファイルやレジストリを作らない', () => {
    const sandbox = path.join(root, 'unregistered-sandbox');
    vi.stubEnv('DOT_CONFIG_DIR', sandbox);
    expect(install({ exe: mainExe, runAsNode: true, extensionId: 'a'.repeat(32) }).preserved).toBe(true);
    expect(fs.existsSync(sandbox)).toBe(false);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('許可元の変更や削除も共有登録に触れない', () => {
    const sandbox = path.join(root, 'registered-sandbox');
    fs.mkdirSync(sandbox);
    const manifest = path.join(sandbox, `${HOST_NAME}.json`);
    const contents = JSON.stringify({ allowed_origins: [`chrome-extension://${'a'.repeat(32)}/`] });
    fs.writeFileSync(manifest, contents);
    vi.stubEnv('DOT_CONFIG_DIR', sandbox);
    expect(updateAllowedOrigin('b'.repeat(32)).preserved).toBe(true);
    uninstall();
    expect(fs.readFileSync(manifest, 'utf8')).toBe(contents);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('別名の開発ホストは隔離した設定へ登録し、同じ別名だけを削除する', async () => {
    const sandbox = path.join(root, 'custom-host-sandbox');
    vi.stubEnv('DOT_CONFIG_DIR', sandbox);
    vi.stubEnv('DOT_NATIVE_HOST_NAME', 'com.dot.dev');
    vi.resetModules();
    const custom = await import('../../native-host/install.mts');
    const registration = custom.install({ exe: process.execPath, extensionId: 'a'.repeat(32) });
    const key = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.dot.dev';
    expect(registration.manifest).toBe(path.join(sandbox, 'com.dot.dev.json'));
    expect(JSON.parse(fs.readFileSync(registration.manifest, 'utf8')).name).toBe('com.dot.dev');
    expect(fs.readFileSync(registration.launcher, 'utf8')).toContain(`set "DOT_CONFIG_DIR=${sandbox}"`);
    expect(execFileSync).toHaveBeenCalledWith('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', registration.manifest, '/f'], { stdio: 'ignore' });
    custom.uninstall();
    expect(execFileSync).toHaveBeenCalledWith('reg', ['delete', key, '/f'], { stdio: 'ignore' });
    expect(fs.existsSync(registration.manifest)).toBe(false);
    vi.resetModules();
  });
});

describe('Chrome の Native Messaging 登録先', () => {
  test('Windows は Chrome のレジストリキーだけを使う', () => {
    const keys = windowsRegistryKeys();
    expect(keys).toEqual([`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`]);
  });
});
