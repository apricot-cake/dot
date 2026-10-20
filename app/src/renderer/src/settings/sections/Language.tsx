import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingRow } from '../components/SettingRow.tsx';
import { SettingsGroup } from '../components/SettingsGroup.tsx';
import { t } from '../../_shared/i18n.ts';
import * as ipc from '../ipc.ts';

// 言語: 表示側の表示言語。変えると値を永続化してからレンダラーを読み込み直す（静的な
// i18n がすべて当たり直すため）＝素の select と同じ振る舞い。
export function Language() {
  const [lang, setLang] = useState('auto');

  useEffect(() => {
    ipc
      .getPrefs()
      .then((p) => {
        if (p) setLang(p.language || 'auto');
      })
      .catch(() => {});
  }, []);

  return (
    <SettingsGroup>
      <SettingRow label={t('langDisplayLabel')} hint={t('hintLang')} controlId="settings-language">
        <Select
          items={{ auto: t('langAuto'), ja: '日本語', en: 'English' }}
          value={lang}
          onValueChange={(v) => {
            if (v === null) return;
            setLang(v);
            Promise.resolve(ipc.setPref('language', v)).then(() => location.reload());
          }}
        >
          <SelectTrigger id="settings-language" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="auto">{t('langAuto')}</SelectItem>
              <SelectItem value="ja">日本語</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingRow>
    </SettingsGroup>
  );
}
