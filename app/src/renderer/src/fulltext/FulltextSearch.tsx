import type { MessageKey } from '../services/translation.ts';
import { toast } from 'sonner';
import { subscribe as subscribePosts, getGeneration } from '../services/posts-data.ts';
import { Autocomplete, AutocompleteEmpty, AutocompleteInput, AutocompleteItem, AutocompleteList } from '@/components/ui/autocomplete';
import { Button } from '@/components/ui/button';
import { FileSearch } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '../_shared/i18n.ts';
import { close, isOpen, openId, subscribe } from '../services/fulltext-dialog.ts';
import { type FullTextMatch, fullTextBridge, runFullTextSearch } from '../services/fulltext.ts';
const FIELD_LABEL: Record<FullTextMatch['field'], MessageKey> = {
  text: 'ftFieldText',
  title: 'ftFieldTitle',
  seriesTitle: 'ftFieldSeries',
  alt: 'ftFieldAlt',
  quoted: 'ftFieldQuoted',
  poll: 'ftFieldPoll',
  linkCard: 'ftFieldLinkCard',
  displayName: 'ftFieldAuthor',
  screenName: 'ftFieldAuthor',
  eagleName: 'ftFieldEagle',
  tag: 'ftFieldTag',
  hashtag: 'ftFieldHashtag',
};

const FULLTEXT_DEBOUNCE_MS = 150; // #29 設計:「150ms デバウンス」
const FULLTEXT_CAP = 50; // #29 設計: 上限50件＋「すべて表示」

const authorLabelOf = (p: DotPost): string => p.displayName || p.screenName || t('unnamedUser');
const thumbFileOf = (p: DotPost): string | null => p.image || (Array.isArray(p.media) && p.media[0]?.file) || null;

function FulltextBody() {
  const generation = useSyncExternalStore(subscribePosts, getGeneration);
  const [ftQuery, setFtQuery] = useState('');
  const [hits, setHits] = useState<FullTextMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [showAll, setShowAll] = useState(false);
  // 素早く打ち消された古いキー入力の、遅れて届いた応答が新しい方の後に着地するのを防ぐ＝
  // 反映するのは常に最新の要求の結果だけ。
  const seqRef = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 投稿の追加・変更が届いた世代でも検索し直す。
  useEffect(() => {
    const seq = ++seqRef.current;
    const bridge = fullTextBridge();
    const q = ftQuery.trim();
    if (!q || !bridge) {
      setHits([]);
      setTotal(0);
      return;
    }
    const timer = setTimeout(() => {
      runFullTextSearch(q, bridge.allPosts(), showAll ? Number.POSITIVE_INFINITY : FULLTEXT_CAP)
        .then((res) => {
          if (seqRef.current !== seq) return;
          setHits(res.hits);
          setTotal(res.total);
        })
        .catch(() => {
          if (seqRef.current === seq) toast.error('検索できませんでした。もう一度入力してください。');
        });
    }, FULLTEXT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      seqRef.current++;
    };
  }, [ftQuery, showAll, generation]);

  function jumpTo(hit: FullTextMatch) {
    close();
    fullTextBridge()?.openResult(ftQuery, hit.post.captureId);
  }

  const bridge = fullTextBridge();

  return (
    <DialogContent className="top-[15%] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
      <DialogHeader className="sr-only">
        <DialogTitle>{t('fulltextTitle')}</DialogTitle>
        <DialogDescription>{t('fulltextDesc')}</DialogDescription>
      </DialogHeader>
      <Autocomplete inline open mode="none" items={hits} value={ftQuery} onValueChange={setFtQuery} autoHighlight="always" itemToStringValue={(hit: FullTextMatch) => hit.post.captureId}>
        <div className="flex items-center gap-1 border-b p-1">
          <FileSearch className="ml-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <AutocompleteInput autoFocus aria-label={t('fulltextTitle')} placeholder={t('fulltextPlaceholder')} className="border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 dark:bg-transparent" />
        </div>
        <AutocompleteList className="max-h-80 overscroll-contain">
          {(hit: FullTextMatch) => {
            const file = thumbFileOf(hit.post);
            return (
              <AutocompleteItem key={hit.post.captureId} value={hit} onClick={() => jumpTo(hit)} className="items-start">
                {file && bridge ? <img src={bridge.fileSrc(file, 64)} alt="" className="mt-0.5 size-8 shrink-0 rounded object-cover" /> : <div className="mt-0.5 size-8 shrink-0 rounded bg-muted" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <span className="truncate font-medium text-foreground">{authorLabelOf(hit.post)}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">{t(FIELD_LABEL[hit.field])}</span>
                  </div>
                  <div className="truncate">
                    {hit.matchStart >= 0 ? (
                      <>
                        {hit.snippetText.slice(0, hit.matchStart)}
                        <mark className="rounded-none bg-transparent px-0 font-semibold text-foreground">{hit.snippetText.slice(hit.matchStart, hit.matchEnd)}</mark>
                        {hit.snippetText.slice(hit.matchEnd)}
                      </>
                    ) : (
                      hit.snippetText
                    )}
                  </div>
                </div>
              </AutocompleteItem>
            );
          }}
        </AutocompleteList>
        <AutocompleteEmpty>{t('fulltextEmpty')}</AutocompleteEmpty>
      </Autocomplete>
      {total > hits.length && (
        <Button variant="ghost" onClick={() => setShowAll(true)} className="w-full rounded-none border-t text-xs text-muted-foreground">
          {t('fulltextShowAll', { count: total })}
        </Button>
      )}
    </DialogContent>
  );
}

export function FulltextSearchHost() {
  const open = useSyncExternalStore(subscribe, isOpen);
  // openId を key にする。閉じるアニメーションの最中に開き直しても、打ちかけのクエリを
  // 持ち越さずに開き直る（ConfirmHost や BulkTagDialogHost と同じ作法）。initialMode は
  // 描画のたびに読み直されるが、ある key にとって効くのは載せる時だけ＝openMode() と
  // open_ と openSeq は open()/openFulltext() の中で同期的に揃って設定されるので、これが
  // 描画し直される頃には既に一致している。
  const seq = useSyncExternalStore(subscribe, openId);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close(); // Esc か背景のクリック
      }}
    >
      {/* 常に載せたままにする＝閉じるアニメーションは Base UI の Dialog（Portal/Popup）が
          `open` を見て動かしているので、ここで載せ外しすると出ていくアニメーションが消える。 */}
      <FulltextBody key={seq} />
    </Dialog>
  );
}
