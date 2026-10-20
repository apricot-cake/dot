import { Highlight } from './Highlight.tsx';

// 操作部品の下に置く、補足の説明文（shadcn の form-description の装飾）。
export function Hint({ text }: { text?: string | null }) {
  return (
    <div className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
      <Highlight text={text} />
    </div>
  );
}
