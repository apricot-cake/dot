import type { ReactNode, Ref } from 'react';
import { Highlight } from './Highlight.tsx';

// 設定の節1つ分: 揃った見出しと本体。見出しをここに集めることが試行の要点＝節ごとに
// タイトルの描き方がずれていかない。`innerRef` は包みの要素を外へ出す＝ページをまたぐ
// 検索のために、親がその textContent を読めるようにするため。`hidden` はページの見え方を
// 切り替える。`fill` は1ページだけを見せている間、節を表示領域の残りの高さまで広げる。
// 検索で節が縦に並ぶ間は広げない。
export function Section({ title, hidden, fill, innerRef, children }: { title: string; hidden?: boolean; fill?: boolean; innerRef?: Ref<HTMLDivElement>; children?: ReactNode }) {
  return (
    <div className={fill ? 'mb-10 flex flex-1 flex-col last:mb-0' : 'mb-10 last:mb-0'} hidden={hidden} ref={innerRef}>
      <h2 className="text-lg font-semibold tracking-tight">
        <Highlight text={title} />
      </h2>
      <div className={fill ? 'flex min-w-0 flex-1 flex-col pt-5' : 'min-w-0 pt-5'}>{children}</div>
    </div>
  );
}
