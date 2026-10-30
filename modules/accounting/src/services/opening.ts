// Pure rules of the opening-balance import (docs/specs/opening-balances.md AC-1, AC-9..AC-11, AC-15, AC-23, AC-27):
// the opening date, cell reading with the B5 conversions (kernel decimalCell / dateCell / isContextToken, ADR-0028), the
// per-row classification of the opening journal and the totals. No DB here; modules/accounting/test/opening-balances.test.ts.
import { Decimal, dateCell, decimalCell, isContextToken, type LocalDate } from '@daifuku/kernel';

/** Same shape as the kernel's ImportMessage (B5), so the screen explains both with one table. */
export interface OpeningMessage {
  code: string;
  message: string;
  field?: string;
  column?: string;
  hint?: string;
}

export type OpeningRowStatus = 'ok' | 'clearing' | 'skipped' | 'error';

export interface OpeningRowResult {
  /** 1-based index of the row in the request. */
  line: number;
  status: OpeningRowStatus;
  messages?: OpeningMessage[];
}

/** Every amount and quantity of the import is limited to this scale (stock_entry_line / stock_ledger use 6). */
export const OPENING_SCALE = 6;

/** AC-1: the calendar day before the fiscal year's first day (2026-04-01 -> 2026-03-31, 2024-03-01 -> 2024-02-29). */
export function openingDateOf(startDate: LocalDate): LocalDate {
  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function isMessage(v: unknown): v is OpeningMessage {
  return typeof v === 'object' && v !== null && 'code' in v && 'message' in v && !(v instanceof Decimal);
}

export function fieldMessage(field: string, code: string, message: string, hint?: string): OpeningMessage {
  return { code, message, field, column: field, ...(hint ? { hint } : {}) };
}

export function isBlank(raw: string | null | undefined): boolean {
  return raw === null || raw === undefined || raw.trim() === '';
}

/** A number cell: undefined when blank, an `invalid_value` message when it does not read as a decimal (AC-9, AC-15, AC-23). */
export function readDecimal(field: string, raw: string | null | undefined): Decimal | undefined | OpeningMessage {
  if (isBlank(raw)) return undefined;
  const s = decimalCell(raw ?? '');
  return s === undefined
    ? fieldMessage(field, 'invalid_value', `"${raw ?? ''}" is not a number`, 'Write digits, for example 1234 or 1,234.')
    : Decimal.from(s);
}

/** A date cell (YYYY-MM-DD or YYYY/M/D): undefined when blank, `invalid_value` when it does not read as a date. */
export function readDate(field: string, raw: string | null | undefined): LocalDate | undefined | OpeningMessage {
  if (isBlank(raw)) return undefined;
  const d = dateCell(raw ?? '');
  return d === undefined
    ? fieldMessage(field, 'invalid_value', `"${raw ?? ''}" is not a date`, 'Write YYYY-MM-DD or YYYY/M/D.')
    : d;
}

/**
 * A code or name cell: trimmed text, undefined when blank. Text starting with `$ctx.` is refused without a query
 * (Repository reads it as a context token; ADR-0028 decision 7, spec D-12).
 */
export function readCode(field: string, raw: string | null | undefined): string | undefined | OpeningMessage {
  if (isBlank(raw)) return undefined;
  const s = (raw ?? '').trim();
  return isContextToken(s)
    ? fieldMessage(
        field,
        'invalid_value',
        `"${s}" starts with "$ctx.", which is reserved for context tokens and cannot be matched`,
        'Change the value (for example, drop the leading "$").',
      )
    : s;
}

export function isWholeYen(amount: Decimal): boolean {
  return amount.eq(amount.roundHalfUp(0));
}

function fitsScale(value: Decimal): boolean {
  return value.eq(value.roundHalfUp(OPENING_SCALE));
}

// ---- opening journal (AC-9..AC-11) -----------------------------------------------------------------

export type JournalAmount =
  | { status: 'skipped'; messages: OpeningMessage[] }
  | { status: 'error'; messages: OpeningMessage[] }
  | { status: 'ok'; side: 'debit' | 'credit'; amount: Decimal };

/** AC-9 steps up to the whole-yen check, in the spec's order. */
export function classifyJournalAmounts(row: {
  debit?: string | null | undefined;
  credit?: string | null | undefined;
}): JournalAmount {
  const debit = readDecimal('debit', row.debit);
  const credit = readDecimal('credit', row.credit);
  const unreadable = [debit, credit].filter(isMessage);
  if (unreadable.length > 0) return { status: 'error', messages: unreadable };
  const d = (debit as Decimal | undefined) ?? Decimal.zero();
  const c = (credit as Decimal | undefined) ?? Decimal.zero();
  if (d.isZero() && c.isZero())
    return { status: 'skipped', messages: [{ code: 'zero_amount', message: 'debit and credit are both blank or 0' }] };
  const negative = d.isNegative() ? 'debit' : c.isNegative() ? 'credit' : null;
  if (negative)
    return {
      status: 'error',
      messages: [
        fieldMessage(
          negative,
          'negative_amount',
          `${negative} is negative`,
          'Put the amount on the other side as a positive number.',
        ),
      ],
    };
  if (d.gt(0) && c.gt(0))
    return {
      status: 'error',
      messages: [
        {
          code: 'both_sides',
          message: 'a row has either a debit or a credit, not both',
          hint: 'Split it into two rows, or write the net amount on one side.',
        },
      ],
    };
  const side = d.gt(0) ? 'debit' : 'credit';
  const amount = side === 'debit' ? d : c;
  if (!isWholeYen(amount))
    return {
      status: 'error',
      messages: [fieldMessage(side, 'not_whole_yen', `${amount.toString()} has a fraction of a yen`)],
    };
  return { status: 'ok', side, amount };
}

export interface ClassifiedAccount {
  id: string;
  code: string;
  name: string;
  type: string;
  partnerRequired: boolean;
}

/** AC-9: profit-and-loss accounts and the clearing account itself are refused. */
export function accountRowIssue(account: ClassifiedAccount, clearingAccountId: string): OpeningMessage | null {
  if (account.type === 'revenue' || account.type === 'expense')
    return fieldMessage(
      'accountCode',
      'pl_account',
      `${account.code} ${account.name} is a ${account.type} account; opening balances are balance-sheet accounts only`,
      'Include the previous profit or loss in retained earnings (法人) or capital (個人事業者) and import that balance.',
    );
  if (account.id === clearingAccountId)
    return fieldMessage(
      'accountCode',
      'clearing_account',
      `${account.code} ${account.name} is the opening balance clearing account`,
      'Leave it out: the import posts to it by itself (accounting.opening_balances).',
    );
  return null;
}

/**
 * AC-10: the memo of a row moved to the clearing account always names the original account (the status and AC-32 name
 * the moved accounts from it); the row's own memo, when given, follows.
 */
export function clearingMemo(account: Pick<ClassifiedAccount, 'code' | 'name'>, memo?: string | null): string {
  return `期首残高 ${account.code} ${account.name}（取引先別は期首請求書）${memo ? ` ${memo}` : ''}`.slice(0, 200);
}

export interface SidedAmount {
  side: 'debit' | 'credit';
  amount: Decimal;
}

/** AC-11: Σdebit, Σcredit and their difference (debit − credit), exact Decimal. */
export function journalTotals(lines: readonly SidedAmount[]): { debit: Decimal; credit: Decimal; difference: Decimal } {
  const debit = Decimal.sum(lines.filter((l) => l.side === 'debit').map((l) => l.amount));
  const credit = Decimal.sum(lines.filter((l) => l.side === 'credit').map((l) => l.amount));
  return { debit, credit, difference: debit.minus(credit) };
}

/** AC-11: `unbalanced` / `no_lines` issues for the accepted rows (empty when the journal can be posted). */
export function journalIssues(lines: readonly SidedAmount[]): OpeningMessage[] {
  if (lines.length < 2)
    return [
      {
        code: 'no_lines',
        message: `an opening journal needs at least 2 accepted rows (got ${lines.length})`,
        hint: 'Add the balance-sheet accounts of the opening trial balance.',
      },
    ];
  const t = journalTotals(lines);
  if (t.difference.isZero()) return [];
  return [
    {
      code: 'unbalanced',
      message: `debit total ${t.debit.toString()} and credit total ${t.credit.toString()} differ by ${t.difference.abs().toString()}`,
      hint: 'Every opening trial balance has equal debit and credit totals; check the rows against it.',
    },
  ];
}

// ---- receivables / payables (AC-15) ----------------------------------------------------------------

/** AC-15: a positive whole-yen amount; blank and 0 are `zero_amount`. */
export function readOpeningAmount(field: string, raw: string | null | undefined): Decimal | OpeningMessage {
  const value = readDecimal(field, raw);
  if (isMessage(value)) return value;
  if (value === undefined || value.isZero())
    return fieldMessage(field, 'zero_amount', 'the amount is blank or 0', 'Leave the row out when nothing is open.');
  if (value.isNegative())
    return fieldMessage(
      field,
      'negative_amount',
      `${value.toString()} is negative`,
      'A credit balance of a customer (overpayment, advance) goes into the opening journal as 前受金 with the partner.',
    );
  if (!isWholeYen(value)) return fieldMessage(field, 'not_whole_yen', `${value.toString()} has a fraction of a yen`);
  return value;
}

// ---- stock (AC-23) ---------------------------------------------------------------------------------

/** AC-23: quantity > 0 with at most 6 decimals. */
export function readOpeningQuantity(raw: string | null | undefined): Decimal | OpeningMessage {
  const value = readDecimal('quantity', raw);
  if (isMessage(value)) return value;
  if (value === undefined || !value.gt(0))
    return fieldMessage('quantity', 'non_positive_quantity', 'the quantity must be greater than 0');
  if (!fitsScale(value))
    return fieldMessage('quantity', 'scale_exceeded', `${value.toString()} has more than ${OPENING_SCALE} decimals`);
  return value;
}

/** AC-23: unit cost ≥ 0 with at most 6 decimals (blank is not 0: the cost must be written). */
export function readOpeningUnitCost(raw: string | null | undefined): Decimal | OpeningMessage {
  const value = readDecimal('unitCost', raw);
  if (isMessage(value)) return value;
  if (value === undefined) return fieldMessage('unitCost', 'invalid_value', 'the unit cost is required');
  if (value.isNegative()) return fieldMessage('unitCost', 'negative_amount', `${value.toString()} is negative`);
  if (!fitsScale(value))
    return fieldMessage('unitCost', 'scale_exceeded', `${value.toString()} has more than ${OPENING_SCALE} decimals`);
  return value;
}

// ---- result (AC-27) --------------------------------------------------------------------------------

export interface OpeningSummary {
  rows: number;
  accepted: number;
  clearing: number;
  skipped: number;
  errors: number;
}

export function summarize(rows: readonly OpeningRowResult[]): OpeningSummary {
  const count = (status: OpeningRowStatus) => rows.filter((r) => r.status === status).length;
  return {
    rows: rows.length,
    accepted: count('ok') + count('clearing'),
    clearing: count('clearing'),
    skipped: count('skipped'),
    errors: count('error'),
  };
}
