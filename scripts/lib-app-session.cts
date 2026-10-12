const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { electronPath } = require('./lib-electron-path.cts');
const { waitFor } = require('./lib-wait.cts');

const appDir = path.resolve(__dirname, '../app');

function cleanDebugEnvironment(env = process.env) {
  const result = { ...env };
  const unsafeKeys = new Set(['REMOTE_DEBUGGING_PORT', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_CLI_ARGS', 'V8_INSPECTOR_PORT', 'V8_INSPECTOR_BRK_PORT']);
  for (const key of Object.keys(result)) if (unsafeKeys.has(key.toUpperCase())) delete result[key];
  return result;
}

async function stopPersonalApp(env: NodeJS.ProcessEnv, executable = electronPath()) {
  await waitFor(
    '普段のアプリの通常終了',
    async () => {
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(executable, [appDir, '--dot-quit'], { env, windowsHide: true, stdio: 'ignore' });
        child.once('error', reject);
        child.once('exit', resolve);
      });
      if (code !== 0 && code !== 3) throw new Error(`アプリの終了要求に失敗しました (${code})`);
      return code === 0;
    },
    { timeoutMs: 20_000, pollMs: 250 },
  );
}

// Electron の renderer CDP を Chromium の継承 pipe で所有する。
// _electron.launch は Node inspector と CDP の TCP ポートを開くため使わない。
async function openAppSession(options: any = {}, dependencies: any = {}) {
  const env = cleanDebugEnvironment(options.env);
  let server: any;
  let context: any;
  try {
    if (options.hmr) {
      const { resolveConfig } = require('electron-vite');
      const { createServer } = require('vite');
      const resolved = await resolveConfig({ root: appDir }, 'serve', 'development');
      server = await createServer({ ...resolved.config.renderer, root: path.resolve(appDir, resolved.config.renderer.root || 'src/renderer'), server: { ...resolved.config.renderer.server, host: '127.0.0.1', port: 0 } });
      await server.listen();
      env.ELECTRON_RENDERER_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
    }
    context = await (dependencies.chromium || chromium).launchPersistentContext('', {
      executablePath: dependencies.executable || electronPath(),
      ignoreDefaultArgs: true,
      args: [options.appPath || appDir, '--remote-debugging-pipe', '--dot-background'],
      env,
      headless: false,
      viewport: null,
      timeout: options.launchTimeoutMs ?? 30_000,
    });
    const page = context.pages()[0] || (await context.waitForEvent('page'));
    await page.waitForFunction(() => typeof (globalThis as any).dot?.listPosts === 'function');
    const cdp = await context.newCDPSession(page);
    let closed = false;
    return {
      page,
      send: (method: string, params: any = {}) => cdp.send(method, params),
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await context.close();
        } finally {
          await server?.close();
        }
      },
    };
  } catch (error) {
    try {
      await context?.close();
    } finally {
      await server?.close();
    }
    throw error;
  }
}

async function withAppSession(options: any, operation: (session: any) => Promise<any>) {
  const session = await openAppSession(options);
  try {
    return await operation(session);
  } finally {
    await session.close();
  }
}

module.exports = { cleanDebugEnvironment, stopPersonalApp, openAppSession, withAppSession };
