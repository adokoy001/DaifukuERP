// A selection must belong to the currently displayed search, including its debounce and network wait.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useRecord, useRefSearch } from '../../api/queries.ts';
import type { RecordJson } from '../../api/types.ts';
import { useLocale } from '../../i18n.tsx';
import { S } from '../../strings.ts';
import type { WidgetProps } from './inputs.tsx';
import { RefOptions, refLabel } from './ref-options.tsx';

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebounced(value), ms);
    return () => globalThis.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
function useOutsideClose(ref: React.RefObject<HTMLDivElement | null>, close: () => void) {
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [ref, close]);
}
interface KeyboardOptions {
  open: boolean;
  active: number;
  items: RecordJson[];
  setOpen: (open: boolean) => void;
  setActive: (index: number) => void;
  pick: (row: RecordJson) => void;
}
function candidateKey(event: KeyboardEvent<HTMLInputElement>, state: KeyboardOptions): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    state.setOpen(true);
    if (!state.items.length) return;
    const next =
      event.key === 'ArrowDown'
        ? Math.min(state.active + 1, state.items.length - 1)
        : state.active < 0
          ? state.items.length - 1
          : Math.max(0, state.active - 1);
    state.setActive(next);
  } else if (event.key === 'Enter' && state.open) {
    event.preventDefault();
    const row = state.items[Math.max(0, state.active)];
    if (row) state.pick(row);
  } else if (event.key === 'Escape' && state.open) {
    event.preventDefault();
    event.stopPropagation();
    state.setOpen(false);
  }
}
export function RefField({ id, field, value, onChange, onSelectRecord, disabled, invalid, ariaLabel }: WidgetProps) {
  const { t } = useLocale();
  const listId = useId();
  const selectedId = typeof value === 'string' ? value : '';
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(text, 250);
  const current = useRecord(field.ref ?? '', selectedId || undefined);
  const results = useRefSearch(field.ref, debounced, open);
  const waiting = text !== debounced || results.isFetching || results.isPending;
  const ready = !waiting && results.isSuccess && !results.isPlaceholderData;
  const items = ready ? results.data.items : [];
  const activeIndex = Math.min(active, items.length - 1);
  useOutsideClose(wrap, () => setOpen(false));
  useEffect(() => {
    if (open && activeIndex >= 0)
      document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, listId]);
  const pick = (row: RecordJson) => {
    if (!ready || disabled || !items.some((item) => item.id === row.id)) return;
    if (onSelectRecord) onSelectRecord(row);
    else onChange(row.id);
    setText('');
    setActive(-1);
    setOpen(false);
  };
  const shown = open
    ? text
    : selectedId
      ? refLabel(current.data, field.refDisplayField) || (current.isPending ? '…' : selectedId)
      : '';
  return (
    <div
      ref={wrap}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="flex gap-1">
        <input
          id={id}
          name={field.name}
          type="text"
          role="combobox"
          aria-expanded={open && !disabled}
          aria-controls={open && !disabled ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-invalid={invalid}
          aria-label={ariaLabel}
          autoComplete="off"
          className={`input ${invalid ? 'input-error' : ''}`}
          placeholder={t(S.refSearch)}
          value={shown}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setActive(-1);
          }}
          onChange={(event) => {
            setText(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => candidateKey(event, { open, active: activeIndex, items, setOpen, setActive, pick })}
        />
        {selectedId && !disabled ? (
          <button
            type="button"
            className="btn px-2"
            aria-label={t(S.clear)}
            onClick={() => {
              onChange('');
              setText('');
              setActive(-1);
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {open && !disabled ? (
        <RefOptions
          listId={listId}
          field={field}
          items={items}
          pending={waiting}
          failed={!waiting && results.isError}
          active={activeIndex}
          selectedId={selectedId}
          onHover={setActive}
          onPick={pick}
          onRetry={() => {
            wrap.current?.querySelector('input')?.focus();
            void results.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
