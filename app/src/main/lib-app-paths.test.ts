import fs from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const root = process.env.DOT_CONFIG_DIR!;
  return { config: root, cache: `${root}/Cache`, session: `${root}/Session`, logs: `${root}/Logs`, temporaryRoot: `${root}/Temp`, packaged: false };
});
vi.mock('./native-host', () => ({
  appStoragePaths: () => storage,
  temporaryDir: () => {
    fs.mkdirSync(storage.temporaryRoot, { recursive: true });
    return storage.temporaryRoot;
  },
}));
import { configureAppPaths } from './lib-app-paths';

test('初期化前に userData/sessionData/temp/crashDumps と disk cache を別の領域へ設定する', () => {
  const app = { setPath: vi.fn(), setAppLogsPath: vi.fn(), commandLine: { appendSwitch: vi.fn() } };
  configureAppPaths(app);
  expect(app.setPath.mock.calls).toEqual([
    ['userData', storage.config],
    ['sessionData', storage.session],
    ['temp', storage.temporaryRoot],
    ['crashDumps', path.join(storage.cache, 'CrashDumps')],
  ]);
  expect(app.setAppLogsPath).toHaveBeenCalledWith(storage.logs);
  expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('disk-cache-dir', path.join(storage.cache, 'Chromium'));
});
