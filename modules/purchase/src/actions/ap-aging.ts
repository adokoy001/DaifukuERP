// purchase.ap_aging (docs/specs/purchase.md AC-5): 買掛金年齢表 as a TableResult (docs/conventions/reports.md). Open,
// submitted bills dated on or before `asOf`, bucketed by days past their due date, one row per supplier. Balances are the
// bills' current balances (the module keeps no payment history, so payments after `asOf` are already deducted).
import {
  DOCSTATUS,
  defineAction,
  isLocalDate,
  label,
  repo,
  todayLocal,
  type Context,
  type Infer,
  type ListQuery,
  type LocalDate,
} from '@daifuku/kernel';
import { MAX_REPORT_ROWS, column, tableResult } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { z } from 'zod';
import { invoiceBalancesAsOf } from '../settlements.ts';
import { PurchaseInvoice } from '../entities/purchase-invoice.ts';
import { agingRows, type AgingPartner } from '../services/aging.ts';

type InvoiceRow = Infer<typeof PurchaseInvoice>;

export const AP_AGING_COLUMNS = [
  column('partnerCode', label('取引先コード', 'Supplier code'), 'text'),
  column('partnerName', label('仕入先', 'Supplier'), 'text'),
  column('billCount', label('件数', 'Bills'), 'int'),
  column('notDue', label('期日前', 'Not due'), 'decimal'),
  column('days1to30', label('1〜30日', '1–30 days'), 'decimal'),
  column('days31to60', label('31〜60日', '31–60 days'), 'decimal'),
  column('days61to90', label('61〜90日', '61–90 days'), 'decimal'),
  column('over90', label('90日超', 'Over 90 days'), 'decimal'),
  column('balance', label('残高', 'Balance'), 'decimal'),
  column('partnerId', label('取引先', 'Partner'), 'ref', { ref: Partner.name }),
];

/** Every visible open bill up to `max`, paged through repo.list (500 per page). */
async function listOpenBills(
  ctx: Context,
  asOf: LocalDate,
  max: number,
): Promise<{ items: InvoiceRow[]; truncated: boolean }> {
  const where: ListQuery['where'] = {
    date: { $lte: asOf },
    $or: [{ docstatus: DOCSTATUS.submitted }, { docstatus: DOCSTATUS.cancelled, cancelledDate: { $gt: asOf } }],
  };
  const items: InvoiceRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await repo(ctx, PurchaseInvoice).list({
      where,
      orderBy: [{ field: 'date', dir: 'asc' }],
      limit: 500,
      offset,
    });
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) return { items, truncated: false };
    if (items.length >= max) return { items: items.slice(0, max), truncated: true };
  }
}

async function loadPartners(ctx: Context, ids: readonly string[]): Promise<Map<string, AgingPartner>> {
  const out = new Map<string, AgingPartner>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    const page = await repo(ctx, Partner).list({ where: { id: { $in: unique.slice(i, i + 500) } }, limit: 500 });
    for (const p of page.items) out.set(p.id, { code: p.code, name: p.name });
  }
  return out;
}

export const apAgingAction = defineAction({
  name: 'purchase.ap_aging',
  description: label(
    '買掛金年齢表: asOf 時点で未払（status=open）の確定済み仕入請求書を、支払期日からの経過日数（期日前／1〜30／31〜60／61〜90／90日超）で仕入先ごとに集計します。既定 asOf は今日。',
    'AP aging: open, submitted purchase invoices as of a date, bucketed by days past due (not due / 1–30 / 31–60 / 61–90 / over 90) per supplier. asOf defaults to today.',
  ),
  input: z.object({ asOf: z.string().refine(isLocalDate, 'must be YYYY-MM-DD').optional() }),
  output: tableResult,
  exportEntities: ['purchase_invoice', 'purchase_settlement', 'partner'],
  permission: { entity: PurchaseInvoice.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, input) => {
    const asOf = input.asOf ?? todayLocal(ctx.now());
    const bills = await listOpenBills(ctx, asOf, MAX_REPORT_ROWS);
    const balances = await invoiceBalancesAsOf(ctx, bills.items, asOf);
    const partners = await loadPartners(
      ctx,
      bills.items.map((b) => b.partnerId),
    );
    const { rows, totals } = agingRows(
      bills.items.map((b) => ({
        partnerId: b.partnerId,
        date: b.date,
        dueDate: b.dueDate,
        balance: balances.get(b.id) ?? b.total,
      })),
      partners,
      asOf,
    );
    return {
      title: label(`買掛金年齢表 ${asOf} 時点`, `AP aging as of ${asOf}`),
      columns: AP_AGING_COLUMNS,
      rows,
      totals,
      meta: {
        asOf,
        bills: bills.items.length,
        suppliers: rows.length,
        ...(bills.truncated ? { truncated: true } : {}),
      },
    };
  },
});
