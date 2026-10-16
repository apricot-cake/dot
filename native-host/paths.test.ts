import path from 'node:path';
import { expect, test } from 'vitest';
import { resolveAppStoragePaths } from './paths.mts';

const home = path.resolve('profile');
const env = { APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local'), TEMP: path.join(home, 'Temporary') };
const packageData = { familyName: 'Example.Package_identity', localState: path.join(home, 'os-local'), localCache: path.join(home, 'os-cache'), tempState: path.join(home, 'os-temp') };

test('Package Identity がない実行は設定とセッション・ログを分ける', () => {
  expect(resolveAppStoragePaths({ env, home, packageData: null })).toEqual({
    config: path.join(env.APPDATA, 'dot-Workspace'),
    cache: path.join(env.LOCALAPPDATA, 'dot-Workspace', 'Cache'),
    session: path.join(env.LOCALAPPDATA, 'dot-Workspace', 'Session'),
    logs: path.join(env.LOCALAPPDATA, 'dot-Workspace', 'Logs'),
    temporaryRoot: env.TEMP,
    packaged: false,
  });
});

test('MSIX のパスは OS の各戻り値を使い、PFN から組み立てない', () => {
  expect(resolveAppStoragePaths({ env, home, packageData })).toEqual({ config: packageData.localState, cache: packageData.localCache, session: path.join(packageData.localState, 'Session'), logs: path.join(packageData.localCache, 'Logs'), temporaryRoot: packageData.tempState, packaged: true });
});

test('明示隔離は Package Identity より優先し、すべての実行時データを隔離する', () => {
  const isolated = path.join(home, 'sandbox');
  const paths = resolveAppStoragePaths({ env: { ...env, DOT_CONFIG_DIR: isolated }, home, packageData });
  expect(paths).toEqual({ config: isolated, cache: path.join(isolated, 'Cache'), session: path.join(isolated, 'Session'), logs: path.join(isolated, 'Logs'), temporaryRoot: path.join(isolated, 'Temp'), packaged: false });
});
