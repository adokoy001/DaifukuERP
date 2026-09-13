// journal_entry submit hooks (spec AC-4). before_submit: ≥2 lines, debit XOR credit, Σdebit = Σcredit (exact), date in
// an open period, partner where the account requires one; on success the totals are set on the header (written by the
// kernel together with docstatus/number). after_submit: each line is stamped with entryDate/posted so reports can
// filter posted lines without a join — done after the header is submitted so hooks/freeze-lines.ts can prove the stamp
// is the parent's truth and nothing else may write those columns.
import {
  registry,
  repo,
  StateError,
  withLock,
  ValidationError,
  type Context,
  type Infer,
  type LocalDate,
} from '@daifuku/kernel';
import { withStamp } from '../domain-write.ts';
import { Account } from '../entities/account.ts';
import { FiscalPeriod } from '../entities/fiscal-period.ts';
import { FiscalYear } from '../entities/fiscal-year.ts';
import { JournalEntry } from '../entities/journal-entry.ts';
import { JournalLine } from '../entities/journal-line.ts';
import { validateLines, type LineCheck } from '../services/balance.ts';

type LineRow = Infer<typeof JournalLine>;
type AccountRow = Infer<typeof Account>;

export const PERIOD_HINT = 'open the period or change the date';

export async function loadLines(ctx: Context, entryId: string): Promise<LineRow[]> {
  const res = await repo(ctx, JournalLine).list({
    where: { entryId },
    orderBy: [{ field: 'seq', dir: 'asc' }],
    limit: 500,
  });
  if (res.total > res.items.length)
    throw new ValidationError('Journal lines exceed the supported 500-line aggregate limit', [
      { path: 'lines', message: 'at most 500 lines; no partial posting is permitted' },
    ]);
  return res.items;
}

async function loadAccounts(ctx: Context, ids: readonly string[]): Promise<Map<string, AccountRow>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, AccountRow>();
  if (unique.length === 0) return out;
  const res = await repo(ctx, Account).list({ where: { id: { $in: unique } }, limit: 500 });
  for (const a of res.items) out.set(a.id, a);
  return out;
}

/** The fiscal period containing `date`, or null. Throws StateError when it (or its year) is closed. */
export async function assertOpenPeriod(ctx: Context, date: LocalDate): Promise<Infer<typeof FiscalPeriod>> {
  await withLock(ctx, 'accounting-periods', async () => undefined);
  const periods = await repo(ctx, FiscalPeriod).list({
    where: { $and: [{ startDate: { $lte: date } }, { endDate: { $gte: date } }] },
    limit: 1,
  });
  const period = periods.items[0];
  if (!period) {
    throw new StateError(
      `no fiscal period contains ${date}`,
      `Create the fiscal year with accounting.open_fiscal_year, then ${PERIOD_HINT}.`,
      { date },
    );
  }
  if (period.isClosed)
    throw new StateError(
      `fiscal period ${period.code} is closed`,
      `Reopen it with accounting.reopen_period (${PERIOD_HINT}).`,
      { date, periodId: period.id, code: period.code },
    );
  const year = await repo(ctx, FiscalYear).get(period.fiscalYearId);
  if (year.isClosed)
    throw new StateError(`fiscal year ${year.code} is closed`, `The year is closed; ${PERIOD_HINT}.`, {
      date,
      fiscalYearId: year.id,
      code: year.code,
    });
  return period;
}

export function registerValidateEntryHook(): void {
  registry.registerHook(JournalEntry.name, 'before_submit', async (ctx, { row }) => {
    const entryId = row.id as string;
    const date = row.date as LocalDate;
    const lines = await loadLines(ctx, entryId);
    const accounts = await loadAccounts(
      ctx,
      lines.map((l) => l.accountId),
    );
    const checks: LineCheck[] = lines.map((l) => ({
      seq: l.seq,
      debit: l.debit,
      credit: l.credit,
      partnerId: l.partnerId,
      partnerRequired: accounts.get(l.accountId)?.partnerRequired ?? false,
    }));
    const result = validateLines(checks);
    if (result.issues.length > 0) {
      throw new ValidationError(
        `journal_entry ${entryId} cannot be submitted`,
        result.issues,
        'Fix the lines (each line debit XOR credit > 0, totals equal, partner where required) and submit again.',
      );
    }
    await assertOpenPeriod(ctx, date);
    row.totalDebit = result.totalDebit;
    row.totalCredit = result.totalCredit;
  });
  registry.registerHook(JournalEntry.name, 'after_submit', async (ctx, { row }) => {
    const entryId = row.id as string;
    const date = row.date as LocalDate;
    await withStamp(ctx, async (internal) => {
      for (const l of await loadLines(ctx, entryId)) {
        const account = await repo(ctx, Account).get(l.accountId);
        await repo(internal, JournalLine).update(l.id, {
          entryDate: date,
          posted: true,
          accountType: account.type,
          accountTaxRole: account.taxRole,
        });
      }
    });
  });
}
