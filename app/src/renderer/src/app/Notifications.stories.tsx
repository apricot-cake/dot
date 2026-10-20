import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { createTranslator, type Translate } from '../services/translation.ts';
import { notify, notifyProgress } from '../services/ui.ts';
import { ExtensionNotificationPreview } from '../../../../.storybook/ExtensionNotificationPreview.tsx';

function AppNotifications() {
  const [translate, setTranslate] = useState<Translate | null>(null);
  const [actionResult, setActionResult] = useState('');
  useEffect(() => {
    let active = true;
    void createTranslator('ja').then((t) => {
      if (active) setTranslate(() => t);
    });
    return () => {
      active = false;
      toast.dismiss();
    };
  }, []);
  if (!translate) return <p role="status">読み込んでいます…</p>;
  const t = translate;
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-lg font-semibold">アプリ内の通知</h1>
          <p className="text-sm text-muted-foreground">実際の部品と文言で表示します。ボタンは繰り返し押せます。ファイルやライブラリは変更しません。</p>
        </header>
        <section className="space-y-3" aria-labelledby="result-notifications">
          <h2 id="result-notifications" className="text-sm font-semibold">
            操作結果
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => notify(t('exported'))}>
              エクスポート完了
            </Button>
            <Button variant="outline" onClick={() => notify(t('exportFailed'))}>
              エクスポート失敗
            </Button>
            <Button variant="outline" onClick={() => notify(t('imported', { count: 3 }))}>
              インポート完了
            </Button>
            <Button variant="outline" onClick={() => notify(t('importSkipped', { count: 3, skipped: 2 }))}>
              インポート完了（スキップあり）
            </Button>
            <Button variant="outline" onClick={() => notify(t('importFailed'))}>
              インポート失敗
            </Button>
          </div>
        </section>
        <section className="space-y-3" aria-labelledby="progress-notifications">
          <h2 id="progress-notifications" className="text-sm font-semibold">
            進行中
          </h2>
          <div className="flex flex-wrap gap-2">
            {[0, 50, 100].map((pct) => (
              <Button key={pct} variant="outline" onClick={() => notifyProgress(t('exporting'), `${pct}%`, 'preview-export')}>
                エクスポート {pct}%
              </Button>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                toast.dismiss('preview-export');
                notify(t('exported'));
              }}
            >
              完了に切り替え
            </Button>
          </div>
        </section>
        <section className="space-y-3" aria-labelledby="action-notifications">
          <h2 id="action-notifications" className="text-sm font-semibold">
            元に戻す操作
          </h2>
          <Button
            variant="outline"
            onClick={() => {
              setActionResult('');
              notify(t('tagsSavedN', { count: 3 }), { label: t('undoAction'), onClick: () => setActionResult('「元に戻す」が押されました。データの変更はありません。') });
            }}
          >
            タグ編集完了（元に戻す付き）
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {actionResult}
          </p>
        </section>
        <Button
          variant="secondary"
          onClick={() => {
            toast.dismiss();
            setActionResult('');
          }}
        >
          通知をすべて消す
        </Button>
      </div>
      <Toaster />
    </main>
  );
}

const meta = {
  id: 'dot-notifications',
  title: 'dot/通知',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const App: Story = { name: 'アプリ内', render: () => <AppNotifications /> };
export const Extension: Story = {
  name: '拡張機能の保存',
  render: () => (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-2xl">
        <ExtensionNotificationPreview />
      </div>
    </main>
  ),
};
