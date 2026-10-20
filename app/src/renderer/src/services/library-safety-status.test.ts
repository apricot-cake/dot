import { beforeEach, expect, test, vi } from 'vitest';
import type { ExportReminderState, IntegrityStatus } from '../../../main/ipc-payloads.ts';

const mock = vi.hoisted(() => ({
  getExportReminder: vi.fn<() => Promise<ExportReminderState>>(),
  getIntegrityStatus: vi.fn<() => Promise<IntegrityStatus>>(),
  onExportReminderChanged: vi.fn<(cb: (state: ExportReminderState) => void) => void>(),
  onIntegrityCheckDone: vi.fn<(cb: (state: IntegrityStatus) => void) => void>(),
  settingsSubscribe: vi.fn<(cb: () => void) => () => void>(),
  settingsOpen: false,
}));

vi.mock('./backup.ts', () => mock);
vi.mock('./settings.ts', () => ({ isOpen: () => mock.settingsOpen, subscribe: mock.settingsSubscribe }));

const dueReminder: ExportReminderState = { enabled: true, threshold: 100, changesSinceExport: 120, lastExportAt: null, due: true };
const completedReminder: ExportReminderState = { ...dueReminder, changesSinceExport: 0, lastExportAt: '2026-10-18T06:00:00.000Z', due: false };
const integrity: IntegrityStatus = { lastCheckAt: null, dbOk: null, orphanCount: 0, missingCount: 0 };

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mock.settingsOpen = false;
  mock.getExportReminder.mockResolvedValue(dueReminder);
  mock.getIntegrityStatus.mockResolvedValue(integrity);
  mock.settingsSubscribe.mockReturnValue(() => {});
});

test('共有購読はIPCリスナーを一度だけ登録し、完了通知を各購読者へ配る', async () => {
  const store = await import('./library-safety-status.ts');
  const first = vi.fn();
  const second = vi.fn();
  const unsubscribe = store.subscribe(first);
  const unsubscribeSecond = store.subscribe(second);
  await vi.waitFor(() => expect(store.getSnapshot().reminder).toEqual(dueReminder));
  expect(mock.onExportReminderChanged).toHaveBeenCalledTimes(1);
  expect(mock.onIntegrityCheckDone).toHaveBeenCalledTimes(1);
  expect(mock.settingsSubscribe).toHaveBeenCalledTimes(1);
  first.mockClear();
  second.mockClear();

  const emit = mock.onExportReminderChanged.mock.calls[0][0];
  emit(completedReminder);
  expect(store.getSnapshot().reminder).toEqual(completedReminder);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);

  unsubscribe();
  emit(dueReminder);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
  unsubscribeSecond();
  const unsubscribeAgain = store.subscribe(first);
  expect(mock.onExportReminderChanged).toHaveBeenCalledTimes(1);
  expect(mock.onIntegrityCheckDone).toHaveBeenCalledTimes(1);
  unsubscribeAgain();
});

test('取得中に受信した通知を古い取得結果で上書きしない', async () => {
  let resolveReminder!: (state: ExportReminderState) => void;
  let resolveIntegrity!: (state: IntegrityStatus) => void;
  mock.getExportReminder.mockReturnValue(
    new Promise((resolve) => {
      resolveReminder = resolve;
    }),
  );
  mock.getIntegrityStatus.mockReturnValue(
    new Promise((resolve) => {
      resolveIntegrity = resolve;
    }),
  );
  const store = await import('./library-safety-status.ts');
  const unsubscribe = store.subscribe(vi.fn());
  const checkedIntegrity: IntegrityStatus = { ...integrity, dbOk: true, lastCheckAt: '2026-10-18T06:00:00.000Z' };
  mock.onExportReminderChanged.mock.calls[0][0](completedReminder);
  mock.onIntegrityCheckDone.mock.calls[0][0](checkedIntegrity);

  resolveReminder(dueReminder);
  resolveIntegrity(integrity);
  await Promise.resolve();
  expect(store.getSnapshot()).toEqual({ reminder: completedReminder, integrity: checkedIntegrity });
  unsubscribe();
});

test('設定を開閉しても通知対象は消えず、閉じた後の再取得結果を反映する', async () => {
  const store = await import('./library-safety-status.ts');
  const unsubscribe = store.subscribe(vi.fn());
  await vi.waitFor(() => expect(store.getSnapshot().reminder?.due).toBe(true));
  const settingsChanged = mock.settingsSubscribe.mock.calls[0][0];

  mock.settingsOpen = true;
  settingsChanged();
  expect(store.getSnapshot().reminder?.due).toBe(true);
  expect(mock.getExportReminder).toHaveBeenCalledTimes(1);
  mock.settingsOpen = false;
  settingsChanged();
  expect(store.getSnapshot().reminder?.due).toBe(true);
  await vi.waitFor(() => expect(mock.getExportReminder).toHaveBeenCalledTimes(2));
  await Promise.resolve();
  expect(store.getSnapshot().reminder?.due).toBe(true);
  unsubscribe();
});
