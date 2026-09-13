// web-phase1 AC-1/AC-2: one editable grid per line entity — inline widgets by kind, add/remove/reorder, Enter/Tab
// navigation, decimal footer sums ("参考値"). Row model and arithmetic live in lib/lines.ts.
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useCurrencyScale } from '../api/company.tsx';
import { useMeta, useRecord } from '../api/queries.ts';
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { widgetFor, type FormValue } from '../lib/form.ts';
import { decimalMinScale, formatDecimal, groupDigits, shortId } from '../lib/format.ts';
import { columnSums, moveRow, newRow, polymorphicTarget, type GridErrors, type GridRow } from '../lib/lines.ts';
import { S } from '../strings.ts';
import { productDefaults } from '../lib/product-fill.ts';
import { WIDGETS } from './fields/field-widget.tsx';

export interface LineGridProps {
  line: EntityMeta;
  columns: FieldMeta[];
  rows: GridRow[];
  onChange: (rows: GridRow[]) => void;
  readOnly: boolean;
  readOnlyReason?: string;
  errors: GridErrors;
  /** Rendered between the header and the table (web-phase15: the allocation picker). */
  children?: ReactNode;
}

const NUMERIC = new Set(['decimal', 'int']);
const NO_ENTITIES: EntityMeta[] = [];

function focusCell(root: HTMLElement | null, rowKey: string, field: string | undefined): void {
  if (!root) return;
  const row = root.querySelector(`tr[data-row-key="${rowKey}"]`);
  const scope = field ? row?.querySelector(`td[data-field="${field}"]`) : row;
  const el = scope?.querySelector<HTMLElement>(
    'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
  );
  el?.focus();
}

function useKeyboard(rows: GridRow[], columns: FieldMeta[], readOnly: boolean, onChange: (rows: GridRow[]) => void) {
  const body = useRef<HTMLTableSectionElement>(null);
  const pending = useRef<{ rowKey: string; field: string | undefined } | null>(null);
  useEffect(() => {
    if (!pending.current) return;
    focusCell(body.current, pending.current.rowKey, pending.current.field);
    pending.current = null;
  });
  const addRow = (after?: number, field?: string) => {
    const row = newRow(columns);
    const next = [...rows];
    next.splice(after === undefined ? rows.length : after + 1, 0, row);
    pending.current = { rowKey: row.key, field: field ?? columns[0]?.name };
    onChange(next);
  };
  // Enter on the last row appends a row; elsewhere it moves down the same column. Widgets that consume Enter
  // (an open ref combobox) call preventDefault first, and textareas keep their newline.
  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented || readOnly || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;
    const tr = target.closest<HTMLElement>('tr[data-row-key]');
    const field = target.closest<HTMLElement>('td[data-field]')?.dataset.field;
    const index = rows.findIndex((r) => r.key === tr?.dataset.rowKey);
    if (index === -1) return;
    e.preventDefault();
    const nextRow = rows[index + 1];
    if (nextRow) focusCell(body.current, nextRow.key, field);
    else addRow(index, field);
  };
  return { body, addRow, onKeyDown };
}

interface CellProps {
  line: EntityMeta;
  row: GridRow;
  field: FieldMeta;
  columns: FieldMeta[];
  entities: EntityMeta[];
  readOnly: boolean;
  error: string | undefined;
  onChange: (v: FormValue) => void;
  onSelect: (record: RecordJson) => void;
}

/** `<x>Id` + `<x>Entity` cells: the referenced record's number / display value as a link (lib/lines.ts polymorphicTarget). */
function TargetLink({ entity, id }: { entity: EntityMeta; id: string }) {
  const rec = useRecord(entity.name, id);
  if (!rec.data) return null;
  const display = entity.displayField ? rec.data[entity.displayField] : undefined;
  const text =
    typeof rec.data.number === 'string' && rec.data.number
      ? rec.data.number
      : typeof display === 'string' && display
        ? display
        : shortId(id);
  return (
    <Link
      to="/e/$entity/$id"
      params={{ entity: entity.name, id }}
      data-testid="target-link"
      className="block px-1 font-mono text-[11px] text-sky-700 hover:underline"
    >
      {text}
    </Link>
  );
}

function Cell({ line, row, field, columns, entities, readOnly, error, onChange, onSelect }: CellProps) {
  const { t } = useLocale();
  const Widget = WIDGETS[widgetFor(field)];
  const target = polymorphicTarget(field, row.values, columns, entities);
  return (
    <td
      data-field={field.name}
      className={`px-1 py-0.5 align-top ${NUMERIC.has(field.kind) ? 'min-w-28' : 'min-w-36'}`}
    >
      <Widget
        id={`l-${line.name}-${row.key}-${field.name}`}
        field={field}
        value={row.values[field.name] ?? ''}
        onChange={onChange}
        onSelectRecord={onSelect}
        disabled={readOnly || field.serverOwned === true || field.readOnly === true}
        invalid={error !== undefined}
        ariaLabel={t(field.label)}
      />
      {target ? <TargetLink entity={target.entity} id={target.id} /> : null}
      {error ? (
        <span role="alert" className="block text-[11px] text-red-700">
          {error}
        </span>
      ) : null}
    </td>
  );
}

