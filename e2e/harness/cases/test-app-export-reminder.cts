'use strict';

// 手動エクスポートの通知を実アプリで確認する。
//
// - 指定件数に達すると設定アイコンとデータ項目にドットが現れる
// - 設定は通常の外観ページで開き、データは利用者が選ぶ
// - バックアップ案内と100件の既定値を表示し、通知をオフにすると両方のドットが消える

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-export-reminder-'));
const configDir = path.join(tmp, 'dot');
const saveFolder = path.join(tmp, 'library');
for (const dir of [configDir, saveFolder]) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(
  path.join(configDir, 'config.json'),
  JSON.stringify({
    saveFolder,
    extensionId: 'testextensionidabcdefghijklmnop',
    libraries: [
      {
        path: saveFolder,
        libraryId: null,
        lastOpenedAt: '2026-08-26T00:00:00.000Z',
        exportReminder: { enabled: true, threshold: 100, changesSinceExport: 100, lastExportAt: null },
      },
    ],
  }),
);
seedLibrary(configDir, []);

const evalJs = evalSource(async ({ waitFor }) => {
  const buttonByLabel = (label: string) => Array.from(document.querySelectorAll('button')).find((el) => el.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  const buttonByText = (text: string) => Array.from(document.querySelectorAll('button')).find((el) => el.textContent?.trim() === text) as HTMLButtonElement | undefined;
  const visible = (el: Element | null | undefined) => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const visibleHeading = (text: string) => Array.from(document.querySelectorAll('h2')).some((el) => el.textContent?.trim() === text && visible(el));
  const railDotReady = await waitFor('設定アイコンの通知ドットが現れる', () => !!document.querySelector('[data-slot="settings-notification"]'));
  buttonByLabel('設定')?.click();

  const normalSettingsReady = await waitFor('設定は通常の外観ページで開く', () => visibleHeading('外観') && !visibleHeading('データ'));
  const dataDot = document.querySelector('[data-slot="settings-data-notification"]');
  const dataDotShown = visible(dataDot);
  const dotRetainedOnOpen = !!document.querySelector('[data-slot="settings-notification"]');
  (dataDot?.closest('button') as HTMLButtonElement | null)?.click();

  const dataReady = await waitFor('利用者が選んだデータページが開く', () => visibleHeading('データ') && visible(document.querySelector('[data-slot="backup-reminder"]')));
  const notice = document.querySelector('[data-slot="backup-reminder"]');
  const countShown = notice?.textContent?.includes('前回のエクスポート後に、投稿を100件保存しました。') === true;
  const createShown = visible(buttonByText('バックアップを作成'));
  const dismissHintShown = notice?.textContent?.includes('バックアップを作成するとドットが消えます。お知らせが不要な場合は通知をオフにできます。') === true;
  const disableButtonShown = visible(buttonByText('通知をオフにする'));
  const reminderToggle = document.querySelector('#export-reminder')?.closest('[data-slot="setting-row"]')?.querySelector('[role="switch"]') as HTMLElement | null;
  const enabled = reminderToggle?.getAttribute('aria-checked') === 'true';
  const thresholdText = document.querySelector('#export-reminder-threshold [data-slot="select-value"]')?.textContent?.trim() || '';
  const hintShown = document.body.textContent?.includes('前回のエクスポート後に保存した投稿が指定した件数に達したら、設定アイコンのドットで知らせます。') === true;

  reminderToggle?.click();
  const disabledAndDotsCleared = await waitFor(
    '通知オフでSwitchと設定・データのドットが消える',
    () => reminderToggle?.getAttribute('aria-checked') === 'false' && !document.querySelector('[data-slot="settings-notification"]') && !document.querySelector('[data-slot="settings-data-notification"]') && !document.querySelector('[data-slot="backup-reminder"]'),
  );
  const thresholdDisabled = document.querySelector('#export-reminder-threshold')?.hasAttribute('disabled') === true;
  return { railDotReady, normalSettingsReady, dataDotShown, dotRetainedOnOpen, dataReady, countShown, createShown, dismissHintShown, disableButtonShown, enabled, thresholdText, hintShown, disabledAndDotsCleared, thresholdDisabled };
});

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  DOT_CONFIG_DIR: configDir,
  DOT_SMOKE: '1',
  DOT_SANDBOX: '1',
  DOT_LANG: 'ja',
  DOT_SMOKE_EVAL: evalJs,
});
const child = spawn(resolveElectron(), ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'], windowsHide: true });
let out = '';
child.stdout.on('data', (data) => {
  out += data.toString();
  process.stdout.write(data);
});
child.on('close', () => {
  const match = out.match(/EVAL_RESULT (.+)/);
  let result: Record<string, any> | null = null;
  try {
    result = match ? JSON.parse(match[1]) : null;
  } catch {
    result = null;
  }
  const ok =
    result?.railDotReady === true &&
    result?.normalSettingsReady === true &&
    result?.dataDotShown === true &&
    result?.dotRetainedOnOpen === true &&
    result?.dataReady === true &&
    result?.countShown === true &&
    result?.createShown === true &&
    result?.dismissHintShown === true &&
    result?.disableButtonShown === true &&
    result?.enabled === true &&
    result?.thresholdText === '100' &&
    result?.hintShown === true &&
    result?.disabledAndDotsCleared === true &&
    result?.thresholdDisabled === true;
  console.log(JSON.stringify(result));
  console.log(ok ? 'EXPORT_REMINDER_TEST_PASS' : 'EXPORT_REMINDER_TEST_FAIL');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
});
