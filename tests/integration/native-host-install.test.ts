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

function packageDistribution(raw: string | null): void {
  const metadataPath = path.join(path.dirname(process.execPath), 'resources', 'native-host', 'distribution.json');
  const read = fs.readFileSync.bind(fs);
  vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, options: any) => {
    if (file === metadataPath) {
      if (raw === null) throw new Error('ENOENT');
      return raw;
    }
    return read(file, options);
  }) as typeof fs.readFileSync);
}

function packagedFixture() {
  vi.stubEnv('DOT_CONFIG_DIR', '');
  packageContext.value = { familyName: 'dot_test', localState: path.join(root, 'LocalState'), localCache: path.join(root, 'LocalCache'), tempState: path.join(root, 'TempState') };
  const aliasPath = path.join(root, 'dot-native-host.exe');
  fs.writeFileSync(aliasPath, 'fixture');
  return aliasPath;
}
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
  packageDistribution(JSON.stringify({ schema: 1, channel: 'verification' }));
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
  const launcher = fs.readFileSync(installed.launcher!, 'utf8');
  expect(launcher).toContain('\r\nset "DOT_CONFIG_DIR="\r\n');
  expect(launcher).toContain('set "DOT_NATIVE_HOST_NAME=com.dot.host.workspace"');
  // process.platform は登録処理の検証用に win32 へ差し替えているため、実 OS の値で判定する。
  // 他の OS でも上の生成内容を検証し、bat の実行は Windows でのみ確認する。
  if (platform?.value !== 'win32') return;
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

test('Store初回はconfigなしでも同梱Chrome IDだけを許可し設定に複製しない', async () => {
  const aliasPath = packagedFixture();
  const bundledId = 'a'.repeat(32);
  packageDistribution(JSON.stringify({ schema: 1, channel: 'store', extensionId: bundledId }));
  const installer = await import('../../native-host/install.mts');
  expect(installer.readExtensionId()).toBe(bundledId);
  const result = installer.install({ aliasPath });
  expect(result.extensionId).toBe(bundledId);
  expect(JSON.parse(fs.readFileSync(result.manifest, 'utf8')).allowed_origins).toEqual([`chrome-extension://${bundledId}/`]);
  expect(fs.existsSync(path.join(root, 'LocalState/config.json'))).toBe(false);
});

test('Storeは既存config・install引数・更新引数より同梱IDを優先する', async () => {
  const aliasPath = packagedFixture();
  const bundledId = 'a'.repeat(32);
  const userId = 'b'.repeat(32);
  packageDistribution(JSON.stringify({ schema: 1, channel: 'store', extensionId: bundledId }));
  const configPath = path.join(root, 'LocalState/config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = JSON.stringify({ extensionId: userId, saveFolder: 'unchanged' });
  fs.writeFileSync(configPath, original);
  const installer = await import('../../native-host/install.mts');
  expect(installer.readExtensionId()).toBe(bundledId);
  const result = installer.install({ aliasPath, extensionId: userId });
  expect(result.extensionId).toBe(bundledId);
  for (const override of [userId, '', null]) {
    const updated = installer.updateAllowedOrigin(override);
    expect(updated.extensionId).toBe(bundledId);
    expect(JSON.parse(fs.readFileSync(result.manifest, 'utf8')).allowed_origins).toEqual([`chrome-extension://${bundledId}/`]);
  }
  expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
});

test.each([null, '{broken', JSON.stringify({ schema: 2, channel: 'store', extensionId: 'a'.repeat(32) }), JSON.stringify({ schema: 1, channel: 'store' }), JSON.stringify({ schema: 1, channel: 'store', extensionId: 'invalid' }), JSON.stringify({ schema: 1, channel: 'other' })])(
  'パッケージの配布情報欠損・破損を拒み許可先を変更しない: %s',
  async (raw) => {
    const aliasPath = packagedFixture();
    packageDistribution(raw);
    const installer = await import('../../native-host/install.mts');
    const manifest = installer.manifestPath();
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    const original = JSON.stringify({ allowed_origins: ['chrome-extension://' + 'b'.repeat(32) + '/'] });
    fs.writeFileSync(manifest, original);
    expect(() => installer.readExtensionId()).toThrow(/distribution|Store extension ID/);
    expect(() => installer.install({ aliasPath, extensionId: 'b'.repeat(32) })).toThrow();
    expect(() => installer.updateAllowedOrigin('b'.repeat(32))).toThrow();
    expect(fs.readFileSync(manifest, 'utf8')).toBe(original);
    expect(execFileSync).not.toHaveBeenCalled();
  },
);

test('verificationは同梱Store IDを使わず明示IDとconfig IDを使う', async () => {
  const aliasPath = packagedFixture();
  const explicitId = 'b'.repeat(32);
  packageDistribution(JSON.stringify({ schema: 1, channel: 'verification' }));
  const installer = await import('../../native-host/install.mts');
  expect(installer.readExtensionId()).toBe(null);
  const result = installer.install({ aliasPath, extensionId: explicitId });
  expect(result.extensionId).toBe(explicitId);
  expect(installer.readExtensionId()).toBe(explicitId);
  expect(installer.updateAllowedOrigin('c'.repeat(32)).extensionId).toBe('c'.repeat(32));
});

test.each(['workspace', 'sandbox'])('%sは配布情報を参照せずconfig IDを使う', async (mode) => {
  const config = mode === 'workspace' ? path.join(root, 'Roaming', 'dot-Workspace') : path.join(root, 'config');
  if (mode === 'workspace') {
    vi.stubEnv('DOT_CONFIG_DIR', '');
    vi.stubEnv('APPDATA', path.join(root, 'Roaming'));
  }
  packageDistribution(null);
  const installer = await import('../../native-host/install.mts');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({ extensionId: 'b'.repeat(32) }));
  expect(installer.readExtensionId()).toBe('b'.repeat(32));
  expect(fs.readFileSync).not.toHaveBeenCalledWith(path.join(path.dirname(process.execPath), 'resources', 'native-host', 'distribution.json'), 'utf8');
});