function RowTools({
  index,
  count,
  readOnly,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  readOnly: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  if (readOnly) return <td />;
  const btn = 'rounded px-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-30';
  return (
    <td className="px-1 py-0.5 align-top whitespace-nowrap">
      <button
        type="button"
        className={btn}
        aria-label={t(S.moveUp)}
        title={t(S.moveUp)}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        ↑
      </button>
      <button
        type="button"
        className={btn}
        aria-label={t(S.moveDown)}
        title={t(S.moveDown)}
        disabled={index >= count - 1}
        onClick={() => onMove(index + 1)}
      >
        ↓
      </button>
      <button
        type="button"
        className={`${btn} text-red-700`}
        aria-label={t(S.removeRow)}
        title={t(S.removeRow)}
        onClick={onRemove}
      >
        ×
      </button>
    </td>
  );
}

function SumsFooter({ columns, rows }: { columns: FieldMeta[]; rows: GridRow[] }) {
  const { t } = useLocale();
  const currencyScale = useCurrencyScale();
  const sums = columnSums(rows, columns);
  if (Object.keys(sums).length === 0) return null;
  return (
    <tfoot className="border-t border-neutral-300 bg-neutral-50 text-xs">
      <tr data-testid="line-sums">
        <td className="px-2 py-1 whitespace-nowrap text-neutral-500">{t(S.sums)}</td>
        {columns.map((c) => (
          <td
            key={c.name}
            data-sum={c.name}
            className={`px-2 py-1 ${NUMERIC.has(c.kind) ? 'num' : ''}`}
            title={t(S.referenceValueHint)}
          >
            {sums[c.name] !== undefined
              ? c.kind === 'decimal'
                ? formatDecimal(sums[c.name] ?? '0', decimalMinScale(c, currencyScale))
                : groupDigits(sums[c.name] ?? '0')
              : ''}
          </td>
        ))}
        <td className="px-1 py-1 text-[10px] text-neutral-400">{t(S.referenceValue)}</td>
      </tr>
    </tfoot>
  );
}

export function LineGrid({ line, columns, rows, onChange, readOnly, readOnlyReason, errors, children }: LineGridProps) {
  const { t } = useLocale();
  const { body, addRow, onKeyDown } = useKeyboard(rows, columns, readOnly, onChange);
  const entities = useMeta().data?.entities ?? NO_ENTITIES;
  const setCell = (key: string, field: string, v: FormValue) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, values: { ...r.values, [field]: v } } : r)));
  const selectRecord = (key: string, field: FieldMeta, picked: RecordJson) => {
    const fill = field.ref === 'product' ? productDefaults(picked, columns, line.name.startsWith('purchase_')) : {};
    onChange(
      rows.map((r) => (r.key === key ? { ...r, values: { ...r.values, ...fill, [field.name]: picked.id } } : r)),
    );
  };
  return (
    <section
      aria-label={t(line.label)}
      data-testid={`lines-${line.name}`}
      data-readonly={readOnly}
      className="rounded border border-neutral-200 bg-white"
    >
      <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-1.5">
        <h2 className="text-sm font-semibold">{t(line.label)}</h2>
        <span className="text-xs text-neutral-500">({rows.length})</span>
        {readOnly ? (
          <span className="text-[11px] text-neutral-500">🔒 {readOnlyReason ?? t(S.readonly)}</span>
        ) : (
          <span className="text-[11px] text-neutral-400">{t(S.enterAddsRow)}</span>
        )}
        {!readOnly ? (
          <button type="button" className="btn ml-auto px-2 py-0.5" onClick={() => addRow()}>
            + {t(S.addRow)}
          </button>
        ) : null}
      </header>
      {children}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-600">
            <tr>
              <th scope="col" className="w-8 px-2 py-1 font-medium">
                {t(S.rowNo)}
              </th>
              {columns.map((c) => (
                <th
                  key={c.name}
                  scope="col"
                  className={`px-2 py-1 font-medium whitespace-nowrap ${NUMERIC.has(c.kind) ? 'text-right' : ''}`}
                >
                  {t(c.label)}
                  {c.required && !c.hasDefault && !c.serverOwned && !c.readOnly && !readOnly ? (
                    <span className="ml-0.5 text-red-600">*</span>
                  ) : null}
                </th>
              ))}
              <th scope="col" className="w-20" />
            </tr>
          </thead>
          <tbody ref={body} onKeyDown={onKeyDown}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="px-2 py-3 text-center text-xs text-neutral-500">
                  {t(S.noLines)}
                </td>
              </tr>
            ) : null}
            {rows.map((row, i) => (
              <tr
                key={row.key}
                data-row-key={row.key}
                data-row-index={i}
                data-testid="line-row"
                className="border-t border-neutral-100"
              >
                <td className="px-2 py-1 font-mono text-xs text-neutral-400">{i + 1}</td>
                {columns.map((c) => (
                  <Cell
                    key={c.name}
                    line={line}
                    row={row}
                    field={c}
                    columns={columns}
                    entities={entities}
                    readOnly={readOnly}
                    error={errors[row.key]?.[c.name]}
                    onChange={(v) => setCell(row.key, c.name, v)}
                    onSelect={(picked) => selectRecord(row.key, c, picked)}
                  />
                ))}
                <RowTools
                  index={i}
                  count={rows.length}
                  readOnly={readOnly}
                  onMove={(to) => onChange(moveRow(rows, i, to))}
                  onRemove={() => onChange(rows.filter((r) => r.key !== row.key))}
                />
              </tr>
            ))}
          </tbody>
          <SumsFooter columns={columns} rows={rows} />
        </table>
      </div>
    </section>
  );
}
