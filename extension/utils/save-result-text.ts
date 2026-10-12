import type { DotI18nApi } from './i18n.ts';
import type { SaveResponse } from './messages.ts';

export function saveResultText(result: Extract<SaveResponse, { ok: true }>, t: DotI18nApi['getMessage']) {
  const scopes = new Set(result.acquisitionIssues?.map((issue) => issue.scope));
  if (result.mediaMissing) scopes.add('media');
  if (!scopes.size && result.metaOk === false) scopes.add('post');
  const failed = [...scopes].map((scope) => t(scope === 'media' ? 'savePartMedia' : scope === 'profile' ? 'savePartProfile' : 'savePartPost'));
  const saved: string[] = [];
  if (result.savedContent?.text) saved.push(t('savePartText'));
  if (result.savedContent?.profile) saved.push(t('savePartProfile'));
  if (result.savedContent?.media) saved.push(t('savePartMediaCount', [result.savedContent.media]));
  if (!saved.length && result.savedContent?.url) saved.push(t('savePartUrl'));
  return {
    failure: failed.length ? t('savePartsFailed', [failed.join(t('savePartSeparator'))]) : t('toastFailedSingle'),
    // 応答が保存内容を報告しない場合、何も保存されていないとは断定しない。
    savedSummary: saved.length ? t('savePartsSaved', [saved.join(t('savePartSeparator'))]) : undefined,
  };
}
