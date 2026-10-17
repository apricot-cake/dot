import { useRef, useEffect, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../../_shared/i18n.ts';
import { dotIpc } from '../../services/ipc.ts';
import { notify } from '../../services/ui.ts';
import * as ipc from '../ipc.ts';
import { mount as mountAboutIcon } from '../../services/about-icon.ts';
import type { AppInfo } from '../../../../main/ipc-payloads.ts';

// このアプリについて: 生きたホログラムのアイコン、名前、バージョン、報告への導線だけを置く。
// ランタイムと OS の情報は画面に出さず、不具合報告に貼るためのコピーにだけ含める。
// ライセンスはパッケージに同梱し、詳しく知りたい人はリポジトリを見る。
const FEEDBACK_URL = 'https://github.com/apricot-cake/dot/issues/new/choose';

function versionReport(info: AppInfo): string {
  return [`dot ${info.version}`, `Electron ${info.electron} / Chromium ${info.chromium} / Node ${info.node}`, info.os].join('\n');
}

export function About() {
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
      .then(() => notify(t('aboutVersionCopied')))
      .catch(() => {});
  };

  return (
    // 1ページ表示では Section が残りの高さを渡すので、内容の少ないこの節は縦方向にも中央へ寄せる。
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-6 text-center">
      <div className="mb-2">
        {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: a <canvas> is only focusable
            through fallback CONTENT (interactive children), and this one has none — it
            is a decorative animated logo. The rule's fix (drop aria-hidden) would make a
            screen reader announce an unlabeled canvas, i.e. strictly worse. */}
        <canvas ref={canvasRef} width={352} height={352} className="size-24 rounded-full" aria-hidden="true" />
      </div>
      <div className="text-2xl font-semibold tracking-tight">dot</div>
      <div className="text-muted-foreground flex h-6 items-center gap-1 text-sm">
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
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground mt-3"
        render={
          <a
            href={FEEDBACK_URL}
            onClick={(e) => {
              e.preventDefault();
              ipc.openExternal(FEEDBACK_URL);
            }}
          />
        }
      >
        {t('aboutLinkFeedback')}
        <ExternalLink aria-hidden="true" />
      </Button>
    </div>
  );
}
