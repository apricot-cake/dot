import type { ExtensionNotificationController } from 'virtual:dot-extension-notifications';
import { createI18n } from '../../extension/utils/i18n';
import { SaveToasts } from '../../extension/utils/save-toasts';
import { clearUiRoot } from '../../extension/utils/ui-root';

// 拡張のソースは拡張の型設定で検査し、React 側へはこの小さな表示 API だけを公開する。
export async function createExtensionNotificationPreview(onSavingChange: (saving: boolean) => void): Promise<ExtensionNotificationController> {
  const i18n = await createI18n();
  let toasts = new SaveToasts(i18n.getMessage);
  let active: string[] = [];
  let nextId = 0;
  let lastCount = 1;
  let disposed = false;

  const clearSurfaces = () => {
    for (const id of active) toasts.end(id, false);
    active = [];
    clearUiRoot();
  };

  const clear = () => {
    if (disposed) return;
    clearSurfaces();
    toasts = new SaveToasts(i18n.getMessage);
    onSavingChange(false);
  };

  const start = (count: number) => {
    if (disposed) return;
    clear();
    lastCount = Math.max(1, Math.min(999, Math.trunc(count) || 1));
    active = Array.from({ length: lastCount }, () => `notification-preview-${++nextId}`);
    for (const id of active) toasts.begin(id);
    onSavingChange(true);
  };

  return {
    start,
    clear,
    complete() {
      if (disposed) return;
      for (const id of active) toasts.end(id, true);
      active = [];
      onSavingChange(false);
    },
    fail() {
      if (disposed) return;
      for (const id of active) toasts.end(id, false);
      active = [];
      toasts.notice('notification-preview-failure', '', i18n.getMessage('toastFailedSingle'), () => start(lastCount), 'error', { savedSummary: i18n.getMessage('saveNothingSaved') });
      onSavingChange(false);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearSurfaces();
    },
  };
}
