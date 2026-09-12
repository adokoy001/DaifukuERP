import { Decimal, defineWriteCapability, withWriteCapability, repo, registry, StateError, ValidationError, type Context, type Infer, type LocalDate } from '@daifuku/kernel';
import type { SalesInvoice } from './entities/sales-invoice.ts';
import { SalesSettlement } from './entities/settlement.ts';
const writer = defineWriteCapability({ name: 'sales.settlement', entity: 'sales_settlement', fields: ['invoiceId', 'date', 'amount'], operations: ['create'] });
const balanceWriter = defineWriteCapability({ name: 'sales.balance', entity: 'sales_invoice', fields: ['paidAmount', 'balance', 'status', 'settlementHistory'], operations: ['update'] });
export const withBalanceWrite = <T>(ctx: Context, work: (ctx: Context) => Promise<T>): Promise<T> => withWriteCapability(ctx, balanceWriter, work);
async function settlementDays(ctx: Context, invoiceId: string): Promise<Map<string, Decimal>> {
  const days = new Map<string, Decimal>();
  let after: LocalDate | undefined;
  for (;;) {
    const groups = await repo(ctx, SalesSettlement).aggregate({ where: { invoiceId, ...(after ? { date: { $gt: after } } : {}) }, groupBy: ['date'], metrics: { amount: { sum: 'amount' } }, orderBy: [{ field: 'date', dir: 'asc' }], limit: 500 });
    for (const group of groups) days.set(String(group.date), Decimal.from(group.amount as Decimal));
    if (groups.length < 500) break;
    after = String(groups.at(-1)?.date);
  }
  return days;
}

/** With current paidAmount zero, cancellation may start only after every nonzero daily settlement movement. */
export async function assertCancellationDate(ctx: Context, invoiceId: string, date: LocalDate, historyComplete: boolean): Promise<void> {
  if (!historyComplete) throw new StateError('Historical settlement data is unavailable', 'Migrate the original settlement facts before cancelling this invoice.');
  const days = await settlementDays(ctx, invoiceId);
  const last = [...days].filter(([, amount]) => !amount.isZero()).at(-1)?.[0];
  if (last && date < last) throw new ValidationError('Invoice cancellation would leave settlements without a receivable or payable', [{ path: 'correctionDate', message: `must be on or after ${last}` }], 'Use a correction date after the final effective settlement or reversal.');
}

export async function appendSettlement(ctx: Context, invoiceId: string, date: LocalDate, amount: Decimal, total: Decimal): Promise<void> {
  const days = await settlementDays(ctx, invoiceId);
  days.set(date, (days.get(date) ?? Decimal.zero()).plus(amount));
  let cumulative = Decimal.zero();
  for (const [day, value] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    cumulative = cumulative.plus(value);
    if (cumulative.lt(0) || cumulative.gt(total)) throw new ValidationError('Settlement would invalidate a historical balance', [{ path: 'date', message: `effective balance on ${day} would be outside 0..total` }]);
  }
  await withWriteCapability(ctx, writer, (internal) => repo(internal, SalesSettlement).create({ invoiceId, date, amount }));
}
export function registerSettlementHooks(): void {
  for (const op of ['before_update', 'before_delete'] as const) registry.registerHook('sales_settlement', op, () => { throw new StateError('Settlement history is append-only', 'Cancel the payment to append a reversing fact.'); });
}
/** Historical balances, without a dependency from invoices back to the payment module. */
export async function invoiceBalancesAsOf(ctx: Context, invoices: readonly Infer<typeof SalesInvoice>[], asOf: LocalDate): Promise<Map<string, Decimal>> {
  const amounts = new Map<string, Decimal>();
  for (let offset = 0; offset < invoices.length; offset += 200) {
    const chunk = invoices.slice(offset, offset + 200);
    for (const inv of chunk) if (!inv.settlementHistory) throw new StateError('Historical settlement data is unavailable for a migrated invoice', 'Migrate the original payment facts before running historical reports.');
    const groups = await repo(ctx, SalesSettlement).aggregate({ where: { invoiceId: { $in: chunk.map((i) => i.id) }, date: { $lte: asOf } }, groupBy: ['invoiceId'], metrics: { amount: { sum: 'amount' } }, limit: 200 });
    for (const group of groups) amounts.set(String(group.invoiceId), Decimal.from(group.amount as Decimal));
  }
  return new Map(invoices.map((inv) => [inv.id, inv.total.minus(amounts.get(inv.id) ?? Decimal.zero())]));
}
