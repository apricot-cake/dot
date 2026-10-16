import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const packageContext = vi.hoisted(() => ({ value: null as null | { familyName: string; localState: string; localCache: string; tempState: string } }));
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('../../native-host/windows-app-data.mts', () => ({ getWindowsPackageData: () => packageContext.value }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-host-install-'));
  vi.stubEnv('DOT_CONFIG_DIR', path.join(root, 'config'));
  vi.stubEnv('DOT_NATIVE_HOST_NAME', '');
  packageContext.value = null;
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (platform) Object.defineProperty(process, 'platform', platform);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

test('主作業ツリー・隔離検証・MSIX は別のホスト名を解決する', async () => {
  const { nativeHostName } = await import('../../native-host/host-environment.mts');
  expect(nativeHostName()).toBe('com.dot.host.sandbox');
  vi.stubEnv('DOT_CONFIG_DIR', '');
  expect(nativeHostName()).toBe('com.dot.host.workspace');
  packageContext.value = { familyName: 'dot_test', localState: root, localCache: root, tempState: root };
  expect(nativeHostName()).toBe('com.dot.host');
});

test('別環境の登録名への上書きと旧開発ホスト名を拒む', async () => {
  const { nativeHostName } = await import('../../native-host/host-environment.mts');
  vi.stubEnv('DOT_NATIVE_HOST_NAME', 'com.dot.host');
  expect(nativeHostName).toThrow('workspace or sandbox');
  vi.stubEnv('DOT_NATIVE_HOST_NAME', 'com.example.old');
  expect(nativeHostName).toThrow('workspace or sandbox');
  packageContext.value = { familyName: 'dot_test', localState: root, localCache: root, tempState: root };
  vi.stubEnv('DOT_NATIVE_HOST_NAME', 'com.dot.host.workspace');
  expect(nativeHostName).toThrow('MSIX cannot overwrite');
});

test('検証コマンドが明示的に所有しないsandbox登録は作らない', async () => {
  const installer = await import('../../native-host/install.mts');
  expect(installer.install({ extensionId: 'a'.repeat(32) }).preserved).toBe(true);
  expect(fs.existsSync(path.join(root, 'config'))).toBe(false);
  expect(execFileSync).not.toHaveBeenCalled();
});

test('workspace登録を隔離設定とリンクworktreeから上書きしない', async () => {
  const installer = await import('../../native-host/install.mts');
  const linked = path.join(root, 'linked');
  fs.mkdirSync(linked);
  fs.writeFileSync(path.join(linked, '.git'), 'gitdir: ../main/.git/worktrees/linked');
  expect(installer.shouldPreserveSharedRegistration({ exe: path.join(linked, 'app/electron.exe'), runAsNode: true, configDirOverride: '', hostName: 'com.dot.host.workspace' })).toBe(true);
  expect(installer.shouldPreserveSharedRegistration({ exe: process.execPath, runAsNode: false, configDirOverride: root, hostName: 'com.dot.host.workspace' })).toBe(true);
});

test('明示sandbox登録だけを作成・削除しランチャーへ隔離先を渡す', async () => {
  vi.stubEnv('DOT_NATIVE_HOST_NAME', 'com.dot.host.sandbox');
  const installer = await import('../../native-host/install.mts');
  const source = path.join(root, 'bridge.js');
  fs.writeFileSync(source, '// fixture');
  const copy = fs.copyFileSync.bind(fs);
  const exists = fs.existsSync.bind(fs);
  vi.spyOn(fs, 'existsSync').mockImplementation((file) => file === installer.BRIDGE_PATH || exists(file));
  vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to, flags) => copy(from === installer.BRIDGE_PATH ? source : from, to, flags));
  const installed = installer.install({ exe: process.execPath, extensionId: 'a'.repeat(32) });
  expect(installed.manifest).toBe(path.join(root, 'config/NativeMessaging/com.dot.host.sandbox.json'));
  expect(fs.readFileSync(installed.launcher, 'utf8')).toContain(`set "DOT_CONFIG_DIR=${path.join(root, 'config')}"`);
  expect(fs.readFileSync(installed.launcher, 'utf8')).toContain('set "NODE_PATH=');
  const key = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.dot.host.sandbox';
  expect(execFileSync).toHaveBeenCalledWith('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', installed.manifest, '/f'], { stdio: 'ignore' });
  installer.uninstall();
  expect(execFileSync).toHaveBeenCalledWith('reg', ['delete', key, '/f'], { stdio: 'ignore' });
  expect(fs.existsSync(installed.manifest)).toBe(false);
});

test('MSIXはLocalState manifestとAliasを使いブリッジやbatを複写しない', async () => {
  vi.stubEnv('DOT_CONFIG_DIR', '');
  packageContext.value = { familyName: 'dot_test', localState: path.join(root, 'LocalState'), localCache: path.join(root, 'LocalCache'), tempState: path.join(root, 'TempState') };
  const aliasPath = path.join(root, 'dot-native-host.exe');
  fs.writeFileSync(aliasPath, 'fixture');
  const installer = await import('../../native-host/install.mts');
  const copy = vi.spyOn(fs, 'copyFileSync');
  const installed = installer.install({ aliasPath, extensionId: 'a'.repeat(32) });
  expect(installed.manifest).toBe(path.join(root, 'LocalState/NativeMessaging/com.dot.host.json'));
  expect(JSON.parse(fs.readFileSync(installed.manifest, 'utf8')).path).toBe(aliasPath);
  expect(installer.windowsRegistryKeys()).toEqual(['HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.dot.host']);
  expect(copy).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(root, 'LocalState/dot-host.bat'))).toBe(false);
  installer.uninstall();
  expect(fs.existsSync(aliasPath)).toBe(true);
});

test('workspaceランチャーはブラウザ側の隔離設定を消して通常設定を解決する', async () => {
  vi.stubEnv('DOT_CONFIG_DIR', '');
  vi.stubEnv('APPDATA', path.join(root, 'Roaming'));
  vi.stubEnv('LOCALAPPDATA', path.join(root, 'Local'));
  const installer = await import('../../native-host/install.mts');
  const source = path.join(root, 'bridge.js');
  const pathsModule = path.resolve('native-host/paths.mts');
  fs.writeFileSync(source, `process.stdout.write(JSON.stringify({ override: process.env.DOT_CONFIG_DIR || null, config: require(${JSON.stringify(pathsModule)}).configDir() }));`);
  const copy = fs.copyFileSync.bind(fs);
  const exists = fs.existsSync.bind(fs);
  vi.spyOn(fs, 'existsSync').mockImplementation((file) => file === installer.BRIDGE_PATH || exists(file));
  vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to, flags) => copy(from === installer.BRIDGE_PATH ? source : from, to, flags));
  const installed = installer.install({ exe: process.execPath, extensionId: 'a'.repeat(32) });
  const { spawnSync } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const result = spawnSync('cmd.exe', ['/d', '/c', installed.launcher!], {
    env: { ...process.env, DOT_CONFIG_DIR: path.join(root, 'poisoned-browser-config') },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 10000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ override: null, config: path.join(root, 'Roaming', 'dot-Workspace') });
});
