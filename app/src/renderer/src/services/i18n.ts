import { dotIpc } from './ipc.ts';
import { resolveLanguageSetting } from './locale.ts';
import { createTranslator } from './translation.ts';

export const dotI18n = (async () => {
  let lang = 'auto';
  try {
    lang = (await dotIpc.getPrefs()).language || 'auto';
  } catch {
    /* 設定が読めない場合はOSの言語を使う。 */
  }
  const resolved = resolveLanguageSetting(lang, navigator.language);
  const getMessage = await createTranslator(resolved);
  return { lang, resolved, getMessage };
})();
export type DotI18nApi = Awaited<typeof dotI18n>;
