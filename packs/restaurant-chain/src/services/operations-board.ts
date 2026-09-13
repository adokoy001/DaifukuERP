import { column, Decimal, label, type TableResult } from '@daifuku/kernel';
import { RestaurantClosing } from '../entities/closing.ts';
import { dates } from './operation-dates.ts';
import type { OperationsData, Closing } from './operations-data.ts';
import type { OperationsRange } from './operations-contract.ts';
export interface DayCounts {
  expectedOpenDays: number;
  submittedDays: number;
  missingDays: number;
  reviewPendingDays: number;
  finalizePendingDays: number;
  zeroSalesDays: number;
  closedDays: number;
  unplannedDays: number;
}
export const emptyCounts = (): DayCounts => ({
  expectedOpenDays: 0,
  submittedDays: 0,
  missingDays: 0,
  reviewPendingDays: 0,
  finalizePendingDays: 0,
  zeroSalesDays: 0,
  closedDays: 0,
  unplannedDays: 0,
});
export interface BoardRow extends Record<string, unknown> {
  storeId: string;
  store: string;
  date: string;
  targetSales: string;
  counts: DayCounts;
}
function priority(row: Closing): number {
  return row.docstatus === 1
    ? 4
    : row.docstatus === 0 && ['submitted', 'approved'].includes(row.reviewStatus)
      ? 3
      : row.docstatus === 0
        ? 2
        : 1;
}
function status(row: Closing | undefined, plannedOpen: boolean | null): string {
  if (!row) return plannedOpen === true ? 'missing' : plannedOpen === false ? 'scheduled_closed' : 'unplanned';
  if (row.docstatus === 2) return 'cancelled';
  if (row.docstatus === 1) return row.dayStatus === 'sales' ? 'finalized' : row.dayStatus;
  return row.reviewStatus === 'submitted'
    ? 'review_pending'
    : row.reviewStatus === 'approved'
      ? 'finalize_pending'
      : row.reviewStatus;
}
export function boardRows(data: OperationsData, range: OperationsRange): BoardRow[] {
  const selected = new Map<string, Closing>();
  for (const row of data.closings) {
    const key = `${row.storeId}/${row.date}`;
    const prior = selected.get(key);
    if (
      !prior ||
      priority(row) > priority(prior) ||
      (priority(row) === priority(prior) && row.createdAt > prior.createdAt)
    )
      selected.set(key, row);
  }
  const plans = new Map(data.plans.map((row) => [`${row.storeId}/${row.date}`, row]));
  return data.stores.flatMap((store) =>
    dates(range.from, range.to).map((date): BoardRow => {
      const key = `${store.id}/${date}`;
      const row = selected.get(key);
      const plan = plans.get(key);
      const plannedOpen = plan?.expectedOpen ?? null;
      const currentStatus = status(row, plannedOpen);
      const counts = emptyCounts();
      const submitted =
        !!row && (row.docstatus === 1 || (row.docstatus === 0 && ['submitted', 'approved'].includes(row.reviewStatus)));
      counts.expectedOpenDays = plannedOpen === true ? 1 : 0;
      counts.submittedDays = submitted ? 1 : 0;
      counts.missingDays = plannedOpen === true && !submitted ? 1 : 0;
      counts.reviewPendingDays = currentStatus === 'review_pending' ? 1 : 0;
      counts.finalizePendingDays = currentStatus === 'finalize_pending' ? 1 : 0;
      counts.zeroSalesDays = currentStatus === 'no_sales' ? 1 : 0;
      counts.closedDays = currentStatus === 'closed' ? 1 : 0;
      counts.unplannedDays = plan ? 0 : 1;
      return {
        storeId: store.id,
        store: store.name,
        date,
        closingId: row?.id ?? null,
        closingNumber: row?.number ?? null,
        docstatus: row?.docstatus ?? null,
        reviewStatus: row?.reviewStatus ?? null,
        version: row?.version ?? null,
        dayStatus: row?.dayStatus ?? null,
        status: currentStatus,
        plannedOpen,
        targetSales: plan?.grossSalesTarget.toString() ?? '0',
        grossSales: row?.total.toString() ?? '0',
        submittedAt: row?.submittedAt?.toISOString() ?? null,
        submittedBy: row?.submittedBy ?? null,
        reviewedAt: row?.reviewedAt?.toISOString() ?? null,
        reviewedBy: row?.reviewedBy ?? null,
        reviewNote: row?.reviewNote ?? null,
        counts,
      };
    }),
  );
}
export function summarizeBoard(rows: BoardRow[]): DayCounts & { target: Decimal } {
  const result = { ...emptyCounts(), target: Decimal.zero() };
  for (const row of rows) {
    result.target = result.target.plus(row.targetSales);
    for (const key of Object.keys(row.counts) as (keyof DayCounts)[]) result[key] += row.counts[key];
  }
  return result;
}
export function submissionsTable(rows: BoardRow[]): TableResult {
  return {
    title: label('日次提出状況（現在のワークフロー）', 'Current daily submission status'),
    columns: [
      column('store', label('店舗', 'Store'), 'text'),
      column('date', label('営業日', 'Business date'), 'date'),
      column('status', label('状態', 'Status'), 'text'),
      column('targetSales', label('税込売上目標', 'Gross sales target'), 'decimal'),
      column('grossSales', label('入力済み税込売上', 'Entered gross sales'), 'decimal'),
      column('closingId', label('元の締め', 'Closing'), 'ref', { ref: RestaurantClosing.name }),
      column('closingNumber', label('締め番号', 'Closing number'), 'text'),
      column('reviewNote', label('確認・差戻し理由', 'Review note'), 'text'),
    ],
    rows: rows.map(({ counts: _counts, ...row }) => row),
    meta: { workflowBasis: 'current', targetBasis: 'confirmed_day_plan', missingBasis: 'planned_open_only' },
  };
}
