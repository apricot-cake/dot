import { expect, test, vi } from 'vitest';
const { cleanDebugEnvironment, openAppSession } = require('./lib-app-session.cts');
test('すべての起動で環境の TCP と Node inspector を除去する', () => {
  expect(cleanDebugEnvironment({ PATH: 'p', DOT_CONFIG_DIR: 'library', REMOTE_DEBUGGING_PORT: '0', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', Electron_Cli_Args: '["--remote-debugging-port=9222"]', v8_inspector_port: '9229', V8_INSPECTOR_BRK_PORT: '9230' })).toEqual({
    PATH: 'p',
    DOT_CONFIG_DIR: 'library',
  });
});
test('pipe 所有セッションの通常終了と二重終了を確認する', async () => {
  const close = vi.fn();
  const page = { waitForFunction: vi.fn().mockResolvedValue(undefined) };
  const context = { pages: () => [page], newCDPSession: vi.fn().mockResolvedValue({ send: vi.fn() }), close };
  const launchPersistentContext = vi.fn().mockResolvedValue(context);
  const session = await openAppSession({ env: { REMOTE_DEBUGGING_PORT: '9222' } }, { executable: 'electron.exe', chromium: { launchPersistentContext } });
  const options = launchPersistentContext.mock.calls[0][1];
  expect(options.args).toContain('--remote-debugging-pipe');
  expect(options.args.join(' ')).not.toMatch(/remote-debugging-port|inspect/);
  expect(options.env).not.toHaveProperty('REMOTE_DEBUGGING_PORT');
  await session.close();
  await session.close();
  expect(close).toHaveBeenCalledOnce();
});
test('renderer 準備失敗でも所有アプリを通常終了する', async () => {
  const close = vi.fn();
  const context = { pages: () => [{ waitForFunction: vi.fn().mockRejectedValue(new Error('not ready')) }], close };
  await expect(openAppSession({}, { executable: 'electron.exe', chromium: { launchPersistentContext: vi.fn().mockResolvedValue(context) } })).rejects.toThrow('not ready');
  expect(close).toHaveBeenCalledOnce();
});
