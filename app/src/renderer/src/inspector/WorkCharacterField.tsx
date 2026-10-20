import { useEffect, useId, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from '@/components/ui/combobox';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { TagVocabRow } from '../../../main/ipc-payloads.ts';
import type { TagAssignment } from '../../../shared/tag-classification.ts';
import { dotIpc } from '../services/ipc.ts';
import { onChange } from '../services/tags.ts';
import { t } from '../_shared/i18n.ts';
import { normalizeTagName, tagNameInputIsSafe } from '../../../../../native-host/tag-normalize.mts';
import { filterTagRows } from './tag-search.ts';

type Row = TagVocabRow;
type Edit = { name: string; category: 'general' | 'work' | 'character'; workId: number | null; id?: number; replaceWorkId?: number | null };

const normalizeTypedTagName = (name: string) => (tagNameInputIsSafe(name) ? normalizeTagName(name) : '');

function Picker({
  label,
  rows,
  selected,
  multiple,
  disabled,
  onPick,
  onCreate,
  onEdit,
  children,
  chips,
}: {
  label: string;
  rows: Row[];
  selected: number[];
  multiple?: boolean;
  disabled: boolean;
  onPick: (row: Row) => Promise<void>;
  onCreate: (name: string) => void;
  onEdit?: (row: Row) => void;
  children: React.ReactNode;
  chips?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const anchor = useRef<HTMLDivElement>(null);
  const matches = filterTagRows(rows, query);
  const createName = !matches.length ? normalizeTypedTagName(query) : '';
  const selectedValues = selected.map(String);
  const items = createName ? ['create'] : matches.map((row) => String(row.id));
  return (
    <Combobox<string, boolean>
      multiple={!!multiple}
      value={multiple ? selectedValues : (selectedValues[0] ?? null)}
      items={items}
      filter={null}
      disabled={disabled}
      open={open}
      inputValue={query}
      onInputValueChange={setQuery}
      itemToStringLabel={(value) => (value === 'create' ? t('classificationCreate', { name: createName }) : (rows.find((row) => String(row.id) === value)?.name ?? ''))}
      onValueChange={(value) => {
        const values = Array.isArray(value) ? value : value === null ? [] : [value];
        if (values.includes('create')) {
          setOpen(false);
          onCreate(createName);
          return;
        }
        const changed = multiple ? [...values, ...selectedValues].find((id) => values.includes(id) !== selectedValues.includes(id)) : values[0];
        const row = rows.find((item) => String(item.id) === changed);
        if (row) void onPick(row);
      }}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setQuery('');
      }}
    >
      <div ref={anchor} className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border bg-background p-1">
        {chips}
        <ComboboxTrigger render={<Button variant="ghost" disabled={disabled} aria-label={label} className="h-auto min-h-7 min-w-0 flex-1 justify-between whitespace-normal text-left" />}>{children}</ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchor} align="start" className="min-w-60">
        <div className="p-1">
          <ComboboxInput autoFocus showTrigger={false} aria-label={label} placeholder={t('classificationSearch')} />
        </div>
        <ComboboxList>
          {matches.map((row) => (
            <ComboboxItem
              key={row.id}
              value={String(row.id)}
              disabled={disabled}
              onContextMenu={(event) => {
                if (onEdit && !disabled) {
                  event.preventDefault();
                  setOpen(false);
                  onEdit(row);
                }
              }}
            >
              <span className="min-w-0 break-words">
                {row.name}
                {row.displayName !== row.name && <span className="block text-xs text-muted-foreground">{row.displayName}</span>}
              </span>
            </ComboboxItem>
          ))}
          {createName && (
            <ComboboxItem value="create" disabled={disabled}>
              <Plus />
              {t('classificationCreate', { name: createName })}
            </ComboboxItem>
          )}
          {!matches.length && !query && <div className="p-3 text-xs text-muted-foreground">{t('classificationTypeToCreate')}</div>}
        </ComboboxList>
        {multiple && (
          <div className="flex justify-end border-t p-1">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('classificationClose')}
            </Button>
          </div>
        )}
      </ComboboxContent>
    </Combobox>
  );
}

