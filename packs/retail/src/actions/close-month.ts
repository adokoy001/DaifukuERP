// retail.close_month (docs/specs/pack-retail.md AC-7): 三分法の月次振替. Reads inventory.valuation at the period end and posts one
// journal entry through accounting.postFromSource (source = the retail_month_close record): Dr 商品 / Cr 期末商品棚卸高 for the
// valuation total and, when an earlier month was closed, Dr 期首商品棚卸高 / Cr 商品 for that month's closing amount.
// Idempotent per period: a second call returns the stored record and writes nothing. Months close in order (a period
// before an already-closed one is refused). retail_month_close rows are written only here (guard below).
import {
  defineAction,
  label,
  registry,
  repo,
  StateError,
  withLock,
  type Context,
  type HookArgs,
} from '@daifuku/kernel';
import { postFromSource } from '@daifuku/mod-accounting';
import { valuation, INVENTORY_SERIES_LOCK, closeInventoryThrough } from '@daifuku/mod-inventory';
import { z } from 'zod';
import { PERIOD_RE, RetailMonthClose } from '../entities/retail-month-close.ts';
import { decimalOf } from '../services/closing-totals.ts';
import { laterCloses, monthCloseLines, periodRange, previousClose } from '../services/month-close.ts';
import { resolveClosingAccounts } from '../settings.ts';
import { asPack, isPackWrite } from '../system-write.ts';

export const closeMonthInput = z.object({ period: z.string().regex(PERIOD_RE, 'must be YYYY-MM') });

export const closeMonthOutput = z.object({
  period: z.string(),
  asOf: z.string(),
  valuationTotal: z.string(),
  openingAmount: z.string(),
  journalEntryId: z.string().nullable(),
  alreadyClosed: z.boolean(),
});
type CloseMonthOutput = z.input<typeof closeMonthOutput>;

export const MONTH_CLOSE_WRITE_HINT =
  'Month closes are recorded only by the retail.close_month action (idempotent per period).';
export const ORDER_HINT = 'Close months in order, oldest first. Re-closing an earlier month is not supported.';

function outputOf(
  r: { period: string; asOf: string; valuationTotal: unknown; openingAmount: unknown; journalEntryId: string | null },
  alreadyClosed: boolean,
): CloseMonthOutput {
  return {
    period: r.period,
    asOf: r.asOf,
    valuationTotal: decimalOf(r.valuationTotal).toString(),
    openingAmount: decimalOf(r.openingAmount).toString(),
    journalEntryId: r.journalEntryId,
    alreadyClosed,
  };
}

export async function closeMonth(ctx: Context, period: string): Promise<CloseMonthOutput> {
  await withLock(ctx, INVENTORY_SERIES_LOCK, async () => undefined);
  const r = repo(ctx, RetailMonthClose);
  const existing = (await r.list({ where: { period }, limit: 1 })).items[0];
  if (existing) return outputOf(existing, true);
  const records = (await r.list({ orderBy: [{ field: 'period', dir: 'desc' }], limit: 1 })).items;
  const later = laterCloses(records, period);
  if (later.length > 0) throw new StateError(`cannot close ${period}: a later month is already closed`, ORDER_HINT);
  const { to } = periodRange(period);
  const accounts = await resolveClosingAccounts(ctx);
  const closing = decimalOf((await valuation(ctx, { asOf: to })).totals?.value);
  const opening = decimalOf(previousClose(records, period)?.valuationTotal);
  const lines = monthCloseLines({ opening, closing }, accounts);
  return asPack(ctx, async (ctx) => {
    const record = await repo(ctx, RetailMonthClose).create({
      period,
      asOf: to,
      valuationTotal: closing,
      openingAmount: opening,
    });
    await closeInventoryThrough(ctx, to, { entity: RetailMonthClose.name, id: record.id });
    if (lines.length === 0) return outputOf(record, false);
    const entry = await postFromSource(ctx, {
      sourceEntity: RetailMonthClose.name,
      sourceId: record.id,
      date: to,
      description: `月次締め ${period}（期末商品棚卸高 ${closing.toString()}）`,
      lines,
    });
    return outputOf(await repo(ctx, RetailMonthClose).update(record.id, { journalEntryId: entry.id }), false);
  });
}

export const closeMonthAction = defineAction({
  name: 'retail.close_month',
  description: label(
    '月次締め（三分法）: 対象月（YYYY-MM）の月末の在庫評価額（inventory.valuation）で「商品 / 期末商品棚卸高」、前月までに締めた月があればその額で「期首商品棚卸高 / 商品」の仕訳を転記します。同じ月の 2 回目は何もしません。',
    'Month close (periodic inventory): posts Dr inventory / Cr closing inventory for the valuation at the month end (inventory.valuation) and, when an earlier month was closed, Dr opening inventory / Cr inventory for that amount. A second call for the same month writes nothing.',
  ),
  input: closeMonthInput,
  output: closeMonthOutput,
  permission: { roles: ['accounting'] },
  mutates: true,
  handler: (ctx, input) => closeMonth(ctx, input.period),
});

function refuse(op: string) {
  return (ctx: Context, { row, previous }: HookArgs): void => {
    if (isPackWrite(ctx)) return;
    throw new StateError(`retail_month_close rows cannot be ${op} directly`, MONTH_CLOSE_WRITE_HINT, {
      id: previous?.id ?? row.id,
    });
  };
}

export function registerMonthCloseGuards(): void {
  registry.registerHook(RetailMonthClose.name, 'before_validate', (ctx, args) =>
    refuse(args.previous ? 'updated' : 'created')(ctx, args),
  );
  registry.registerHook(RetailMonthClose.name, 'before_delete', refuse('deleted'));
}
