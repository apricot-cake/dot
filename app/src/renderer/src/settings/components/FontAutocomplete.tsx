import { Autocomplete, AutocompleteClear, AutocompleteContent, AutocompleteEmpty, AutocompleteInput, AutocompleteInputGroup, AutocompleteItem, AutocompleteList } from '@/components/ui/autocomplete';
import { InputGroupAddon } from '@/components/ui/input-group';
import { isComposing } from '../../_shared/composition.ts';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { quoteFamily } from '../../services/ui-font-api.ts';
import { t } from '../../_shared/i18n.ts';

// インターフェースフォントの選択欄（設定 →「外観」、#137）。自由なフォント名の入力と
// インストール済みフォントの候補表示には共通 Autocomplete を使う。入力欄の
// 実時間のテキストは別のクエリで、呼び出し側がキー入力ごとにプレビューする＝settings/ipc.ts
// の uiFont.preview/commit の分け方を参照。
//
// 項目一覧は window.queryLocalFonts()（Local Font Access API）から取り、最初に開いた時に
// 遅延で読み込む。Electron 43 は許可のプロンプトなしでこれを許可する（CDP のサンドボックス
// で確認した。window.queryLocalFonts() がダイアログなしで実際にインストール済みの 359
// ファミリを解決した）。ただし API 自体はウェブプラットフォームの任意の機能なので、これが
// 無いビルドや OS（typeof window.queryLocalFonts !== 'function'）では項目一覧が空になる。
// その場合も欄はただの自由入力として動き続ける。これは Issue の設計が明示的に許している
// 退避先。
export function FontAutocomplete({ id, value, onPreview, onCommit }: { id?: string; value: string; onPreview: (v: string) => void; onCommit: (v: string) => void }) {
  const [query, setQuery] = useState(value);
  const [items, setItems] = useState<string[] | null>(null); // null = まだ問い合わせていない
  const highlightedRef = useRef<string | null>(null);

  // 確定値がこちらの知らないところで変わった時に合わせ直す（ui-font-api.ts の起動時に走る
  // config.json との突き合わせや、将来の外部からの setter）＝「外観」のテーマ Select が
  // getPrefs() の解決後に合わせ直すのと同じ形。
  useEffect(() => {
    setQuery(value);
  }, [value]);

  const loadItems = () => {
    if (items !== null) return; // 問い合わせ済み（または未対応と分かっている）
    if (typeof window.queryLocalFonts !== 'function') {
      setItems([]);
      return;
    }
    window
      .queryLocalFonts()
      .then((fonts) => {
        const families = Array.from(new Set(fonts.map((f) => f.family))).sort((a, b) => a.localeCompare(b));
        setItems(families);
      })
      .catch(() => setItems([])); // 許可されなかった、またはこの OS で未実装＝自由入力は動き続ける
  };

  const commit = (v: string) => {
    const cleaned = v.trim();
    setQuery(cleaned);
    onCommit(cleaned);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e.nativeEvent)) return;
    if (e.key === 'Escape') {
      // 編集中の内容を取り消す。最後に確定したフォントをその場で戻し、ポップアップにも
      // Escape を食わせない（ポップアップは自分で閉じる。ここでやるのはプレビューを
      // 戻すことだけ＝確定していないフォントをアプリ全体が着たままにしない）。
      setQuery(value);
      onPreview(value);
      return;
    }
    if (e.key !== 'Enter') return;
    if (highlightedRef.current) return; // 代わりに Base UI が強調中の項目を確定する
    e.preventDefault();
    commit(query);
  };

  return (
    <Autocomplete
      items={items || []}
      value={query}
      onValueChange={(v, details) => {
        setQuery(v);
        onPreview(v.trim());
        if (details.reason === 'item-press' || details.reason === 'clear-press') onCommit(v.trim());
      }}
      onOpenChange={(open) => {
        if (open) loadItems();
      }}
      onItemHighlighted={(it) => {
        highlightedRef.current = (it as string | undefined) ?? null;
      }}
    >
      <AutocompleteInputGroup>
        <AutocompleteInput inGroup id={id} placeholder={t('uiFontPlaceholder')} onKeyDown={onKeyDown} onBlur={() => commit(query)} />
        {query ? (
          <InputGroupAddon align="inline-end">
            <AutocompleteClear aria-label={t('uiFontClear')} />
          </InputGroupAddon>
        ) : null}
      </AutocompleteInputGroup>
      <AutocompleteContent>
        <AutocompleteEmpty>{t('uiFontNoMatch')}</AutocompleteEmpty>
        <AutocompleteList>
          {(family: string) => (
            <AutocompleteItem key={family} value={family} style={{ fontFamily: quoteFamily(family) }}>
              {family}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompleteContent>
    </Autocomplete>
  );
}
