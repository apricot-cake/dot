import fs from 'node:fs';
import path from 'node:path';
import { appStoragePaths, temporaryDir } from './native-host';

interface AppPaths {
  setPath(name: 'userData' | 'sessionData' | 'temp' | 'crashDumps', value: string): void;
  setAppLogsPath(value: string): void;
  commandLine: { appendSwitch(name: string, value: string): void };
}

// Electron の ready より前に呼ぶ。設定とセッションは永続、disk cache とログは再生成可能。
export function configureAppPaths(app: AppPaths): void {
  const paths = appStoragePaths();
  const diskCache = path.join(paths.cache, 'Chromium');
  const crashDumps = path.join(paths.cache, 'CrashDumps');
  for (const directory of [paths.config, paths.session, paths.logs, diskCache, crashDumps]) fs.mkdirSync(directory, { recursive: true });
  app.setPath('userData', paths.config);
  app.setPath('sessionData', paths.session);
  app.setAppLogsPath(paths.logs);
  app.setPath('temp', temporaryDir());
  app.setPath('crashDumps', crashDumps);
  app.commandLine.appendSwitch('disk-cache-dir', diskCache);
}
