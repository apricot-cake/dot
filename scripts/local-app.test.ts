import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';

test('通常起動は TCP を開かず隔離・debug 環境を除去する', async () => {
  const spawn = vi.fn((_executable: string, _args: string[], _options: any) => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
  const module = { exports: {} as any };
  const env = { PATH: 'normal', DOT_CONFIG_DIR: 'sandbox', REMOTE_DEBUGGING_PORT: '9222', NODE_OPTIONS: '--inspect' };
  const require = (name: string) => {
    if (name === 'node:fs') return { existsSync: () => true };
    if (name === 'node:path') return path;
    if (name === 'node:child_process') return { spawn };
    if (name === './lib-electron-path.cts') return { electronPath: () => 'electron.exe' };
    if (name === './lib-app-session.cts') return { cleanDebugEnvironment: () => ({ PATH: env.PATH, DOT_CONFIG_DIR: env.DOT_CONFIG_DIR }) };
    throw new Error(name);
  };
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, 'local-app.cts'), 'utf8')), { require, module, __dirname, process: { platform: 'win32', env } });
  await module.exports.main('launch');
  expect(spawn.mock.calls[0][1]).toEqual([path.resolve(__dirname, '../app'), '--dot-activate-existing']);
  expect(spawn.mock.calls[0][2].env).toEqual({ PATH: 'normal' });
});
