import { useRef, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { dotIpc } from '../services/ipc.ts';
import { notify } from '../services/ui.ts';
import * as ipc from './ipc.ts';
import { mount as mountAboutIcon } from '../services/about-icon.ts';
import type { AppInfo } from '../../../main/ipc-payloads.ts';

// 小さなダイアログに、アイコン、名前、バージョンをまとめる。
// ランタイムと OS の情報は画面に出さず、不具合報告に貼るためのコピーにだけ含める。
// ライセンスはパッケージに同梱し、詳しく知りたい人はリポジトリを見る。

function versionReport(info: AppInfo): string {
  return [`dot ${info.version}`, `Electron ${info.electron} / Chromium ${info.chromium} / Node ${info.node}`, info.os].join('\n');
}

function AboutContent() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);

  // 既存の WebGL のアイコンのモジュールを、こちらの canvas に載せる。可視性で自分を塞ぐ
  // （IntersectionObserver）し、destroy() で rAF と observer を畳むので、React で外す時の
  // 後始末は handle.destroy() だけで済む。
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const handle = mountAboutIcon(canvasRef.current);
    return () => handle.destroy();
  }, []);

  useEffect(() => {
    Promise.resolve(ipc.getAppInfo())
      .then(setInfo)
      .catch(() => {});
  }, []);

  const copyVersion = () => {
    if (!info) return;
    Promise.resolve(dotIpc.copyText(versionReport(info)))
      .then((copied) => {
        if (copied) notify(t('aboutVersionCopied'));
      })
      .catch(() => {});
  };

  return (
    <div className="flex flex-col items-center gap-1.5 py-4 text-center">
      {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: a <canvas> is only focusable
            through fallback CONTENT (interactive children), and this one has none — it
            is a decorative animated logo. The rule's fix (drop aria-hidden) would make a
            screen reader announce an unlabeled canvas, i.e. strictly worse. */}
      <canvas ref={canvasRef} width={352} height={352} className="mb-2 block size-16 rounded-full" aria-hidden="true" />
      <div className="text-xl font-semibold">dot</div>
      <div className="text-muted-foreground flex min-h-6 flex-wrap items-center justify-center gap-1 text-sm">
        {info && (
          <>
            <span>{t('aboutVersion', { version: info.version })}</span>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t('aboutCopyVersion')} onClick={copyVersion} />}>
                <Copy />
              </TooltipTrigger>
              <TooltipContent>{t('aboutCopyVersion')}</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}

export function AboutDialog({ open, onOpenChange, finalFocus }: { open: boolean; onOpenChange: (open: boolean) => void; finalFocus: RefObject<HTMLButtonElement | null> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent finalFocus={finalFocus} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('aboutTitle')}</DialogTitle>
          <DialogDescription className="sr-only">{t('aboutDescription')}</DialogDescription>
        </DialogHeader>
        <AboutContent />
      </DialogContent>
    </Dialog>
  );
}
