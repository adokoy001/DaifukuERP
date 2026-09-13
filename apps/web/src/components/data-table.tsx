// AC-3: dense list table. TanStack Table v9 owns the column/header model; sorting and paging are server-side (manual*).
import {
  createColumnHelper,
  functionalUpdate,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { useMemo } from 'react';
import { useCurrencyScale } from '../api/company.tsx';
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { fieldValue, isExtFieldName } from '../lib/ext.ts';
import { formatValue } from '../lib/format.ts';
import { formatSort, parseSort } from '../lib/query.ts';
import { S } from '../strings.ts';
import { DocstatusBadge } from './docstatus-badge.tsx';

const features = tableFeatures({ rowSortingFeature });
const helper = createColumnHelper<typeof features, RecordJson>();
const EMPTY: RecordJson[] = [];

type Col = ColumnDef<typeof features, RecordJson, unknown>;

export interface DataTableProps {
  entity: EntityMeta;
  columns: FieldMeta[];
  rows: RecordJson[] | undefined;
  sort: string | undefined;
  onSortChange: (sort: string | undefined) => void;
  onRowClick: (row: RecordJson) => void;
  /** Resolved display value for a ref cell (undefined -> short id). */
  refLabel: (field: FieldMeta, id: string) => string | undefined;
  loading: boolean;
}

function toSortingState(sort: string | undefined): SortingState {
  const s = parseSort(sort);
  return s ? [{ id: s.field, desc: s.dir === 'desc' }] : [];
}

function fromSortingState(state: SortingState): string | undefined {
  const first = state[0];
  return first ? formatSort({ field: first.id, dir: first.desc ? 'desc' : 'asc' }) : undefined;
}

function useColumns(entity: EntityMeta, fields: FieldMeta[], refLabel: DataTableProps['refLabel']): Col[] {
  const { t, locale } = useLocale();
  const currencyScale = useCurrencyScale();
  return useMemo(() => {
    const cols: Col[] = [];
    if (entity.kind === 'document') {
      cols.push(
        helper.accessor((row): unknown => row.number ?? '', {
          id: 'number',
          header: t(S.number),
          cell: (ctx) => <span className="code">{String(ctx.getValue() ?? '')}</span>,
        }),
        helper.accessor((row): unknown => row.docstatus ?? 0, {
          id: 'docstatus',
          header: t(S.docstatus),
          cell: (ctx) => <DocstatusBadge docstatus={ctx.getValue()} />,
        }),
      );
    }
    for (const f of fields.filter(
      (f) => entity.kind !== 'document' || (f.name !== 'number' && f.name !== 'docstatus'),
    )) {
      cols.push(
        helper.accessor((row): unknown => fieldValue(row, f), {
          id: f.name,
          header: t(f.label),
          // the API cannot orderBy ext keys (ADR-0014), so ext columns are not sortable
          enableSorting: !isExtFieldName(f.name),
          meta: { align: f.kind === 'int' || f.kind === 'decimal' ? 'right' : 'left' },
          cell: (ctx) => {
            const v = ctx.getValue();
            const fmt = formatValue(f, v, locale, {
              refLabel: f.kind === 'ref' && typeof v === 'string' ? refLabel(f, v) : undefined,
              currencyScale,
            });
            return (
              <span
                className={`${fmt.mono ? 'font-mono tabular-nums' : ''} ${fmt.align === 'right' ? 'block text-right' : ''}`}
              >
                {fmt.text}
              </span>
            );
          },
        }),
      );
    }
    return cols;
  }, [entity.kind, fields, t, locale, refLabel, currencyScale]);
}

function SortIcon({ dir }: { dir: false | 'asc' | 'desc' }) {
  if (!dir) return <span className="ml-1 inline-block w-3 text-neutral-300">↕</span>;
  return <span className="ml-1 inline-block w-3 text-sky-700">{dir === 'asc' ? '↑' : '↓'}</span>;
}

export function DataTable(props: DataTableProps) {
  const { entity, columns, rows, sort, onSortChange, onRowClick, refLabel, loading } = props;
  const { t } = useLocale();
  const cols = useColumns(entity, columns, refLabel);
  const sorting = useMemo(() => toSortingState(sort), [sort]);
  const table = useTable({
    features,
    columns: cols,
    data: rows ?? EMPTY,
    getRowId: (row) => row.id,
    manualSorting: true,
    enableMultiSort: false,
    state: { sorting },
    onSortingChange: (updater: Updater<SortingState>) =>
      onSortChange(fromSortingState(functionalUpdate(updater, sorting))),
  });
  const headerGroups = table.getHeaderGroups();
  const bodyRows = table.getRowModel().rows;
  return (
    <div
      className={`overflow-x-auto rounded border border-neutral-200 bg-white ${loading ? 'opacity-60' : ''}`}
      aria-busy={loading}
    >
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left text-xs text-neutral-600 select-none">
          {headerGroups.map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const align = (h.column.columnDef.meta as { align?: 'left' | 'right' } | undefined)?.align ?? 'left';
                const canSort = h.column.getCanSort();
                return (
                  <th
                    key={h.id}
                    scope="col"
                    className={`border-b border-neutral-200 px-2 py-1.5 font-medium whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}
                  >
                    {h.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        className="inline-flex items-center hover:text-neutral-900"
                        onClick={h.column.getToggleSortingHandler()}
                        aria-sort={
                          h.column.getIsSorted() === 'asc'
                            ? 'ascending'
                            : h.column.getIsSorted() === 'desc'
                              ? 'descending'
                              : 'none'
                        }
                      >
                        <table.FlexRender header={h} />
                        <SortIcon dir={h.column.getIsSorted()} />
                      </button>
                    ) : (
                      <table.FlexRender header={h} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {bodyRows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, cols.length)} className="px-2 py-6 text-center text-neutral-500">
                {loading ? t(S.loading) : t(S.noRows)}
              </td>
            </tr>
          ) : (
            bodyRows.map((row) => (
              <tr
                key={row.id}
                data-testid="row"
                data-id={row.original.id}
                tabIndex={0}
                onClick={() => onRowClick(row.original)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRowClick(row.original);
                }}
                className="cursor-pointer border-b border-neutral-100 hover:bg-sky-50 focus:bg-sky-50 focus:outline-none"
              >
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="px-2 py-1 whitespace-nowrap">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
