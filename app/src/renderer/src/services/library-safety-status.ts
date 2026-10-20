import type { ExportReminderState, IntegrityStatus } from '../../../main/ipc-payloads.ts';
import { getExportReminder, getIntegrityStatus, onExportReminderChanged, onIntegrityCheckDone } from './backup.ts';
import { isOpen as settingsIsOpen, subscribe as settingsSubscribe } from './settings.ts';

let snapshot: { reminder: ExportReminderState | null; integrity: IntegrityStatus | null } = { reminder: null, integrity: null };
const subscribers = new Set<() => void>();
let wired = false;
let reminderRevision = 0;
let integrityRevision = 0;

function publish(patch: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const cb of subscribers) cb();
}

async function refresh() {
  const reminderRequest = ++reminderRevision;
  const integrityRequest = ++integrityRevision;
  await Promise.allSettled([
    getExportReminder().then((reminder) => {
      if (reminderRequest === reminderRevision) publish({ reminder });
    }),
    getIntegrityStatus().then((integrity) => {
      if (integrityRequest === integrityRevision) publish({ integrity });
    }),
  ]);
}

export function getSnapshot() {
  return snapshot;
}

export function subscribe(cb: () => void) {
  subscribers.add(cb);
  if (!wired) {
    wired = true;
    // preload のリスナーは解除 API がないので一度だけ登録し、各表示へ配る。
    onExportReminderChanged((reminder: ExportReminderState) => {
      reminderRevision++;
      publish({ reminder });
    });
    onIntegrityCheckDone((integrity: IntegrityStatus) => {
      integrityRevision++;
      publish({ integrity });
    });
    let wasOpen = settingsIsOpen();
    settingsSubscribe(() => {
      const open = settingsIsOpen();
      if (wasOpen && !open) void refresh();
      wasOpen = open;
    });
    void refresh();
  }
  return () => {
    subscribers.delete(cb);
  };
}
