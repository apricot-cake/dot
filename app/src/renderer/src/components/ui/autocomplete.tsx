import * as React from 'react';
import { Autocomplete as AutocompletePrimitive } from '@base-ui/react/autocomplete';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { setSelectOpen } from '../../services/open-select-registry.ts';

// 自由入力の候補表示。選択値を持つ Combobox とは Root の意味を分け、
// 入力欄と候補面は同じ shadcn/Base UI の部品で組み立てる。
function Autocomplete<Item>({ onOpenChange, ...props }: Omit<AutocompletePrimitive.Root.Props<Item>, 'items'> & { items?: readonly Item[] }) {
  const id = React.useRef(Symbol('autocomplete'));
  React.useEffect(() => () => setSelectOpen(id.current, false), []);
  React.useEffect(() => {
    if (props.open !== undefined) setSelectOpen(id.current, props.open);
  }, [props.open]);
  return (
    <AutocompletePrimitive.Root
      {...props}
      onOpenChange={(open, details) => {
        setSelectOpen(id.current, open);
        onOpenChange?.(open, details);
      }}
    />
  );
}

function AutocompleteInput({ className, inGroup = false, ...props }: AutocompletePrimitive.Input.Props & { inGroup?: boolean }) {
  return <AutocompletePrimitive.Input data-slot={inGroup ? 'input-group-control' : 'autocomplete-input'} render={inGroup ? <InputGroupInput /> : <Input />} className={className} {...props} />;
}

function AutocompleteInputGroup({ className, ...props }: AutocompletePrimitive.InputGroup.Props) {
  return <AutocompletePrimitive.InputGroup render={<InputGroup />} className={className} {...props} />;
}

function AutocompleteClear({ className, children, ...props }: AutocompletePrimitive.Clear.Props) {
  return (
    <AutocompletePrimitive.Clear data-slot="autocomplete-clear" render={<InputGroupButton variant="ghost" size="icon-xs" />} className={className} {...props}>
      {children ?? <XIcon />}
    </AutocompletePrimitive.Clear>
  );
}

function AutocompleteContent({ className, side = 'bottom', sideOffset = 4, align = 'start', alignOffset = 0, anchor, ...props }: AutocompletePrimitive.Popup.Props & Pick<AutocompletePrimitive.Positioner.Props, 'side' | 'sideOffset' | 'align' | 'alignOffset' | 'anchor'>) {
  return (
    <AutocompletePrimitive.Portal>
      <AutocompletePrimitive.Positioner side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset} anchor={anchor} collisionPadding={8} className="isolate z-[13500]">
        <AutocompletePrimitive.Popup
          data-slot="autocomplete-content"
          className={cn(
            'font-sans group/autocomplete-content max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        />
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  );
}

function AutocompleteList({ className, ...props }: AutocompletePrimitive.List.Props) {
  return <AutocompletePrimitive.List data-slot="autocomplete-list" className={cn('max-h-[min(18rem,var(--available-height))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0', className)} {...props} />;
}

function AutocompleteItem({ className, ...props }: AutocompletePrimitive.Item.Props) {
  return (
    <AutocompletePrimitive.Item
      data-slot="autocomplete-item"
      className={cn('relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50', className)}
      {...props}
    />
  );
}

function AutocompleteEmpty({ className, ...props }: AutocompletePrimitive.Empty.Props) {
  return <AutocompletePrimitive.Empty data-slot="autocomplete-empty" className={cn('px-3 py-2 text-center text-sm text-muted-foreground empty:hidden', className)} {...props} />;
}

export { Autocomplete, AutocompleteInput, AutocompleteInputGroup, AutocompleteClear, AutocompleteContent, AutocompleteList, AutocompleteItem, AutocompleteEmpty };
