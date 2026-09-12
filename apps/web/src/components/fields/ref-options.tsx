import type { FieldMeta, RecordJson } from '../../api/types.ts';
import { useLocale } from '../../i18n.tsx';
import { S } from '../../strings.ts';

export function refLabel(row: RecordJson | undefined, displayField: string | undefined): string {
  if (!row) return '';
  const value = (displayField ? row[displayField] : undefined) ?? row.name ?? row.number ?? row.code;
  return typeof value === 'string' && value ? value : row.id.slice(0, 8);
}
interface OptionsProps {
  listId: string; field: FieldMeta; items: RecordJson[]; pending: boolean; failed: boolean;
  active: number; selectedId: string; onHover: (index: number) => void; onPick: (row: RecordJson) => void; onRetry: () => void;
}
export function RefOptions({ listId, field, items, pending, failed, active, selectedId, onHover, onPick, onRetry }: OptionsProps) {
  const { t } = useLocale();
  return <div className="absolute z-20 mt-0.5 w-full rounded border border-neutral-300 bg-white shadow-lg">
    {pending ? <p role="status" className="px-3 py-2 text-xs text-neutral-600">{t({ ja: '候補を検索中…', en: 'Searching for matches…' })}</p> : null}
    {failed ? <div role="alert" className="px-3 py-2 text-xs text-red-800"><p>{t({ ja: '候補を取得できませんでした。検索条件を保持しています。', en: 'Could not load matches. Your search is preserved.' })}</p><button type="button" className="btn mt-2" onClick={onRetry}>{t(S.retry)}</button></div> : null}
    {!pending && !failed && !items.length ? <p role="status" className="px-3 py-2 text-xs text-neutral-600">{t(S.refNoMatch)}</p> : null}
    <ul id={listId} role="listbox" aria-label={t(field.label)} aria-busy={pending} className="max-h-60 overflow-y-auto">
      {items.map((row, index) => <li key={row.id} id={`${listId}-${index}`} role="option" aria-selected={row.id === selectedId}
        className={`cursor-pointer px-3 py-2 ${index === active ? 'bg-sky-100' : 'hover:bg-neutral-100'} ${row.id === selectedId ? 'font-medium' : ''}`}
        onMouseEnter={() => onHover(index)} onMouseDown={(event) => { event.preventDefault(); onPick(row); }}>
        {refLabel(row, field.refDisplayField)}{typeof row.code === 'string' && row.code ? <span className="ml-2 font-mono text-xs text-neutral-500">{row.code}</span> : null}
      </li>)}
    </ul>
  </div>;
}
