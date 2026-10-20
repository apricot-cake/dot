import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingsGroup } from '../components/SettingsGroup.tsx';
import { SettingRow } from '../components/SettingRow.tsx';
import { t } from '../../_shared/i18n.ts';
import { getPrefs } from '../ipc.ts';
import { setSkipDeleteConfirm, confirmClearAll } from '../../services/post-grid-builder.ts';

// 危険な操作: 削除の確認を有効に戻すことと、ライブラリ全体の全削除。全削除をここで作り直しては
// いない＝ボタンがするのは、post-grid-builder.ts の confirmClearAll の生きた束縛越しに、共用の
// keyword で塞いだ確認のオーバーレイを出すことだけ。
export function Danger() {
  // checked = 確認を出す（つまり省略しない）。
  const [confirmShown, setConfirmShown] = useState(true);

  useEffect(() => {
    Promise.resolve(getPrefs())
      .then((p) => {
        if (p) setConfirmShown(!p.skipDeleteConfirm);
      })
      .catch(() => {});
  }, []);

  const onToggle = (checked: boolean) => {
    setConfirmShown(checked);
    if (setSkipDeleteConfirm) setSkipDeleteConfirm(!checked);
  };

  const clearAll = () => {
    if (confirmClearAll) confirmClearAll();
  };

  return (
    <SettingsGroup>
      <SettingRow label={t('labelResetDeleteConfirm')} hint={t('hintResetDeleteConfirm')} controlId="reset-delete-confirm" controlWidth="auto" inline>
        <Switch id="reset-delete-confirm" checked={confirmShown} onCheckedChange={onToggle} />
      </SettingRow>
      <SettingRow label={t('clearData')} hint={t('confirmClearDesc')} controlWidth="auto">
        <Button variant="destructive" onClick={clearAll}>
          {t('clearData')}
        </Button>
      </SettingRow>
    </SettingsGroup>
  );
}
