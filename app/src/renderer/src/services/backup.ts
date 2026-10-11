// 手動エクスポートの通知、ローカル復元、整合性検査の IPC をまとめる。
import { dotIpc } from './ipc.ts';

export function getExportReminder() {
  return dotIpc.getExportReminder();
}
export function setExportReminderEnabled(enabled: boolean) {
  return dotIpc.setExportReminderEnabled(enabled);
}
export function setExportReminderThreshold(threshold: number) {
  return dotIpc.setExportReminderThreshold(threshold);
}
export function onExportReminderChanged(cb: (state: any) => void) {
  return dotIpc.onExportReminderChanged(cb);
}
export function getIntegrityStatus() {
  return dotIpc.getIntegrityStatus();
}
export function runOrphanRecovery() {
  return dotIpc.runOrphanRecovery();
}
export function onIntegrityCheckDone(cb: (status: any) => void) {
  return dotIpc.onIntegrityCheckDone(cb);
}
