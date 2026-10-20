import { useEffect, useRef, useState } from 'react';
import { Button } from '../src/renderer/src/components/ui/button';
import { Input } from '../src/renderer/src/components/ui/input';
import { Label } from '../src/renderer/src/components/ui/label';
import { createExtensionNotificationPreview, type ExtensionNotificationController } from 'virtual:dot-extension-notifications';

// 本番の表示クラスへ状態だけを渡す。保存処理や拡張機能の接続は起動しない。
export function ExtensionNotificationPreview() {
  const [count, setCount] = useState(1);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const controller = useRef<ExtensionNotificationController | null>(null);

  useEffect(() => {
    let mounted = true;
    void createExtensionNotificationPreview(setSaving).then((preview) => {
      if (!mounted) {
        preview.dispose();
        return;
      }
      controller.current = preview;
      setReady(true);
    });
    return () => {
      mounted = false;
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);

  const start = () => {
    const total = Math.max(1, Math.min(999, Math.trunc(count) || 1));
    setCount(total);
    controller.current?.start(total);
  };

  return (
    <section className="space-y-4" aria-label="拡張機能の保存通知">
      <div className="space-y-1">
        <h2 className="text-base font-medium">拡張機能の保存通知</h2>
        <p className="text-sm text-muted-foreground">拡張機能で使っている通知を表示します。件数は表示テスト用で、投稿は保存しません。</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="extension-notification-count">件数（表示テスト用）</Label>
          <Input id="extension-notification-count" type="number" min={1} max={999} value={count} onChange={(event) => setCount(event.target.valueAsNumber || 1)} className="w-28" />
        </div>
        <Button variant="outline" disabled={!ready} onClick={start}>
          保存中を表示
        </Button>
        <Button
          variant="outline"
          disabled={!ready}
          onClick={() => {
            if (!saving) start();
            controller.current?.complete();
          }}
        >
          完了にする
        </Button>
        <Button variant="outline" disabled={!ready} onClick={() => controller.current?.fail()}>
          失敗にする
        </Button>
        <Button variant="ghost" disabled={!ready} onClick={() => controller.current?.clear()}>
          通知を消す
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">通知は右下に表示されます。完了通知は本番と同じ時間で消えます。</p>
    </section>
  );
}
