import { useState, useSyncExternalStore } from 'react';
import { FolderOpen, FolderX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { pickRepointFolder, applyRepoint } from '../services/library-path.ts';
import { notify } from '../services/ui.ts';
import { store, subscribeKey } from '../services/store.ts';

const subMissing = (cb: () => void) => subscribeKey('libraryMissing', cb);
const getMissing = () => store.getState().libraryMissing;
const subPath = (cb: () => void) => subscribeKey('libraryMissingPath', cb);
const getPath = () => store.getState().libraryMissingPath;

function recoveryError(code?: string) {
  switch (code) {
    case 'no-library':
    case 'not-a-library':
      return t('libraryMissingNoLibrary');
    case 'invalid-library':
    case 'open-failed':
      return t('libraryMissingInvalidLibrary');
    case 'incompatible-db':
      return t('libraryMissingIncompatibleLibrary');
    case 'not-readable':
      return t('libraryMissingNotReadable');
    case 'not-writable':
      return t('saveFolderErrNotWritable');
    case 'config-overlap':
      return t('saveFolderErrOverlap');
    case 'busy':
      return t('libraryMissingBusy');
    default:
      return t('saveFolderErrGeneric');
  }
}

export function LibraryMissingState() {
  const missing = useSyncExternalStore(subMissing, getMissing);
  const path = useSyncExternalStore(subPath, getPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!missing) return null;
  const pathSplit = path ? Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1 : 0;

  const repoint = async () => {
    setBusy(true);
    setError(null);
    try {
      const selection = await pickRepointFolder();
      if (!selection || selection.canceled) return;
      if (!selection.ok || !selection.dest) {
        setError(recoveryError(selection.error));
        return;
      }
      const result = await applyRepoint(selection.dest);
      if (!result.ok) {
        setError(recoveryError(result.error));
        return;
      }
      store.setState({ libraryMissing: false, libraryMissingPath: null });
      notify(t('libraryMissingRepointDone'));
    } catch {
      setError(t('saveFolderErrGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Empty data-slot="library-missing" className="min-h-full py-8">
      <EmptyHeader className="min-w-0 max-w-[min(100%,36rem)]">
        <EmptyMedia className="text-muted-foreground">
          <FolderX className="size-16" />
        </EmptyMedia>
        <EmptyTitle className="text-[1.25rem] leading-7">{t('libraryMissingTitle')}</EmptyTitle>
        {path && (
          <Tooltip>
            <TooltipTrigger
              render={
                <code className="bg-[var(--sidebar-active)] text-foreground mt-2 flex w-fit max-w-full min-w-0 rounded-lg px-3 py-2 font-mono text-[.875rem] leading-relaxed text-left whitespace-nowrap">
                  <span className="min-w-0 truncate">{path.slice(0, pathSplit)}</span>
                  <span className="flex max-w-[calc(100%-3ch)] shrink-0 justify-end overflow-hidden">
                    <span className="shrink-0">{path.slice(pathSplit)}</span>
                  </span>
                </code>
              }
            />
            <TooltipContent className="max-w-xl break-all font-mono">{path}</TooltipContent>
          </Tooltip>
        )}
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="lg" className="px-4 text-[.875rem]" onClick={() => void repoint()} disabled={busy} aria-busy={busy}>
          <FolderOpen className="size-5" />
          {t('libraryMissingRepoint')}
        </Button>
        {error && (
          <p role="alert" className="text-destructive text-sm/relaxed">
            {error}
          </p>
        )}
      </EmptyContent>
    </Empty>
  );
}
