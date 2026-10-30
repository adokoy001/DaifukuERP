// docs/specs/opening-balances.md AC-4 (D-3, D-19) for opening stock: opening stock receipts post no journal line, so
// accounting's net-zero check on posted lines cannot see them. A fiscal year may not be opened while a submitted
// opening stock receipt (sourceEntity 'fiscal_year') is dated inside it — the receipt would silently become an in-year
// receipt of the new year. Cancelling those receipts first (on the opening date) lets the year be opened.
import { Conflict, registry, repo, withLock, type Context, type HookArgs } from '@daifuku/kernel';
import { ACCOUNTING_PERIODS_LOCK, FiscalYear, OPENING_SOURCE } from '@daifuku/mod-accounting';
import { StockEntry } from '../entities/stock-entry.ts';

const SHOWN = 20;

async function assertNoOpeningStock(ctx: Context, { row }: HookArgs): Promise<void> {
  const { startDate, endDate } = row;
  if (typeof startDate !== 'string' || typeof endDate !== 'string') return;
  // The lock accounting's fiscal_year hooks and the opening stock import take, so neither misses the other's writes.
  await withLock(ctx, ACCOUNTING_PERIODS_LOCK, async () => undefined);
  const live = await repo(ctx, StockEntry).list({
    where: {
      sourceEntity: OPENING_SOURCE,
      docstatus: 1,
      $and: [{ date: { $gte: startDate } }, { date: { $lte: endDate } }],
    },
    orderBy: [{ field: 'date', dir: 'asc' }],
    limit: SHOWN,
  });
  if (live.total === 0) return;
  const receipts = live.items.map((e) => e.number ?? e.id);
  throw new Conflict(
    `fiscal year ${startDate}..${endDate} would contain ${live.total} submitted opening stock receipt(s): ${receipts.join(', ')}`,
    'Opening stock was imported for a later first year. Cancel the opening stock receipts (on the opening date) first, or keep the current first year.',
    { reason: 'opening_stock_exists', receipts, count: live.total },
  );
}

export function registerOpeningYearHooks(): void {
  registry.registerHook(FiscalYear.name, 'before_create', assertNoOpeningStock);
}
