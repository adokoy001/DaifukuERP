// fiscal_year / fiscal_period date rules (spec AC-2): endDate ≥ startDate, and fiscal years never overlap.
// Registered as hooks so the generic <entity>.create/update path is covered, not only accounting.open_fiscal_year.
import { Conflict, registry, repo, ValidationError, withLock, type Context, type HookArgs } from '@daifuku/kernel';
import { FiscalPeriod } from '../entities/fiscal-period.ts';
import { FiscalYear } from '../entities/fiscal-year.ts';
import { isValidRange, type DateRange } from '../services/periods.ts';

function rangeOf({ row, previous }: HookArgs): DateRange | null {
  const startDate = row.startDate ?? previous?.startDate;
  const endDate = row.endDate ?? previous?.endDate;
  if (typeof startDate !== 'string' || typeof endDate !== 'string') return null;
  return { startDate, endDate };
}

function assertDateOrder(entity: string, args: HookArgs): void {
  const range = rangeOf(args);
  if (!range || isValidRange(range)) return;
  throw new ValidationError(`${entity}: endDate ${range.endDate} is before startDate ${range.startDate}`, [{ path: 'endDate', message: 'must be on or after startDate' }], 'Swap or correct the dates.');
}

async function assertNoOverlap(ctx: Context, args: HookArgs): Promise<void> {
  await withLock(ctx, 'accounting-periods', async () => undefined);
  const range = rangeOf(args);
  if (!range) return;
  const id = typeof args.row.id === 'string' ? args.row.id : null;
  const others = await repo(ctx, FiscalYear).list({
    where: { $and: [{ startDate: { $lte: range.endDate } }, { endDate: { $gte: range.startDate } }, ...(id ? [{ id: { $ne: id } }] : [])] },
    limit: 1,
  });
  const hit = others.items[0];
  if (!hit) return;
  throw new Conflict(`fiscal year ${range.startDate}..${range.endDate} overlaps ${hit.code} (${hit.startDate}..${hit.endDate})`, 'Choose a start date after the existing year ends, or adjust the existing year.', {
    overlaps: hit.code,
    fiscalYearId: hit.id,
  });
}

async function assertPeriod(ctx: Context, args: HookArgs): Promise<void> {
  await withLock(ctx, 'accounting-periods', async () => undefined);
  const range = rangeOf(args);
  const yearId = args.row.fiscalYearId ?? args.previous?.fiscalYearId;
  if (!range || typeof yearId !== 'string') return;
  const year = await repo(ctx, FiscalYear).get(yearId);
  if (range.startDate < year.startDate || range.endDate > year.endDate) {
    throw new ValidationError('Fiscal period must be contained in its fiscal year', [{ path: 'startDate', message: `must be within ${year.startDate}..${year.endDate}` }]);
  }
  const id = args.row.id ?? args.previous?.id;
  const overlap = await repo(ctx, FiscalPeriod).list({ where: { $and: [
    { startDate: { $lte: range.endDate } }, { endDate: { $gte: range.startDate } },
    ...(typeof id === 'string' ? [{ id: { $ne: id } }] : []),
  ] }, limit: 1 });
  if (overlap.items.length) throw new Conflict('Fiscal periods cannot overlap within a company', 'Choose a non-overlapping period within its fiscal year.');
}

export function registerFiscalDateHooks(): void {
  registry.registerHook(FiscalYear.name, 'before_validate', (_ctx, args) => assertDateOrder(FiscalYear.name, args));
  registry.registerHook(FiscalPeriod.name, 'before_validate', (_ctx, args) => assertDateOrder(FiscalPeriod.name, args));
  registry.registerHook(FiscalYear.name, 'before_create', (ctx, args) => assertNoOverlap(ctx, args));
  registry.registerHook(FiscalYear.name, 'before_update', (ctx, args) => assertNoOverlap(ctx, args));
  registry.registerHook(FiscalPeriod.name, 'before_create', assertPeriod);
  registry.registerHook(FiscalPeriod.name, 'before_update', assertPeriod);
}
