import type { ReactNode } from 'react';
import { Highlight } from './Highlight.tsx';

export function SettingsGroup({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      {title && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">
            <Highlight text={title} />
          </h3>
          {description && (
            <p className="text-muted-foreground text-sm leading-relaxed">
              <Highlight text={description} />
            </p>
          )}
        </div>
      )}
      <div className="divide-border divide-y rounded-lg border bg-card px-4">{children}</div>
    </section>
  );
}
