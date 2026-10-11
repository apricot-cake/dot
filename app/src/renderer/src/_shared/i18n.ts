import { dotI18n, type DotI18nApi } from '../services/i18n.ts';
import type { Translate } from '../services/translation.ts';

let api: DotI18nApi | null = null;

export async function initI18n(): Promise<DotI18nApi | null> {
  try {
    api = await dotI18n;
  } catch {
    api = null; // i18n が使えない＝t() は生のキーへ退避する
  }
  return api;
}

export const t: Translate = (key, options) => {
  if (!api) return key;
  return api.getMessage(key, options);
};

export function lang(): string {
  return api ? api.lang : 'auto';
}
