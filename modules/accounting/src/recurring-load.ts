// Reads behind recurring journals (docs/specs/recurring-journals.md), all through the repository port in the caller's
// context: template lines, the partnerRequired flag of their accounts, the company currency scale. Shared by
// hooks/recurring.ts and the generate / schedule actions.
import { currencyScale, Decimal, getCompany, repo, type Context, type Infer, type LocalDate } from '@daifuku/kernel';
import { Account } from './entities/account.ts';
import type { RecurringJournal } from './entities/recurring-journal.ts';
import { RecurringJournalLine } from './entities/recurring-journal.ts';
import type { RecurringFrequency, RecurringKind, Schedule, TemplateLine } from './services/recurrence.ts';

export type RecurringJournalRow = Infer<typeof RecurringJournal>;
export type RecurringJournalLineRow = Infer<typeof RecurringJournalLine>;
type Raw = Record<string, unknown>;

/** Decimals of the company currency (JPY: 0), the scale allocation shares are rounded to (AC-13). */
export async function companyScale(ctx: Context): Promise<number> {
  return currencyScale((await getCompany(ctx)).currency);
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const int = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/** The schedule of a domain row or a raw hook row (numbers and dates may arrive as strings). */
export function scheduleOf(row: Raw | RecurringJournalRow): Schedule {
  const r = row as Raw;
  return {
    kind: (str(r.kind) ?? 'fixed') as RecurringKind,
    frequency: (str(r.frequency) ?? 'monthly') as RecurringFrequency,
    dayOfMonth: int(r.dayOfMonth) ?? 31,
    startDate: (str(r.startDate) ?? '') as LocalDate,
    endDate: str(r.endDate) as LocalDate | null,
    allocationPeriods: int(r.allocationPeriods),
  };
}

export function lastOccurrenceOf(row: Raw | RecurringJournalRow): LocalDate | null {
  return str((row as Raw).lastOccurrenceDate) as LocalDate | null;
}

/** The template's lines in seq order (at most 500, the kernel's aggregate limit). */
export async function templateLines(ctx: Context, templateId: string): Promise<RecurringJournalLineRow[]> {
  const res = await repo(ctx, RecurringJournalLine).list({
    where: { templateId },
    orderBy: [{ field: 'seq', dir: 'asc' }],
    limit: 500,
  });
  return res.items;
}

const dec = (v: unknown): Decimal => (v instanceof Decimal ? v : Decimal.from(str(v) ?? '0'));

/** Lines as the pure template rules see them; an account that is missing or not visible counts as not requiring one. */
export async function templateLineChecks(ctx: Context, lines: readonly (Raw | RecurringJournalLineRow)[]) {
  const ids = [...new Set(lines.map((l) => str((l as Raw).accountId)).filter((v): v is string => v !== null))];
  const accounts = ids.length ? (await repo(ctx, Account).list({ where: { id: { $in: ids } }, limit: 500 })).items : [];
  const required = new Map(accounts.map((a) => [a.id, a.partnerRequired]));
  return lines.map((l): TemplateLine => ({
    debit: dec((l as Raw).debit),
    credit: dec((l as Raw).credit),
    partnerId: str((l as Raw).partnerId),
    partnerRequired: required.get(str((l as Raw).accountId) ?? '') ?? false,
  }));
}
