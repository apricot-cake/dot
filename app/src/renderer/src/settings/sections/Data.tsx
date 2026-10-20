import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Highlight } from '../components/Highlight.tsx';
import { SettingRow } from '../components/SettingRow.tsx';
import { SettingsGroup } from '../components/SettingsGroup.tsx';
import { toast } from 'sonner';
import { t } from '../../_shared/i18n.ts';
import { notify, notifyProgress } from '../../services/ui.ts';
import { getExportReminder, setExportReminderEnabled, setExportReminderThreshold, getIntegrityStatus, runOrphanRecovery, onIntegrityCheckDone, onExportReminderChanged } from '../../services/backup.ts';
import { createBackupFile } from '../../services/backup-file.ts';
import { onExportProgress, onSaveFolderProgress, pickSaveFolder, moveSaveFolder, exportComplete, importImages } from '../../services/posts.ts';
import { loadPosts } from '../../services/post-grid-builder.ts';
import { runZipImport } from '../../services/zip-import.ts';
import type { ExportReminderState, IntegrityStatus, SaveFolderProgress } from '../../../../main/ipc-payloads.ts';

// ブリッジが無い状態での呼び出しは例外を投げ、呼び出し側の try/catch に落ちる。型の無い
// 元のコードと同じ＝{} の代わりは、素の開発サーバーのためだけに存在する。
const dot = (): DotPreload => window.dot || ({} as DotPreload);
const reloadPosts = () => {
  if (loadPosts) loadPosts();
};

// save-folder-progress / get-integrity-status の
// payload は共有の IPC の取り決め（#228）＝このコンポーネントは以前、4つとも手書きの
// 写しを自分で持っていた。あの取り決めが止めようとしているのは、まさにそのずれ。

// preload の on* ブリッジは呼ばれるたびに新しい ipcRenderer のリスナーを付け、外す手段を
// 持たない。しかもこのコンポーネントはモーダルが開くたびに載せ直る。だから下地の IPC の
// リスナーの登録は1回だけにして、生きている React の購読者の集合へ配る＝effect は自分を
// 出し入れするだけで、IPC を購読し直すことは一切しない。
const progressSubs = new Set<(p: SaveFolderProgress) => void>();
const integritySubs = new Set<(s: IntegrityStatus) => void>();
const reminderSubs = new Set<(s: ExportReminderState) => void>();
let ipcWired = false;
function wireIpcOnce() {
  if (ipcWired) return;
  ipcWired = true;
  try {
    onSaveFolderProgress((p) => progressSubs.forEach((cb) => cb(p)));
  } catch {
    /* 素の開発サーバー: dotPosts の裏に preload のブリッジが無い */
  }
  try {
    onIntegrityCheckDone((s: IntegrityStatus) => integritySubs.forEach((cb) => cb(s)));
  } catch {
    /* 素の開発サーバー: dotBackup の裏に preload のブリッジが無い */
  }
  try {
    onExportReminderChanged((state: ExportReminderState) => reminderSubs.forEach((cb) => cb(state)));
  } catch {
    /* preload のブリッジがない環境 */
  }
}

