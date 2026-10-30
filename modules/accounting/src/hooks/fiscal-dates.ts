// fiscal_year / fiscal_period date rules (spec AC-2): endDate ≥ startDate, and fiscal years never overlap.
// Registered as hooks so the generic <entity>.create/update path is covered, not only accounting.open_fiscal_year.
import {
  Conflict,
  Decimal,
  registry,
  repo,
  ValidationError,
  withLock,
  type Context,
  type HookArgs,
} from '@daifuku/kernel';
import { Account } from '../entities/account.ts';
import { FiscalPeriod } from '../entities/fiscal-period.ts';
import { JournalLine } from '../entities/journal-line.ts';
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
  throw new ValidationError(
    `${entity}: endDate ${range.endDate} is before startDate ${range.startDate}`,
    [{ path: 'endDate', message: 'must be on or after startDate' }],
    'Swap or correct the dates.',
  );
}

async function assertNoOverlap(ctx: Context, args: HookArgs): Promise<void> {
  await withLock(ctx, 'accounting-periods', async () => undefined);
  const range = rangeOf(args);
  if (!range) return;
  const id = typeof args.row.id === 'string' ? args.row.id : null;
  const others = await repo(ctx, FiscalYear).list({
    where: {
      $and: [
        { startDate: { $lte: range.endDate } },
        { endDate: { $gte: range.startDate } },
        ...(id ? [{ id: { $ne: id } }] : []),
      ],
    },
    limit: 1,
  });
  const hit = others.items[0];
  if (!hit) return;
  throw new Conflict(
    `fiscal year ${range.startDate}..${range.endDate} overlaps ${hit.code} (${hit.startDate}..${hit.endDate})`,
    'Choose a start date after the existing year ends, or adjust the existing year.',
    {
      overlaps: hit.code,
      fiscalYearId: hit.id,
    },
  );
}

async function assertPeriod(ctx: Context, args: HookArgs): Promise<void> {
  await withLock(ctx, 'accounting-periods', async () => undefined);
  const range = rangeOf(args);
  const yearId = args.row.fiscalYearId ?? args.previous?.fiscalYearId;
  if (!range || typeof yearId !== 'string') return;
  const year = await repo(ctx, FiscalYear).get(yearId);
  if (range.startDate < year.startDate || range.endDate > year.endDate) {
    throw new ValidationError('Fiscal period must be contained in its fiscal year', [
      { path: 'startDate', message: `must be within ${year.startDate}..${year.endDate}` },
    ]);
  }
  const id = args.row.id ?? args.previous?.id;
  const overlap = await repo(ctx, FiscalPeriod).list({
    where: {
      $and: [
        { startDate: { $lte: range.endDate } },
        { endDate: { $gte: range.startDate } },
        ...(typeof id === 'string' ? [{ id: { $ne: id } }] : []),
      ],
    },
    limit: 1,
  });
  if (overlap.items.length)
    throw new Conflict(
      'Fiscal periods cannot overlap within a company',
      'Choose a non-overlapping period within its fiscal year.',
    );
}

/**
 * docs/specs/opening-balances.md AC-4 (D-19): a year may not be opened over posted lines whose net per account is not
 * zero — opening balances (dated the day before the first year) would silently become in-year transactions. When every
 * opening entry and invoice was reversed on the opening date the net is zero and the year may be opened.
 */
async function assertNoPostedNet(ctx: Context, args: HookArgs): Promise<void> {
  const range = rangeOf(args);
  if (!range) return;
  const rows = await repo(ctx, JournalLine).aggregate({
    where: { posted: true, $and: [{ entryDate: { $gte: range.startDate } }, { entryDate: { $lte: range.endDate } }] },
    groupBy: ['accountId'],
    metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } },
  });
  const open = rows
    .filter((r) => !Decimal.from(r.debit as Decimal).eq(r.credit as Decimal))
    .map((r) => String(r.accountId));
  if (open.length === 0) return;
  const accounts = await repo(ctx, Account).list({ where: { id: { $in: open.slice(0, 50) } }, limit: 50 });
  throw new Conflict(
    `fiscal year ${range.startDate}..${range.endDate} would contain posted entries (opening balances) that do not net to zero`,
    'Opening balances were imported for a later first year. Reverse the opening journal and cancel the opening invoices on the opening date first, or keep the current first year.',
    { reason: 'opening_entries_exist', accounts: accounts.items.map((a) => a.code) },
  );
}

export function registerFiscalDateHooks(): void {
  registry.registerHook(FiscalYear.name, 'before_validate', (_ctx, args) => assertDateOrder(FiscalYear.name, args));
  registry.registerHook(FiscalPeriod.name, 'before_validate', (_ctx, args) => assertDateOrder(FiscalPeriod.name, args));
  registry.registerHook(FiscalYear.name, 'before_create', async (ctx, args) => {
    await assertNoOverlap(ctx, args);
    await assertNoPostedNet(ctx, args);
  });
  registry.registerHook(FiscalYear.name, 'before_update', (ctx, args) => assertNoOverlap(ctx, args));
  registry.registerHook(FiscalPeriod.name, 'before_create', assertPeriod);
  registry.registerHook(FiscalPeriod.name, 'before_update', assertPeriod);
}
