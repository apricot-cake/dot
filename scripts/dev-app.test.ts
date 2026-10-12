import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';

test('electron-vite が解釈する debug 環境変数を HMR 起動に渡さない', () => {
  const env = { PATH: 'normal', Electron_Cli_Args: '["--remote-debugging-port=9222"]', V8_INSPECTOR_PORT: '9229', V8_INSPECTOR_BRK_PORT: '9230' };
  const spawn = vi.fn((_executable: string, _args: string[], _options: any) => new EventEmitter());
  const { cleanDebugEnvironment } = require('./lib-app-session.cts');
  const requireFixture = Object.assign(
    (name: string) => {
      if (name === 'node:path') return path;
      if (name === 'node:child_process') return { spawn };
      if (name === './lib-app-session.cts') return { cleanDebugEnvironment: () => cleanDebugEnvironment(env) };
      throw new Error(name);
    },
    { resolve: () => 'electron-vite/package.json' },
  );
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, 'dev-app.cts'), 'utf8')), { require: requireFixture, __dirname, process: { execPath: 'node.exe' } });
  expect(spawn.mock.calls[0][2].env).toEqual({ PATH: 'normal', DOT_START_INACTIVE: '1' });
});
