// 隔離された設定やリンク worktree が通常の保存経路を上書きしないことを確かめる。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_HOST_NAME, HOST_NAME, install, isLinkedWorktreeRuntime, shouldPreserveSharedRegistration, uninstall, updateAllowedOrigin, windowsRegistryKeys } from '../../native-host/install.mts';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

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
  Object.defineProperty(process, 'platform', platformDescriptor);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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
  beforeEach(() => {
    // 登録先は Windows のレジストリ。実行環境にかかわらず、この境界を模擬する。
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
  });

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
    // バンドルの内容はこの登録契約の対象外。生成済みの配布物に依存せず、
    // 一時フィクスチャを実際の配置先へコピーして登録・削除を検証する。
    const bridgeFixture = path.join(root, 'bridge-fixture.js');
    const bridgeSource = '// isolated native messaging bridge fixture\n';
    fs.writeFileSync(bridgeFixture, bridgeSource);
    const existsSync = fs.existsSync.bind(fs);
    const copyFileSync = fs.copyFileSync.bind(fs);
    vi.spyOn(fs, 'existsSync').mockImplementation((file) => (file === custom.BRIDGE_PATH ? true : existsSync(file)));
    vi.spyOn(fs, 'copyFileSync').mockImplementation((source, destination, mode) => copyFileSync(source === custom.BRIDGE_PATH ? bridgeFixture : source, destination, mode));
    const registration = custom.install({ exe: process.execPath, extensionId: 'a'.repeat(32) });
    const key = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.dot.dev';
    expect(registration.manifest).toBe(path.join(sandbox, 'com.dot.dev.json'));
    expect(JSON.parse(fs.readFileSync(registration.manifest, 'utf8')).name).toBe('com.dot.dev');
    expect(fs.readFileSync(path.join(sandbox, 'bridge.js'), 'utf8')).toBe(bridgeSource);
    expect(fs.readFileSync(registration.launcher, 'utf8')).toContain(`set "DOT_CONFIG_DIR=${sandbox}"`);
    expect(execFileSync).toHaveBeenCalledWith('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', registration.manifest, '/f'], { stdio: 'ignore' });
    custom.uninstall();
    expect(execFileSync).toHaveBeenCalledWith('reg', ['delete', key, '/f'], { stdio: 'ignore' });
    expect(fs.existsSync(registration.manifest)).toBe(false);
    expect(fs.existsSync(path.join(sandbox, 'bridge.js'))).toBe(false);
    vi.resetModules();
  });
});

describe('Chrome の Native Messaging 登録先', () => {
  test('Windows は Chrome のレジストリキーだけを使う', () => {
    const keys = windowsRegistryKeys();
    expect(keys).toEqual([`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`]);
  });
});

describe('対応していない実行環境', () => {
  test.each(['linux', 'darwin'])('登録と削除は Windows 以外で実行しない: %s', (platform) => {
    const sandbox = path.join(root, `unsupported-${platform}`);
    vi.stubEnv('DOT_CONFIG_DIR', sandbox);
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
    expect(() => install({ exe: mainExe, extensionId: 'a'.repeat(32) })).toThrow(`Unsupported platform: ${platform}`);
    expect(() => uninstall()).toThrow(`Unsupported platform: ${platform}`);
    expect(fs.existsSync(sandbox)).toBe(false);
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
