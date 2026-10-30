// Opening balances: the fiscal-year rules (docs/specs/opening-balances.md AC-1..AC-3, ADR-0030). Kept apart from
// opening.ts so the journal_entry submit hook can use them without importing the posting actions (no import cycle).
import { NotFound, repo, StateError, withLock, type Context, type Infer, type LocalDate } from '@daifuku/kernel';
import { FiscalPeriod } from './entities/fiscal-period.ts';
import { FiscalYear } from './entities/fiscal-year.ts';
import { openingDateOf } from './services/opening.ts';

type FiscalYearRow = Infer<typeof FiscalYear>;
type FiscalPeriodRow = Infer<typeof FiscalPeriod>;

export const OPENING_REOPEN_HINT = 'Reopen the period with accounting.reopen_period, then import again.';

/** The company-wide lock that fiscal_year creation, the period close and every posting-date check take. */
export const ACCOUNTING_PERIODS_LOCK = 'accounting-periods';

export interface OpeningYear {
  fiscalYear: FiscalYearRow;
  openingDate: LocalDate;
  firstPeriod: FiscalPeriodRow;
}

export type OpeningYearReason = 'not_earliest' | 'year_closed' | 'first_period_closed' | 'no_first_period';

const REASON_TEXT: Record<OpeningYearReason, [string, string]> = {
  not_earliest: [
    'opening balances can be imported only into the company’s first fiscal year',
    'An earlier fiscal year exists: its balances carry forward into the trial balance by themselves.',
  ],
  year_closed: ['the fiscal year is closed', 'Opening balances cannot be posted into a closed year.'],
  first_period_closed: ['the first fiscal period of the year is closed', OPENING_REOPEN_HINT],
  no_first_period: [
    'the fiscal year has no period starting on its first day',
    'Open the fiscal year with accounting.open_fiscal_year (it creates the 12 periods).',
  ],
};

export function openingYearError(year: Pick<FiscalYearRow, 'id' | 'code'>, reason: OpeningYearReason): StateError {
  const [message, hint] = REASON_TEXT[reason];
  return new StateError(`${year.code}: ${message}`, hint, { reason, fiscalYearId: year.id, code: year.code });
}

/** The earliest fiscal year of the company (by start date), or undefined. */
export async function earliestFiscalYear(ctx: Context): Promise<FiscalYearRow | undefined> {
  return (await repo(ctx, FiscalYear).list({ orderBy: [{ field: 'startDate', dir: 'asc' }], limit: 1 })).items[0];
}

async function firstPeriodOf(ctx: Context, year: FiscalYearRow): Promise<FiscalPeriodRow | undefined> {
  return (await repo(ctx, FiscalPeriod).list({ where: { fiscalYearId: year.id, startDate: year.startDate }, limit: 1 }))
    .items[0];
}

/** AC-2 (b)(c)(d) without throwing: the reason the year cannot take opening balances, or null. */
export async function openingYearProblem(
  ctx: Context,
  year: FiscalYearRow,
): Promise<{ reason: OpeningYearReason; firstPeriod?: undefined } | { reason: null; firstPeriod: FiscalPeriodRow }> {
  if ((await repo(ctx, FiscalYear).count({ startDate: { $lt: year.startDate } })) > 0)
    return { reason: 'not_earliest' };
  if (year.isClosed) return { reason: 'year_closed' };
  const firstPeriod = await firstPeriodOf(ctx, year);
  if (!firstPeriod) return { reason: 'no_first_period' };
  if (firstPeriod.isClosed) return { reason: 'first_period_closed' };
  return { reason: null, firstPeriod };
}

/** AC-2: the fiscal year must be readable by the caller (else 404) and be the company's first, open year. */
export async function assertOpeningYear(ctx: Context, fiscalYearId: string): Promise<OpeningYear> {
  const fiscalYear = await repo(ctx, FiscalYear).find(fiscalYearId);
  if (!fiscalYear) throw new NotFound(FiscalYear.name, fiscalYearId);
  const problem = await openingYearProblem(ctx, fiscalYear);
  if (problem.reason !== null) throw openingYearError(fiscalYear, problem.reason);
  return { fiscalYear, openingDate: openingDateOf(fiscalYear.startDate), firstPeriod: problem.firstPeriod };
}

/**
 * AC-4 / D-14: AC-2 checked again under ACCOUNTING_PERIODS_LOCK (held to the end of the transaction). An import that
 * posts no journal line (opening stock) calls it after its writes: an earlier year opened concurrently has either
 * committed first (this refuses with not_earliest) or waits for this transaction and its fiscal_year before_create
 * hooks then see the committed opening documents.
 */
export async function assertOpeningYearLocked(ctx: Context, fiscalYearId: string): Promise<OpeningYear> {
  await withLock(ctx, ACCOUNTING_PERIODS_LOCK, async () => undefined);
  return assertOpeningYear(ctx, fiscalYearId);
}

/**
 * AC-3 (used by the journal_entry submit hook on the opening path only): when `date` is the opening date of the
 * company's first fiscal year, returns true if posting on it is allowed and throws when the year or its first period
 * is closed. Returns false for any other date (the ordinary period rule then applies).
 */
export async function openingDateAllowed(ctx: Context, date: LocalDate): Promise<boolean> {
  const containing = await repo(ctx, FiscalPeriod).count({
    $and: [{ startDate: { $lte: date } }, { endDate: { $gte: date } }],
  });
  if (containing > 0) return false;
  const first = await earliestFiscalYear(ctx);
  if (!first || openingDateOf(first.startDate) !== date) return false;
  const problem = await openingYearProblem(ctx, first);
  if (problem.reason !== null) throw openingYearError(first, problem.reason);
  return true;
}
