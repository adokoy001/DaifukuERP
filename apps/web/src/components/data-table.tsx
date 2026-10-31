// AC-3: dense list table. TanStack Table v9 owns the column/header model; sorting and paging are server-side (manual*).
// ui-kit AC-6/AC-14: the frame, sticky header, skeleton rows and empty state come from DataTableShell.
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
import { useMemo, type ReactNode } from 'react';
import { useCurrencyScale } from '../api/company.tsx';
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { fieldValue, isExtFieldName } from '../lib/ext.ts';
import { formatValue } from '../lib/format.ts';
import { formatSort, parseSort } from '../lib/query.ts';
import { S } from '../strings.ts';
import { ariaSortFor, cellAlignClass, cx, DataTableShell, EmptyState, type CellAlign } from '../ui/index.ts';
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
  /** A request for this list is in flight. */
  loading: boolean;
  /** The rows belong to the previous page/search/sort (placeholder data): show skeleton rows instead. */
  stale?: boolean;
  /** Body when there are no rows (defaults to a plain "no records" state). */
  empty?: ReactNode;
  /** Bound the table to the viewport so the sticky header stays visible. */
  fill?: boolean;
  /** list-workbench AC-10: a leading checkbox column for bulk operations. */
  selection?: RowSelection;
}

export interface RowSelection {
  isSelected: (row: RecordJson) => boolean;
  onToggle: (row: RecordJson, selected: boolean) => void;
  /** Header checkbox: select or clear every row on the page. */
  onTogglePage: (rows: RecordJson[], selected: boolean) => void;
  /** A row that cannot be added (the selection limit is reached). */
  isDisabled?: (row: RecordJson) => boolean;
  /** Accessible name of a row checkbox, e.g. "Select INV-2026-000012". */
  rowLabel: (row: RecordJson) => string;
  pageLabel: string;
}

function SelectAll({ rows, selection }: { rows: RecordJson[]; selection: RowSelection }) {
  const checked = rows.length > 0 && rows.every((row) => selection.isSelected(row));
  const some = rows.some((row) => selection.isSelected(row));
  return (
    <input
      type="checkbox"
      className="ui-row-check"
      aria-label={selection.pageLabel}
      checked={checked}
      disabled={rows.length === 0}
      ref={(el) => {
        if (el) el.indeterminate = some && !checked;
      }}
      onChange={(e) => selection.onTogglePage(rows, e.target.checked)}
    />
  );
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
          meta: { align: f.kind === 'int' || f.kind === 'decimal' ? 'right' : 'left' } satisfies { align: CellAlign },
          cell: (ctx) => {
            const v = ctx.getValue();
            const fmt = formatValue(f, v, locale, {
              refLabel: f.kind === 'ref' && typeof v === 'string' ? refLabel(f, v) : undefined,
              currencyScale,
            });
            return (
              <span className={cx(fmt.mono && 'font-mono tabular-nums', fmt.align === 'right' && 'block text-right')}>
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
  if (!dir)
    return (
      <span className="ui-sort-icon" aria-hidden="true">
        ↕
      </span>
    );
  return (
    <span className="ui-sort-icon is-active" aria-hidden="true">
      {dir === 'asc' ? '↑' : '↓'}
    </span>
  );
}

function alignOf(meta: unknown): CellAlign | undefined {
  return (meta as { align?: CellAlign } | undefined)?.align;
}

export function DataTable(props: DataTableProps) {
  const {
    entity,
    columns,
    rows,
    sort,
    onSortChange,
    onRowClick,
    refLabel,
    loading,
    stale = false,
    empty,
    fill,
    selection,
  } = props;
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
  const pageRows = bodyRows.map((row) => row.original);
  const head = headerGroups.map((hg) => (
    <tr key={hg.id}>
      {selection ? (
        <th scope="col" className="ui-select-cell px-2 py-1.5">
          <SelectAll rows={pageRows} selection={selection} />
        </th>
      ) : null}
      {hg.headers.map((h) => {
        const align = alignOf(h.column.columnDef.meta);
        const canSort = h.column.getCanSort();
        const dir = h.column.getIsSorted();
        return (
          <th
            key={h.id}
            scope="col"
            className={cx('px-2 py-1.5', cellAlignClass(align))}
            aria-sort={canSort ? ariaSortFor(dir) : undefined}
          >
            {h.isPlaceholder ? null : canSort ? (
              <button type="button" className="ui-sort-button" onClick={h.column.getToggleSortingHandler()}>
                <table.FlexRender header={h} />
                <SortIcon dir={dir} />
              </button>
            ) : (
              <table.FlexRender header={h} />
            )}
          </th>
        );
      })}
    </tr>
  ));
  return (
    <DataTableShell
      head={head}
      columnCount={cols.length + (selection ? 1 : 0)}
      busy={loading}
      skeleton={loading && (rows === undefined || stale)}
      skeletonRows={8}
      loadingLabel={t(S.loading)}
      isEmpty={bodyRows.length === 0}
      empty={empty ?? <EmptyState title={t(S.noRows)} />}
      label={t(entity.label)}
      fill={fill ?? false}
    >
      {bodyRows.map((row) => (
        <tr
          key={row.id}
          data-testid="row"
          data-id={row.original.id}
          tabIndex={0}
          onClick={() => onRowClick(row.original)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRowClick(row.original);
          }}
          className={cx('ui-row-link', selection?.isSelected(row.original) && 'is-selected')}
        >
          {selection ? (
            // The checkbox cell is not part of the row link: clicks and Enter on it only toggle the selection.
            <td className="ui-select-cell px-2 py-1" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                className="ui-row-check"
                aria-label={selection.rowLabel(row.original)}
                checked={selection.isSelected(row.original)}
                disabled={!selection.isSelected(row.original) && selection.isDisabled?.(row.original) === true}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => selection.onToggle(row.original, e.target.checked)}
              />
            </td>
          ) : null}
          {row.getAllCells().map((cell) => (
            <td key={cell.id} className={cx('px-2 py-1', cellAlignClass(alignOf(cell.column.columnDef.meta)))}>
              <table.FlexRender cell={cell} />
            </td>
          ))}
        </tr>
      ))}
    </DataTableShell>
  );
}
