import { subscribeSearch, searchRevision } from '../services/search-results.ts';
import { subscribe as subscribePosts, getGeneration } from '../services/posts-data.ts';
import { Autocomplete, AutocompleteClear, AutocompleteContent, AutocompleteInput, AutocompleteInputGroup, AutocompleteItem, AutocompleteList } from '@/components/ui/autocomplete';
import { InputGroupAddon } from '@/components/ui/input-group';
import { Search, Tag, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { t } from '../_shared/i18n.ts';
import { type SearchSuggestion, type SuggestionSection, type QueryOptions, queryEntries } from '../services/search-suggestions.ts';
import { registerFocus } from '../services/searchbox.ts';
import { store, subscribeKeys } from '../services/store.ts';

const SUGGEST: QueryOptions = { sections: ['tag', 'user'], limit: { tag: 6, user: 4 } };

const SUG_ICON: Partial<Record<SuggestionSection, ComponentType<{ className?: string }>>> = { tag: Tag, user: User };

export function SearchBox({ placeholder }: { placeholder?: string }) {
  const searchVersion = useSyncExternalStore(subscribeSearch, searchRevision);
  const generation = useSyncExternalStore(subscribePosts, getGeneration);
  const subscribe = useCallback((cb: () => void) => subscribeKeys(['browseMode', 'searchQuery', 'trashSearchQuery'], cb), []);
  const mode = useSyncExternalStore(subscribe, () => store.getState().browseMode);
  const isTrash = mode === 'trash';
  const value = useSyncExternalStore(subscribe, () => (store.getState().browseMode === 'trash' ? store.getState().trashSearchQuery : store.getState().searchQuery));
  const inputRef = useRef<HTMLInputElement>(null);
  const focus = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => registerFocus(focus), [focus]);

  // 候補は確定済みの入力から導く。IME変換中の値はAutocompleteが保持する。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 非同期の検索結果が届いた世代で候補を再取得する。
  const items = useMemo<SearchSuggestion[]>(() => {
    const q = value.trim();
    if (!q || isTrash) return [];
    return queryEntries(q, SUGGEST).flatMap((group) => group.items);
  }, [value, searchVersion, generation, isTrash]);

  return (
    <div className="flex min-w-0 items-center justify-end">
      <div className="min-w-0 w-72">
        <Autocomplete
          // mode="none": レジストリが問い合わせに対して行を絞り込み済み＝Base UI がそれを絞り
          // 込み直したり、選択中の項目を入力欄へ書き込んだりしてはいけない。
          mode="none"
          items={items}
          value={value}
          onValueChange={(v, details) => {
            // 項目を押すと、その項目のラベルが入力欄へ反響する。選択そのものはストアを通して
            // 既に値を空にしているので、この反響は飲み込む。
            if (details.reason === 'item-press') return;
            store.setState(isTrash ? { trashSearchQuery: v } : { searchQuery: v });
          }}
          itemToStringValue={(entry: SearchSuggestion) => entry.title}
        >
          <AutocompleteInputGroup>
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <AutocompleteInput inGroup ref={inputRef} aria-label={placeholder} placeholder={placeholder} />
            {value ? (
              <InputGroupAddon align="inline-end">
                <AutocompleteClear aria-label={t('searchClear')} />
              </InputGroupAddon>
            ) : null}
          </AutocompleteInputGroup>
          <AutocompleteContent className="data-empty:hidden">
            <AutocompleteList>
              {(entry: SearchSuggestion) => {
                const Icon = SUG_ICON[entry.section] || Tag;
                return (
                  <AutocompleteItem key={entry.id} value={entry} onClick={() => entry.perform()}>
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{entry.hint}</span>
                  </AutocompleteItem>
                );
              }}
            </AutocompleteList>
          </AutocompleteContent>
        </Autocomplete>
      </div>
    </div>
  );
}
