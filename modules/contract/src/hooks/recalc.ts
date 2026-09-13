// contract header hooks (spec AC-1/AC-2).
// before_validate: on create the system-owned fields are reset (status 'draft', nextPeriod null — this also cleans a
//   copy made by amend) and prorationRule defaults to the company setting contract.default_proration; on every write the
//   merged endDate must be on or after startDate.
// before_update: the system-owned fields are re-derived whatever the patch said — a draft stays 'draft'/null; a
//   submitted contract gets status from endDate and today (ended once endDate is before this month) and nextPeriod
//   from the contract_billing ledger. contract.end, generation (which touches the contract after writing the ledger)
//   and a tampered generic update therefore all end in the same derived state. submit/cancel write through the
//   kernel's rawUpdate (no update hooks), so hooks/submit.ts and hooks/cancel.ts set the fields themselves.
import {
  DOCSTATUS,
  isLocalDate,
  registry,
  todayLocal,
  ValidationError,
  type Context,
  type HookArgs,
  type LocalDate,
} from '@daifuku/kernel';
import { Contract } from '../entities/contract.ts';
import { billingsOf } from '../ledger.ts';
import { nextPeriodOf, statusFor } from '../services/periods.ts';
import { loadDefaultProration } from '../settings.ts';

type Raw = Record<string, unknown>;

/** Fields the caller never controls. */
export const SYSTEM_OWNED_FIELDS = ['status', 'nextPeriod'] as const;

export const DATE_RANGE_HINT = 'Set endDate on or after startDate, or leave it empty for an open-ended contract.';

function merged(row: Raw, previous: Raw | undefined, key: string): unknown {
  return row[key] !== undefined ? row[key] : previous?.[key];
}

function asDate(v: unknown): LocalDate | null {
  return typeof v === 'string' && isLocalDate(v) ? v : null;
}

/** VALIDATION (path endDate) when endDate < startDate; malformed values are left for zod to report. */
export function assertDateRange(startDate: unknown, endDate: unknown): void {
  const start = asDate(startDate);
  const end = asDate(endDate);
  if (start === null || end === null || end >= start) return;
  throw new ValidationError(
    `contract endDate ${end} is before startDate ${start}`,
    [{ path: 'endDate', message: `must be >= startDate (${start})` }],
    DATE_RANGE_HINT,
  );
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (!previous) {
    Object.assign(row, { status: 'draft', nextPeriod: null });
    if (row.prorationRule === undefined || row.prorationRule === null)
      row.prorationRule = await loadDefaultProration(ctx);
  }
  assertDateRange(merged(row, previous, 'startDate'), merged(row, previous, 'endDate'));
}

/** status and nextPeriod of a submitted contract as of today and its ledger. */
export async function derivedState(
  ctx: Context,
  row: Raw,
): Promise<{ status: 'active' | 'ended'; nextPeriod: string | null }> {
  const start = asDate(row.startDate);
  const interval = typeof row.intervalMonths === 'number' ? row.intervalMonths : 1;
  const status = statusFor(asDate(row.endDate), todayLocal(ctx.now()));
  if (start === null || typeof row.id !== 'string') return { status, nextPeriod: null };
  const billed = (await billingsOf(ctx, row.id)).map((b) => b.period);
  return { status, nextPeriod: nextPeriodOf(start, interval, billed) };
}

async function beforeUpdate(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.docstatus === DOCSTATUS.draft) {
    Object.assign(row, { status: 'draft', nextPeriod: null });
    return;
  }
  if (row.docstatus === DOCSTATUS.submitted) Object.assign(row, await derivedState(ctx, row));
}

export function registerRecalcHooks(): void {
  registry.registerHook(Contract.name, 'before_validate', beforeValidate);
  registry.registerHook(Contract.name, 'before_update', beforeUpdate);
}