// 移行のエラーコード → メッセージのキー。viewer.js の setupSaveFolder.errMsg に忠実。
const saveFolderErr = (code?: string) => {
  switch (code) {
    case 'same':
      return t('saveFolderErrSame');
    case 'nested':
      return t('saveFolderErrNested');
    case 'config-overlap':
      return t('saveFolderErrOverlap');
    case 'collision':
      return t('saveFolderErrCollision');
    case 'copy-failed':
      return t('saveFolderErrCopyFailed');
    case 'not-writable':
      return t('saveFolderErrNotWritable');
    // #37: 今の保存先フォルダがディスク上に無い＝そこから複写する移動は、はなから
    // 拒む。抜け道はこのダイアログの変更ボタンではなく、内容の列にある指し直しの
    // ボタン。
    case 'library-missing':
      return t('saveFolderErrLibraryMissing');
    default:
      return t('saveFolderErrGeneric');
  }
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtTime = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// 長い保存先も省略せず折り返す。
function LibraryPath({ children }: { children?: string | null }) {
  return <code className="text-muted-foreground block min-w-0 font-mono text-sm leading-relaxed break-all">{children}</code>;
}

// データ: 保存先フォルダ、書き出しと取り込み、ローカル復旧、エクスポート通知。
export function Data() {
  // --- 保存先フォルダ ---
  const [saveFolder, setSaveFolder] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; log: string[] } | null>(null); // 移動の最中と、その後

  const [exportReminder, setExportReminder] = useState<ExportReminderState | null>(null);
  // --- 整合性（#301） ---
  const [integrity, setIntegrity] = useState<IntegrityStatus | null>(null);
  const [recovering, setRecovering] = useState(false);

  // モーダルは開くたびに載せ直るので、現在の状態をその都度読む。
  useEffect(() => {
    Promise.resolve(dot().getConfig ? dot().getConfig() : null)
      .then((cfg) => setSaveFolder((cfg && cfg.saveFolder) || ''))
      .catch(() => {});
    Promise.resolve(getExportReminder())
      .then((state) => setExportReminder(state || null))
      .catch(() => {});
    Promise.resolve(getIntegrityStatus())
      .then((s) => setIntegrity(s || null))
      .catch(() => {});
  }, []);

  // 移行の進み具合を実時間で伝えるイベント。複写の百分率はバーだけを動かし、ログの行は
  // 段階の節目（開始 / 切り替え / 掃除 / 完了）＝「…20%」の垂れ流しはしない。
  useEffect(() => {
    wireIpcOnce();
    const onProg = (p: SaveFolderProgress) => {
      if (!p) return;
      setProgress((prev) => {
        const log = prev ? prev.log.slice() : [];
        let pct = prev ? prev.pct : 0;
        if (p.phase === 'copy') {
          if (p.done === 0) log.push(t('logCopyStart', { count: p.total }));
          pct = p.percent as number; // 'copy' のイベントには必ず入っている
        } else if (p.phase === 'switch') {
          pct = 100;
          log.push(t('logSwitch'));
        } else if (p.phase === 'cleanup') {
          log.push(t('logCleanup'));
        } else if (p.phase === 'done') {
          pct = 100;
          log.push(t('logMoveDone', { count: p.moved }));
          if ((p.leftover as number) > 0) log.push(t('logLeftover', { count: p.leftover }));
        } else if (p.phase === 'straggler') {
          log.push(t('logStraggler', { count: p.moved }));
        } else if (p.phase === 'error') {
          log.push(saveFolderErr(p.error));
        }
        return { pct, log };
      });
    };
    progressSubs.add(onProg);
    return () => {
      progressSubs.delete(onProg);
    };
  }, []);

  // 選択と移動の往復の結果を反映する（どちらも同じ形を返す）。
  const applyMoveResult = (res: any) => {
    if (res && res.ok) {
      setSaveFolder(res.saveFolder);
      notify(t('saveFolderMoved', { count: res.moved }));
      reloadPosts();
    } else {
      notify(saveFolderErr(res && res.error));
    }
  };

  const chooseSaveFolder = async () => {
    setMigrating(true);
    setProgress(null); // 箱は最初の進み具合のイベントで現れる（フォルダを選んだ後）
    try {
      const res = await pickSaveFolder();
      if (!res || res.canceled) {
        setProgress(null);
        return;
      }
      // クラウド同期の警告と承認は main 所有のネイティブ UI で既に完了している。
      // renderer は移動先を受け取らず、同じ WebContents の一回限りの許可だけを消費する。
      if (res.confirm === 'cloud-sync') {
        applyMoveResult(await moveSaveFolder());
        return;
      }
      applyMoveResult(res);
    } catch {
      notify(t('saveFolderErrGeneric'));
    } finally {
      setMigrating(false);
    }
  };

  // --- 書庫を書き出す ---
  // main 側の呼び出し1つに対してボタンが2つある。#233 が、以前の「Export ZIP」という
  // 操作部品1つが混ぜていた2つの語を分けたから＝バックアップのファイルはライブラリ全体と
  // その整理を合わせたもので、復元されるために作る。書き出しは他の何かへ渡すメディア。
  // `mode` は main が元から受け取っていたもの（'full' / 'images'）なので、この分割は UI の
  // 語彙であって2本目のコード経路ではない（#57 の「手動の完全 ZIP はバックアップの下へ
  // 移すが、実装はそのまま」）。
  const [exportIncludeTrash, setExportIncludeTrash] = useState(false); // #300/St7: 明示的に選ぶ方式で、既定は off
  const writeArchive = async (mode: 'full' | 'images') => {
    if (mode === 'full') {
      const result = await createBackupFile(exportIncludeTrash);
      if (result?.saved) {
        setExportReminder(await getExportReminder());
      }
      return;
    }
    // 貼り付いたままの読み込み中のトーストが、ディスクへ流し込んだ百分率を実時間で見せる
    // （main の 'export-progress' を onExportProgress 経由で受ける）。保存ダイアログの
    // 待ち時間もこれで覆う。
    const id = 'dot-export';
    notifyProgress(t('exporting'), '0%', id);
    const off = onExportProgress((p) => {
      if (!p || p.done) return;
      notifyProgress(t('exporting'), `${p.pct ?? 0}%`, id);
    });
    try {
      const res = await exportComplete(mode, false);
      off();
      toast.dismiss(id);
      if (res && res.saved) notify(t('exported'));
      else if (res && res.empty) notify(t('noData'));
      else if (res && res.error) notify(t('exportFailed'));
      // ダイアログを取り消した場合（res.saved が false で、empty も error も無い）: トースト
      // は既に閉じてある。
    } catch {
      off();
      toast.dismiss(id);
      notify(t('exportFailed'));
    }
  };

  // --- ZIP の取り込み ---（新しい完全な形式と、旧来の metadata.json + images/）
  // 流れそのものは services/zip-import.ts にあり、空状態の CTA と共有している＝この節が
  // 持つのはボタンだけ。

  // --- メディアの取り込み（任意のローカルの画像・動画のファイル） ---
  const importMedia = async () => {
    try {
      const res = await importImages();
      if (!res || res.canceled) return;
      // #37: 保存先フォルダが無い間、main は拒む（ipc-transfer.ts の import-images の
      // 防ぎを参照）＝「0件取り込んだ」と報せるのではなく、そのことを見せる。
      if (res.error) {
        notify(res.error === 'library-missing' ? t('saveFolderErrLibraryMissing') : t('importFailed'));
        return;
      }
      reloadPosts();
      if (res.skipped > 0) notify(t('importSkipped', { count: res.imported, skipped: res.skipped }));
      else notify(t('imported', { count: res.imported }));
    } catch {
      notify(t('importFailed'));
    }
  };

  // --- 整合性のイベント: 起動時の検査が終わったら更新する ---
  useEffect(() => {
    wireIpcOnce();
    const onDone = (s: IntegrityStatus) => setIntegrity(s || null);
    integritySubs.add(onDone);
    reminderSubs.add(setExportReminder);
    return () => {
      integritySubs.delete(onDone);
      reminderSubs.delete(setExportReminder);
    };
  }, []);

  const recoverOrphans = async () => {
    setRecovering(true);
    try {
      const res = await runOrphanRecovery();
      if (res && res.ok) {
        notify(t('integrityRecovered', { count: res.recovered }));
        reloadPosts();
      }
      try {
        setIntegrity((await getIntegrityStatus()) || null);
      } catch {
        /* 無視する */
      }
    } catch {
      /* 無視する */
    } finally {
      setRecovering(false);
    }
  };

  return (
    <div className="space-y-6">
      {exportReminder?.due && (
        <section data-slot="backup-reminder" className="space-y-3 rounded-lg border border-blue-200/70 bg-blue-50/50 p-4 dark:border-blue-900/70 dark:bg-blue-950/20">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Badge aria-hidden="true" className="size-2 bg-blue-600 p-0 dark:bg-blue-400" />
              <Highlight text={t('exportReminderTitle')} />
            </h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              <Highlight text={t('exportReminderStatus', { count: exportReminder.changesSinceExport })} />
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              <Highlight text={t('exportReminderDismissHint')} />
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void writeArchive('full')}>{t('backupFileCreate')}</Button>
            <Button
              variant="outline"
              onClick={() =>
                void setExportReminderEnabled(false)
                  .then(setExportReminder)
                  .catch(() => {})
              }
            >
              {t('exportReminderDisable')}
            </Button>
          </div>
        </section>
      )}
      <SettingsGroup title={t('saveFolderSubTitle')} description={t('saveFolderHint')}>
        <div className="flex min-w-0 flex-col gap-3 py-4 @min-[32rem]/settings-content:flex-row @min-[32rem]/settings-content:items-center">
          <div className="min-w-0 flex-1">
            <LibraryPath>{saveFolder}</LibraryPath>
          </div>
          <Button variant="outline" onClick={chooseSaveFolder} disabled={migrating} className="self-start">
            {migrating ? t('saveFolderMoving') : t('saveFolderChange')}
          </Button>
        </div>
        {progress && (
          <div className="space-y-2.5 py-4">
            <div className="text-sm font-medium">{t('saveFolderProgressTitle')}</div>
            <div className="flex items-center gap-3">
              <Progress value={progress.pct} className="flex-1" />
              <span className="text-muted-foreground min-w-10 text-right text-xs tabular-nums">{progress.pct}%</span>
            </div>
            <div className="bg-muted text-muted-foreground max-h-36 overflow-y-auto rounded-md p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {progress.log.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        )}
      </SettingsGroup>
      <SettingsGroup title={t('exportSubTitle')}>
        <SettingRow label={t('exportZip')} hint={t('hintZip')} controlWidth="auto">
          <Button variant="outline" onClick={() => void writeArchive('images')}>
            {t('exportZip')}
          </Button>
        </SettingRow>
        <SettingRow label={t('importImages')} hint={t('hintMedia')} controlWidth="auto">
          <Button variant="outline" onClick={importMedia}>
            {t('importImages')}
          </Button>
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={t('backupSubTitle')} description={t('hintBackup')}>
        {!exportReminder?.due && (
          <SettingRow label={t('backupFileCreate')} hint={t('hintBackupFile')} controlWidth="auto">
            <Button variant="outline" onClick={() => void writeArchive('full')}>
              {t('backupFileCreate')}
            </Button>
          </SettingRow>
        )}
        <SettingRow label={t('importZip')} controlWidth="auto">
          <Button variant="outline" onClick={() => void runZipImport()}>
            {t('importZip')}
          </Button>
        </SettingRow>
        <SettingRow label={t('exportIncludeTrash')} controlId="export-include-trash" controlWidth="auto" inline>
          <Checkbox id="export-include-trash" checked={exportIncludeTrash} onCheckedChange={(v) => setExportIncludeTrash(v === true)} />
        </SettingRow>
        <SettingRow label={t('exportReminderEnabled')} hint={t('exportReminderHint')} controlId="export-reminder" controlWidth="auto" inline>
          <Switch
            id="export-reminder"
            checked={exportReminder?.enabled !== false}
            onCheckedChange={(enabled) => {
              void setExportReminderEnabled(enabled)
                .then(setExportReminder)
                .catch(() => {});
            }}
          />
        </SettingRow>
        <SettingRow label={t('exportReminderThreshold')} controlId="export-reminder-threshold">
          <Select
            value={String(exportReminder?.threshold ?? 100)}
            onValueChange={(value) => {
              const threshold = Number(value);
              void setExportReminderThreshold(threshold)
                .then(setExportReminder)
                .catch(() => {});
            }}
          >
            <SelectTrigger id="export-reminder-threshold" className="w-full" disabled={exportReminder?.enabled === false}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[25, 50, 100, 250].map((threshold) => (
                  <SelectItem key={threshold} value={String(threshold)}>
                    {t('exportReminderCount', { count: threshold })}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingRow>
        {exportReminder?.lastExportAt && <p className="text-muted-foreground py-4 text-sm">{t('exportReminderLast', { date: fmtTime(exportReminder.lastExportAt) })}</p>}
      </SettingsGroup>
      {integrity && (integrity.dbOk === false || (integrity.orphanCount ?? 0) > 0 || (integrity.missingCount ?? 0) > 0) && (
        <SettingsGroup title={t('integritySubTitle')} description={t('hintIntegrity')}>
          {integrity.dbOk === false && <p className="text-destructive py-4 text-sm">{`⚠ ${t('integrityDbBad')}`}</p>}
          {(integrity.orphanCount ?? 0) > 0 && (
            <SettingRow label={t('integrityOrphanLine', { count: integrity.orphanCount })} controlWidth="auto">
              <Button variant="outline" onClick={recoverOrphans} disabled={recovering}>
                {t('integrityRecoverBtn')}
              </Button>
            </SettingRow>
          )}
          {(integrity.missingCount ?? 0) > 0 && <p className="text-destructive py-4 text-sm">{`⚠ ${t('integrityMissingLine', { count: integrity.missingCount })}`}</p>}
          {integrity.lastCheckAt && <p className="text-muted-foreground py-4 text-sm">{t('integrityLastChecked', { date: fmtTime(integrity.lastCheckAt) })}</p>}
        </SettingsGroup>
      )}
    </div>
  );
}
