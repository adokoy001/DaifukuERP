// sales.ar_aging (spec AC-6): open balances per partner bucketed by days overdue as of `asOf`, from one aggregate
// query over sales_invoice (grouped by partner and due date) — no raw SQL. Balances are current values; `asOf`
// only sets the reference day for "days overdue" and excludes invoices dated after it.
import {
  defineAction,
  DOCSTATUS,
  isLocalDate,
  label,
  repo,
  todayLocal,
  type Context,
  StateError,
  type LocalDate,
} from '@daifuku/kernel';
import { column, MAX_REPORT_ROWS, tableResult, type TableResult } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { z } from 'zod';
import { invoiceBalancesAsOf } from '../settlements.ts';
import { SalesInvoice } from '../entities/sales-invoice.ts';
import { AGING_BUCKETS, agingRows, agingTotals, type AgingInput } from '../services/aging.ts';

const localDate = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');

export const AR_AGING_COLUMNS = [
  column('partnerName', label('得意先', 'Customer'), 'text'),
  column('notDue', label('期日前', 'Not due'), 'decimal'),
  column('days1to30', label('1〜30日', '1–30 days'), 'decimal'),
  column('days31to60', label('31〜60日', '31–60 days'), 'decimal'),
  column('days61to90', label('61〜90日', '61–90 days'), 'decimal'),
  column('over90', label('90日超', 'Over 90 days'), 'decimal'),
  column('total', label('残高合計', 'Total'), 'decimal'),
  column('partnerId', label('取引先', 'Partner'), 'ref', { ref: Partner.name }),
];

/** Names for a set of partner ids, read in pages of 200 (repo.list caps a page at 500). */
async function partnerNames(ctx: Context, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const page = await repo(ctx, Partner).list({ where: { id: { $in: ids.slice(i, i + 200) } }, limit: 200 });
    for (const p of page.items) out.set(p.id, p.name);
  }
  return out;
}

export async function arAging(ctx: Context, asOf: LocalDate): Promise<TableResult> {
  const invoices = [];
  for (let offset = 0; ;) {
    const page = await repo(ctx, SalesInvoice).list({
      where: {
        date: { $lte: asOf },
        $or: [{ docstatus: DOCSTATUS.submitted }, { docstatus: DOCSTATUS.cancelled, cancelledDate: { $gt: asOf } }],
      },
      limit: 500,
      offset,
    });
    invoices.push(...page.items);
    if (invoices.length > MAX_REPORT_ROWS)
      throw new StateError(
        'Historical aging exceeds the supported report size',
        'Narrow the report scope before retrying.',
      );
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  const balances = await invoiceBalancesAsOf(ctx, invoices, asOf);
  const inputs: AgingInput[] = invoices
    .map((inv) => ({ partnerId: inv.partnerId, dueDate: inv.dueDate, balance: balances.get(inv.id) ?? inv.total }))
    .filter((i) => !i.balance.isZero());
  const byPartner = agingRows(inputs, asOf);
  const names = await partnerNames(ctx, [...byPartner.keys()]);
  const rows = [...byPartner.values()]
    .map((r) => ({
      partnerId: r.partnerId,
      partnerName: names.get(r.partnerId) ?? r.partnerId,
      ...Object.fromEntries([...AGING_BUCKETS, 'total'].map((k) => [k, r[k as keyof typeof r].toString()])),
    }))
    .sort((a, b) => (a.partnerName < b.partnerName ? -1 : a.partnerName > b.partnerName ? 1 : 0));
  const totals = agingTotals(byPartner.values());
  return {
    title: label(`売掛金年齢表 ${asOf} 現在`, `AR aging as of ${asOf}`),
    columns: AR_AGING_COLUMNS,
    rows,
    totals: Object.fromEntries(
      [...AGING_BUCKETS, 'total'].map((k) => [k, totals[k as keyof typeof totals].toString()]),
    ),
    meta: { asOf, truncated: false },
  };
}

export const arAgingAction = defineAction({
  name: 'sales.ar_aging',
  description: label(
    '売掛金年齢表: 得意先ごとの未入金残高を支払期日からの経過日数（期日前／1〜30／31〜60／61〜90／90日超）で区分します。asOf 省略時は今日。',
    'AR aging: open receivable balance per customer bucketed by days past due (not due / 1–30 / 31–60 / 61–90 / 90+). asOf defaults to today.',
  ),
  input: z.object({ asOf: localDate.optional() }),
  output: tableResult,
  exportEntities: ['sales_invoice', 'sales_settlement', 'partner'],
  permission: { entity: SalesInvoice.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, { asOf }) => arAging(ctx, asOf ?? todayLocal(ctx.now())),
});
