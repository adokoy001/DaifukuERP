// AC-4 ref widget: searchable select that queries `/api/<ref>?search=` and shows `refDisplayField`.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useRecord, useRefSearch } from '../../api/queries.ts';
import type { FieldMeta, RecordJson } from '../../api/types.ts';
import { useLocale } from '../../i18n.tsx';
import { S } from '../../strings.ts';
import type { WidgetProps } from './inputs.tsx';

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = globalThis.setTimeout(() => setV(value), ms);
    return () => globalThis.clearTimeout(h);
  }, [value, ms]);
  return v;
}

function displayOf(row: RecordJson | undefined, displayField: string | undefined): string {
  if (!row) return '';
  const v = displayField ? row[displayField] : undefined;
  const label = v ?? row.name ?? row.number ?? row.code;
  return typeof label === 'string' && label ? label : row.id.slice(0, 8);
}

/** Closes the dropdown on outside click. */
function useOutsideClose(ref: React.RefObject<HTMLDivElement | null>, close: () => void) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ref, close]);
}

interface OptionsProps {
  listId: string;
  field: FieldMeta;
  items: RecordJson[];
  pending: boolean;
  loaded: boolean;
  active: number;
  selectedId: string;
  onHover: (i: number) => void;
  onPick: (row: RecordJson) => void;
}

function RefOptions({ listId, field, items, pending, loaded, active, selectedId, onHover, onPick }: OptionsProps) {
  const { t } = useLocale();
  return (
    <ul id={listId} role="listbox" className="absolute z-20 mt-0.5 max-h-60 w-full overflow-y-auto rounded border border-neutral-300 bg-white shadow-lg">
      {pending ? <li className="px-2 py-1 text-xs text-neutral-500">{t(S.loading)}</li> : null}
      {loaded && items.length === 0 ? <li className="px-2 py-1 text-xs text-neutral-500">{t(S.refNoMatch)}</li> : null}
      {items.map((row, i) => (
        <li
          key={row.id}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={row.id === selectedId}
          className={`cursor-pointer px-2 py-1 ${i === active ? 'bg-sky-100' : 'hover:bg-neutral-100'} ${row.id === selectedId ? 'font-medium' : ''}`}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(row);
          }}
        >
          {displayOf(row, field.refDisplayField)}
          {typeof row.code === 'string' && row.code ? <span className="ml-2 font-mono text-xs text-neutral-500">{row.code}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function RefField({ id, field, value, onChange, onSelectRecord, disabled, invalid, ariaLabel }: WidgetProps) {
  const { t } = useLocale();
  const listId = useId();
  const selectedId = typeof value === 'string' ? value : '';
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(text, 250);
  const current = useRecord(field.ref ?? '', selectedId || undefined);
  const results = useRefSearch(field.ref, debounced, open);
  const items = results.data?.items ?? [];
  useOutsideClose(wrap, () => setOpen(false));

  const pick = (row: RecordJson) => {
    if (onSelectRecord) onSelectRecord(row);
    else onChange(row.id);
    setText('');
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(0, items.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      const row = items[active];
      if (row) pick(row);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };
  const shown = open ? text : selectedId ? displayOf(current.data, field.refDisplayField) || (current.isPending ? '…' : selectedId) : '';
  return (
    <div ref={wrap} className="relative">
      <div className="flex gap-1">
        <input
          id={id}
          name={field.name}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          aria-invalid={invalid}
          aria-label={ariaLabel}
          autoComplete="off"
          className={`input ${invalid ? 'input-error' : ''}`}
          placeholder={t(S.refSearch)}
          value={shown}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKey}
        />
        {selectedId && !disabled ? (
          <button type="button" className="btn px-2" aria-label={t(S.clear)} onClick={() => onChange('')}>
            ×
          </button>
        ) : null}
      </div>
      {open && !disabled ? <RefOptions listId={listId} field={field} items={items} pending={results.isPending} loaded={results.data !== undefined} active={active} selectedId={selectedId} onHover={setActive} onPick={pick} /> : null}
    </div>
  );
}
