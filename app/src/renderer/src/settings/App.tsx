import { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { SearchIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SearchContext } from './search-context.ts';
import { Section } from './components/Section.tsx';
import { SECTIONS } from './sections/registry.ts';
import { t } from '../_shared/i18n.ts';
import { requestedSection } from '../services/settings.ts';
import { getSnapshot as safetySnapshot, subscribe as safetySubscribe } from '../services/library-safety-status.ts';

// 設定モーダルの全体。shadcn の Dialog の上に作り直してある: 貼り付く頭（タイトルと
// 検索）＋横の目次＋本体。マスター・ディテール型で、クエリが無ければ目次が節を1つ選んで
// ページとして見せ、クエリがあれば一致した節をすべて積み上げて一致箇所を強調する。
// Esc・背景で閉じる・フォーカスの閉じ込めは、Base UI の Dialog が処理する
// （手書きのハンドラは無くなった）。
// 開閉のストアは services/settings.ts にあり、index.tsx がこの形へつなぐ。
export interface OpenStore {
  isOpen(): boolean;
  set(v: boolean): void;
  subscribe(cb: () => void): () => void;
}

export function App({ store }: { store: OpenStore }) {
  const open = useSyncExternalStore(store.subscribe, store.isOpen);
  const { reminder, integrity } = useSyncExternalStore(safetySubscribe, safetySnapshot);
  const hasIntegrityWarning = integrity?.dbOk === false || (integrity?.orphanCount ?? 0) > 0;
  const hasDataNotification = hasIntegrityWarning || reminder?.due;
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [matchIds, setMatchIds] = useState<Set<string> | null>(null); // null = 検索していない
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const contentRef = useRef<HTMLDivElement | null>(null);

  // 開くと1ページ表示へ戻す（検索も消す）＝以前の open() と同じ振る舞い。
  useEffect(() => {
    if (open) {
      setQuery('');
      const requested = requestedSection();
      if (requested && SECTIONS.some((section) => section.id === requested)) setActiveId(requested);
    }
  }, [open]);

  const q = query.trim().toLowerCase();

  // ページをまたぐ検索: どの節がクエリを含むか。描画済みの textContent を読む（以前の
  // `sec.textContent.includes(q)` に忠実で、option のラベルも含む）。描画の前に走るので、
  // 違う節が一瞬映ることはない。
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` は意図して足した依存＝モーダルが開き直された時に節の文字列を読み直す。sectionRefs と SECTIONS は安定している
  useLayoutEffect(() => {
    if (!q) {
      setMatchIds(null);
      return;
    }
    const ids = SECTIONS.filter((s) => {
      const el = sectionRefs.current[s.id];
      return el && (el.textContent as string).toLowerCase().includes(q);
    }).map((s) => s.id);
    setMatchIds(new Set(ids));
  }, [q, open]);

  const searching = !!q && matchIds !== null;
  const matchCount = searching ? (matchIds as Set<string>).size : SECTIONS.length;
  const isHidden = (id: string) => (searching ? !(matchIds as Set<string>).has(id) : id !== activeId);
  const tocHidden = (id: string) => (searching ? !(matchIds as Set<string>).has(id) : false);
  const pickPage = (id: string) => {
    setActiveId(id);
    setQuery('');
    contentRef.current?.scrollTo({ top: 0 });
  };

  return (
    <SearchContext.Provider value={q}>
      <Dialog open={open} onOpenChange={(v) => store.set(v)}>
        <DialogContent className="flex h-[min(640px,calc(100dvh-48px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(960px,calc(100vw-48px))] [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-4">
          <DialogHeader className="shrink-0 flex-row items-center justify-between gap-4 border-b px-6 py-4 pr-14">
            <DialogTitle className="text-lg">{t('tabSettings')}</DialogTitle>
            <DialogDescription className="sr-only">{t('settingsSearch')}</DialogDescription>
            <div className="relative min-w-0 flex-1 max-w-xs">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
              <Input type="search" aria-label={t('settingsSearch')} autoComplete="off" placeholder={t('settingsSearch')} value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
            </div>
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            <nav aria-label={t('tabSettings')} className="bg-muted/30 flex w-40 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3">
              {SECTIONS.map((s) => (
                <SidebarMenuButton key={s.id} type="button" isActive={!searching && s.id === activeId} size="sm" className="h-9 justify-start gap-2 px-2.5 text-[13px] whitespace-nowrap" hidden={tocHidden(s.id)} onClick={() => pickPage(s.id)}>
                  <s.Icon aria-hidden="true" />
                  {t(s.titleKey)}
                  {s.id === 'data' && hasDataNotification && (
                    <>
                      <Badge aria-hidden="true" data-slot="settings-data-notification" className={`ml-auto size-2 p-0 ${hasIntegrityWarning ? 'bg-destructive' : 'bg-blue-600 dark:bg-blue-400'}`} />
                      <span className="sr-only">{hasIntegrityWarning ? t('integritySubTitle') : t('exportReminderTitle')}</span>
                    </>
                  )}
                </SidebarMenuButton>
              ))}
            </nav>

            <div ref={contentRef} data-slot="settings-content" className="@container/settings-content flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-6 py-6 [scrollbar-gutter:stable]">
              {searching && matchCount === 0 && <div className="text-muted-foreground py-10 text-center text-sm">{t('settingsNoMatch')}</div>}
              {SECTIONS.map((s) => (
                <Section
                  key={s.id}
                  title={t(s.titleKey)}
                  hidden={isHidden(s.id)}
                  fill={!searching && s.id === activeId}
                  innerRef={(el) => {
                    sectionRefs.current[s.id] = el;
                  }}
                >
                  <s.Component />
                </Section>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SearchContext.Provider>
  );
}
