// payment.outstanding (spec AC-5): the open invoices a payment of `direction` can be allocated to — sales invoices for
// receipts, purchase invoices for disbursements — with their balances, oldest first, as a TableResult the generic UI
// renders and the allocation picker reads. Reads go through the sales/purchase repository in the caller's context, so
// a role without `read` on that invoice entity gets PERMISSION_DENIED (sales cannot list bills, purchasing cannot list
// invoices; accounting and viewer see both).
import { Decimal, defineAction, label, repo, type Context } from '@daifuku/kernel';
import { column, MAX_REPORT_ROWS, tableResult, type TableColumn, type TableResult } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { z } from 'zod';
import { PAYMENT_DIRECTIONS, Payment, type PaymentDirection } from '../entities/payment.ts';
import { listOpenInvoices } from '../invoices.ts';
import { invoiceEntityFor } from '../services/allocate.ts';

export const outstandingInput = z.object({
  direction: z.enum(PAYMENT_DIRECTIONS),
  partnerId: z.uuid().optional(),
});
export type OutstandingInput = z.output<typeof outstandingInput>;

export function outstandingColumns(direction: PaymentDirection): TableColumn[] {
  return [
    column('number', label('番号', 'Number'), 'text'),
    column('partnerName', label('取引先', 'Partner'), 'text'),
    column('date', label('日付', 'Date'), 'date'),
    column('dueDate', label('期日', 'Due date'), 'date'),
    column('total', label('金額', 'Total'), 'decimal'),
    column('paidAmount', label(direction === 'receive' ? '入金済額' : '支払済額', 'Paid'), 'decimal'),
    column('balance', label('残高', 'Balance'), 'decimal'),
    column('invoiceId', label('請求書', 'Invoice'), 'ref', { ref: invoiceEntityFor(direction) }),
    column('partnerId', label('取引先ID', 'Partner id'), 'ref', { ref: Partner.name }),
  ];
}

/** Names for a set of partner ids, read in pages of 200 (repo.list caps a page at 500). */
async function partnerNames(ctx: Context, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const page = await repo(ctx, Partner).list({ where: { id: { $in: unique.slice(i, i + 200) } }, limit: 200 });
    for (const p of page.items) out.set(p.id, p.name);
  }
  return out;
}

export async function outstanding(ctx: Context, input: OutstandingInput): Promise<TableResult> {
  const entity = invoiceEntityFor(input.direction);
  const { items, truncated } = await listOpenInvoices(ctx, entity, input.partnerId, MAX_REPORT_ROWS);
  const names = await partnerNames(
    ctx,
    items.map((i) => i.partnerId),
  );
  const rows = items.map((i) => ({
    invoiceId: i.id,
    number: i.number,
    partnerId: i.partnerId,
    partnerName: names.get(i.partnerId) ?? i.partnerId,
    date: i.date,
    dueDate: i.dueDate,
    total: i.total.toString(),
    paidAmount: i.paidAmount.toString(),
    balance: i.balance.toString(),
  }));
  const sum = (key: 'total' | 'paidAmount' | 'balance') => Decimal.sum(items.map((i) => i[key])).toString();
  const title = input.direction === 'receive' ? label('未入金の売上請求書', 'Outstanding sales invoices') : label('未払の仕入請求書', 'Outstanding purchase invoices');
  return {
    title,
    columns: outstandingColumns(input.direction),
    rows,
    totals: { total: sum('total'), paidAmount: sum('paidAmount'), balance: sum('balance') },
    meta: { direction: input.direction, invoiceEntity: entity, partnerId: input.partnerId ?? null, truncated },
  };
}

export const outstandingAction = defineAction({
  name: 'payment.outstanding',
  description: label(
    '消込可能な請求書の一覧: direction=receive なら未入金の売上請求書、pay なら未払の仕入請求書を残高つきで返します（partnerId で絞り込み）。入出金の明細（payment_allocation）を作るときに invoiceId と残高を選ぶための表です。',
    'Open invoices a payment can be allocated to: sales invoices for direction=receive, purchase invoices for pay, with balances (filter by partnerId). Use it to pick invoiceId / amount for payment_allocation lines.',
  ),
  input: outstandingInput,
  output: tableResult,
  exportEntities: ['sales_invoice', 'purchase_invoice', 'partner'],
  permission: { entity: Payment.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, input) => outstanding(ctx, input),
});