function TagCombobox({ label, emptyLabel, rows, value, disabled, onValueChange }: { label: string; emptyLabel: string; rows: Row[]; value: number | null; disabled: boolean; onValueChange: (value: number | null) => void }) {
  const id = useId();
  const options = ['', ...rows.map((row) => String(row.id))];
  const getLabel = (value: string) => rows.find((row) => String(row.id) === value)?.displayName ?? emptyLabel;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id}>{label}</label>
      <Combobox items={options} value={value === null ? '' : String(value)} disabled={disabled} itemToStringLabel={getLabel} onValueChange={(value) => onValueChange(value ? Number(value) : null)}>
        <ComboboxInput id={id} aria-label={label} />
        <ComboboxContent>
          <ComboboxEmpty>{t('fpNoResults')}</ComboboxEmpty>
          <ComboboxList>
            {(value: string) => (
              <ComboboxItem key={value} value={value}>
                {getLabel(value)}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

export function WorkCharacterField({ postIds, rows, reload }: { postIds: string[]; rows: Row[]; reload: () => Promise<void> }) {
  const categoryId = useId();
  const [assignments, setAssignments] = useState<TagAssignment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [extra, setExtra] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [undo, setUndo] = useState<TagAssignment[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const value = await dotIpc.getClassifiedAssignments(postIds);
      if (alive) setAssignments(value);
    };
    void load().catch(() => {
      if (alive) setError(true);
    });
    const unsub = onChange(() => {
      void load().catch(() => {});
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [postIds]);
  const works = rows.filter((row) => row.category === 'work');
  const characters = rows.filter((row) => row.category === 'character');
  const selectedIds = [...new Set(assignments.flatMap((a) => a.tagIds))];
  const selectedCharacters = characters.filter((row) => selectedIds.includes(row.id));
  const workIds = [...new Set([...works.filter((row) => selectedIds.includes(row.id)).map((row) => row.id), ...selectedCharacters.flatMap((row) => (row.workId ? [row.workId] : []))])];
  const groups: Array<number | null> = [...workIds];
  if (!groups.length || extra || selectedCharacters.some((row) => !row.workId)) groups.push(null);

  async function apply(mutate: (ids: number[]) => number[]) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const previous = await dotIpc.getClassifiedAssignments(postIds);
      const next = previous.map((a) => ({ ...a, tagIds: [...new Set(mutate(a.tagIds))] }));
      await dotIpc.setClassifiedAssignments(next);
      setAssignments(next);
      setUndo(previous);
      setExtra(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const toggleCharacter = (row: Row) => apply((ids) => (selectedIds.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id]));
  const editRow = (row: Row) => setEdit({ id: row.id, name: row.name, category: row.category || 'general', workId: row.workId ?? null });

  return (
    <section className="flex shrink-0 flex-col gap-4" aria-label={t('classificationHeading')}>
      {groups.map((workId, index) => {
        const work = works.find((row) => row.id === workId);
        const selected = selectedCharacters.filter((row) => (row.workId ?? null) === workId);
        const candidates = characters.filter((row) => workId === null || row.workId === workId).map((row) => ({ ...row, displayName: works.find((w) => w.id === row.workId)?.name || t('classificationNoWork') }));
        return (
          <div key={index} className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span>{t('classificationWork')}</span>
              {work && (
                <Button variant="ghost" size="icon-xs" aria-label={t('classificationRemoveWork')} disabled={busy} onClick={() => void apply((ids) => ids.filter((id) => id !== workId && !characters.some((c) => c.id === id && c.workId === workId)))}>
                  <X />
                </Button>
              )}
            </div>
            <Picker
              label={t('classificationWork')}
              rows={works.filter((row) => row.id === workId || !workIds.includes(row.id))}
              selected={workId ? [workId] : []}
              disabled={busy}
              onEdit={editRow}
              onCreate={(name) => setEdit({ name, category: 'work', workId: null, replaceWorkId: workId })}
              onPick={(row) => apply((ids) => [...ids.filter((id) => id !== workId && !characters.some((c) => c.id === id && c.workId === workId && workId !== null)), row.id])}
            >
              {work?.name || t('classificationSelectWork')}
            </Picker>
            <div className="mt-1 text-sm">{t('classificationCharacter')}</div>
            <Picker
              label={t('classificationCharacter')}
              multiple
              rows={candidates}
              selected={selectedIds}
              disabled={busy}
              onEdit={editRow}
              onPick={toggleCharacter}
              onCreate={(name) => setEdit({ name, category: 'character', workId })}
              chips={selected.map((row) => (
                <span
                  key={row.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    editRow(row);
                  }}
                >
                  <span className="break-words">{row.name}</span>
                  <Button type="button" variant="ghost" size="icon-xs" className="size-4" disabled={busy} aria-label={t('classificationRemove', { name: row.name })} onClick={() => void toggleCharacter(row)}>
                    <X className="size-3" />
                  </Button>
                </span>
              ))}
            >
              {selected.length ? null : t('classificationSelectCharacter')}
            </Picker>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        {!!workIds.length && !extra && (
          <Button variant="ghost" size="sm" onClick={() => setExtra(true)}>
            <Plus />
            {t('classificationAnotherWork')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setEdit({ name: '', category: 'general', workId: null })}>
          {t('classificationManage')}
        </Button>
        {undo && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await dotIpc.setClassifiedAssignments(undo);
                setAssignments(undo);
                setUndo(null);
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('classificationUndo')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t('tagMgmtErrorGeneric')}
        </p>
      )}
      {edit && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setEdit(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('classificationManage')}</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy || !normalizeTypedTagName(edit.name)) return;
                setBusy(true);
                setError(false);
                try {
                  const existing = !edit.id ? rows.filter((row) => row.name === normalizeTypedTagName(edit.name) && (!row.category || row.category === 'general')) : [];
                  const id = await dotIpc.saveClassifiedTag({ ...edit, id: edit.id ?? (existing.length === 1 ? existing[0].id : undefined) });
                  if (!edit.id && edit.category !== 'general') {
                    const prev = await dotIpc.getClassifiedAssignments(postIds);
                    const next = prev.map((a) => ({ ...a, tagIds: [...new Set([...a.tagIds.filter((existingId) => !edit.replaceWorkId || (existingId !== edit.replaceWorkId && !characters.some((c) => c.id === existingId && c.workId === edit.replaceWorkId))), id])] }));
                    await dotIpc.setClassifiedAssignments(next);
                    setAssignments(next);
                    setUndo(prev);
                  }
                  await reload();
                  setEdit(null);
                } catch {
                  setError(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <TagCombobox
                label={t('classificationExisting')}
                emptyLabel={t('classificationNew')}
                rows={rows.map((row) => ({ ...row, displayName: row.workId ? `${row.name} — ${works.find((work) => work.id === row.workId)?.name || ''}` : row.name }))}
                value={edit.id ?? null}
                disabled={busy}
                onValueChange={(value) => {
                  const row = rows.find((row) => row.id === value);
                  if (row) editRow(row);
                  else setEdit({ name: '', category: edit.category, workId: edit.workId });
                }}
              />
              <label htmlFor="classified-tag-name" className="flex flex-col gap-2">
                {t('tagName')}
                <Input id="classified-tag-name" value={edit.name} autoFocus disabled={busy} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </label>
              <div className="flex flex-col gap-2">
                <label htmlFor={categoryId}>{t('classificationType')}</label>
                <Select
                  disabled={busy}
                  value={edit.category}
                  items={{ general: t('classificationOther'), work: t('classificationWork'), character: t('classificationCharacter') }}
                  onValueChange={(value) => {
                    if (value) setEdit({ ...edit, category: value, workId: null });
                  }}
                >
                  <SelectTrigger id={categoryId} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="general">{t('classificationOther')}</SelectItem>
                      <SelectItem value="work">{t('classificationWork')}</SelectItem>
                      <SelectItem value="character">{t('classificationCharacter')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              {edit.category === 'character' && <TagCombobox label={t('classificationWork')} emptyLabel={t('classificationNoWork')} rows={works.map((row) => ({ ...row, displayName: row.name }))} value={edit.workId} disabled={busy} onValueChange={(value) => setEdit({ ...edit, workId: value })} />}
              {error && (
                <p role="alert" className="text-destructive">
                  {t('tagMgmtErrorGeneric')}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" type="button" disabled={busy} onClick={() => setEdit(null)}>
                  {t('tagMgmtCancel')}
                </Button>
                <Button type="submit" disabled={busy || !normalizeTypedTagName(edit.name)}>
                  {t('classificationSave')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
