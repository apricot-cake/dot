import type { CSSProperties, ReactNode } from 'react';
import { Highlight } from './Highlight.tsx';
import { Label } from '@/components/ui/label';

// ラベルと操作部品を1組にした行: 左にラベル（と、あれば補足）、右に操作部品＝shadcn の
// 設定フォームのレイアウト。使い回すことで、ラベルの付いた設定はどれも同じ描かれ方になる。
export function SettingRow({ label, hint, children, style, controlId, controlWidth = 'input', inline = false }: { label: string; hint?: string | null; children?: ReactNode; style?: CSSProperties; controlId?: string; controlWidth?: 'input' | 'auto'; inline?: boolean }) {
  return (
    <div data-slot="setting-row" className={`flex min-w-0 gap-3 py-4 ${inline ? 'flex-row items-center justify-between gap-6' : 'flex-col @min-[32rem]/settings-content:flex-row @min-[32rem]/settings-content:items-center @min-[32rem]/settings-content:justify-between @min-[32rem]/settings-content:gap-6'}`} style={style}>
      <div className="min-w-0 flex-1 space-y-1">
        {controlId ? (
          <Label htmlFor={controlId} className="text-sm leading-relaxed">
            <Highlight text={label} />
          </Label>
        ) : (
          <div className="text-sm leading-relaxed font-medium">
            <Highlight text={label} />
          </div>
        )}
        {hint ? (
          <div className="text-muted-foreground text-sm leading-relaxed">
            <Highlight text={hint} />
          </div>
        ) : null}
      </div>
      <div className={`flex min-w-0 shrink-0 flex-wrap items-center gap-2 [&>*]:max-w-full ${inline ? 'w-auto' : `w-full @min-[32rem]/settings-content:justify-end ${controlWidth === 'input' ? '@min-[32rem]/settings-content:w-56' : '@min-[32rem]/settings-content:w-auto'}`}`}>{children}</div>
    </div>
  );
}
