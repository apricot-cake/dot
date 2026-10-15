const fs = require('node:fs');
const path = require('node:path');
const { resolveVerificationOutput } = require('./lib-verification-output.cts');
const { waitForInterrupt } = require('./lib-dev-browser.cts');

// 起動した所有セッションの中でのみ操作する。公開 endpoint へ再接続しない。
async function run(session: any, args: string[] = []) {
  const [cmd = 'hold', arg, qualityArg] = args;
  if (cmd === 'hold') {
    console.log('普段のライブラリを背面で検証しています。接続は所有 pipe のみです。Ctrl+C で通常終了します。');
    await waitForInterrupt();
  } else if (cmd === 'eval') {
    if (!arg) throw new Error('評価する式を指定してください。');
    const result = await session.send('Runtime.evaluate', { expression: `(async () => { return (${arg}); })()`, awaitPromise: true, returnByValue: true, timeout: 60000 });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    console.log(typeof result.result.value === 'string' ? result.result.value : JSON.stringify(result.result.value, null, 2));
    return result.result.value;
  } else if (cmd === 'shot') {
    const out = resolveVerificationOutput(arg, `cdp-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        session.send('Page.captureScreenshot', { format: 'jpeg', quality: qualityArg ? Number(qualityArg) : 80, captureBeyondViewport: false, fromSurface: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('背面での撮影がタイムアウトしました。')), 1500);
        }),
      ]);
      const bytes = Buffer.from(result.data || '', 'base64');
      if (bytes.length < 6000) throw new Error('背面での撮影結果が空白のため、保存しませんでした。');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, bytes);
      console.log('書き出し完了', out, bytes.length, 'bytes');
      return out;
    } finally {
      clearTimeout(timer);
    }
  } else if (cmd === 'run') {
    if (!arg) throw new Error('検証モジュールを指定してください。');
    const operation = require(path.resolve(arg));
    if (typeof operation.run !== 'function') throw new Error('検証モジュールは run(session, args) を export してください。');
    return operation.run(session, args.slice(2));
  } else throw new Error('使い方: pnpm run app:debug hold | eval <式> | shot [出力先] | run <モジュール>');
}

module.exports = { run };
if (require.main === module)
  require('./local-app.cts')
    .verify(process.argv.slice(2))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
