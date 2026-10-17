import type { ReactNode, Ref } from 'react';
import { Highlight } from './Highlight.tsx';

// 設定の節1つ分: 揃った見出しと本体。見出しをここに集めることが試行の要点＝節ごとに
// タイトルの描き方がずれていかない。`innerRef` は包みの要素を外へ出す＝ページをまたぐ
// 検索のために、親がその textContent を読めるようにするため。`hidden` はページの見え方を
// 切り替える。`fill` は1ページだけを見せている間、本体を表示領域の残りの高さまで広げる
// （内容の少ない節が縦方向に中央へ寄せられるように）。検索で節が縦に並ぶ間は広げない。
export function Section({ title, hidden, fill, innerRef, children }: { title: string; hidden?: boolean; fill?: boolean; innerRef?: Ref<HTMLDivElement>; children?: ReactNode }) {
  return (
    <div className={fill ? 'mb-10 flex flex-1 flex-col last:mb-0' : 'mb-10 last:mb-0'} hidden={hidden} ref={innerRef}>
      <h2 className="mb-1 text-lg font-semibold tracking-tight">
        <Highlight text={title} />
      </h2>
      <div className={fill ? 'flex flex-1 flex-col pt-3' : 'pt-3'}>{children}</div>
    </div>
  );
}
