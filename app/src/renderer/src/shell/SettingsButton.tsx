import { useId, useSyncExternalStore } from 'react';
import { Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { t } from '../_shared/i18n.ts';
import { getSnapshot, subscribe } from '../services/library-safety-status.ts';
import { open as openSettings } from '../services/settings.ts';

export function SettingsButton() {
  const { reminder, integrity } = useSyncExternalStore(subscribe, getSnapshot);
  const descriptionId = useId();

  const hasIntegrityWarning = integrity?.dbOk === false || (integrity?.orphanCount ?? 0) > 0;
  const label = hasIntegrityWarning ? (integrity?.dbOk === false ? t('integrityDbBad') : t('integrityOrphanTip', { count: integrity?.orphanCount ?? 0 })) : reminder?.due ? t('exportReminderTitle') : null;
  return (
    <SidebarMenuButton aria-label={t('tabSettings')} aria-describedby={label ? descriptionId : undefined} onClick={() => openSettings()}>
      <span className="relative inline-flex shrink-0">
        <Settings />
        {label && <Badge aria-hidden="true" data-slot="settings-notification" className={`absolute -top-0.5 -right-0.5 size-2 p-0 ring-2 ring-[var(--tabbar-bg)] ${hasIntegrityWarning ? 'bg-destructive' : 'bg-blue-600 dark:bg-blue-400'}`} />}
      </span>
      <span data-slot="menu-label">{t('tabSettings')}</span>
      {label && (
        <span id={descriptionId} className="sr-only">
          {label}
        </span>
      )}
    </SidebarMenuButton>
  );
}
