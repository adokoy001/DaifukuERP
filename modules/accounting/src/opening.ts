// Opening balances: the parts accounting shares with the module-owned imports (docs/specs/opening-balances.md D-11,
// ADR-0030). The fiscal-year conditions (AC-2), the clearing account (AC-28), the opening-date posting path (AC-3),
// the all-or-nothing runner with per-row savepoints (AC-25, AC-26) and the common result shape (AC-27).
// Every read and write goes through the caller's Repository; nothing here widens a role.
import {
  can,
  DaifukuError,
  Decimal,
  getCompany,
  PermissionDenied,
  repo,
  safeErrorDiagnostics,
  StateError,
  ValidationError,
  withSavepoint,
  IMPORT_MAX_BYTES,
  type Context,
  type EntityDef,
  type Infer,
  type LocalDate,
  type Op,
} from '@daifuku/kernel';
import { z } from 'zod';
import { postFromSource, type PostFromSourceInput } from './actions/post-from-source.ts';
import { reverseSourceEntry } from './actions/reverse-source.ts';
import type { ReverseEntryInput } from './actions/reverse-entry.ts';
import type { EntryWithLines } from './actions/helpers.ts';
import { withOpening } from './domain-write.ts';
import { Account } from './entities/account.ts';
import { JournalLine } from './entities/journal-line.ts';
import { earliestFiscalYear, type OpeningYear } from './opening-year.ts';
import { openingDateOf, type OpeningMessage, type OpeningRowResult } from './services/opening.ts';
import { OPENING_BALANCES_KEY, openingBalancesSetting } from './settings.ts';

type AccountRow = Infer<typeof Account>;

/** AC-5 / AC-6: the four imports, the reversal and the status are for accounting and admin only. */
export const OPENING_ROLES = ['accounting', 'admin'] as const;
/** AC-8: request size of every import (the B5 limit). */
export const OPENING_INPUT_BYTES = IMPORT_MAX_BYTES;

/** AC-26: imports post amounts in yen only. */
export async function assertOpeningCurrency(ctx: Context): Promise<void> {
  const company = await getCompany(ctx);
  if (company.currency !== 'JPY')
    throw new ValidationError('Opening balance import supports JPY companies only', [
      { path: 'currency', message: 'JPY is required; foreign-currency accounting is not implemented' },
    ]);
}

// ---- clearing account (AC-28) -----------------------------------------------------------------------

export type ClearingAccountState =
  | { ok: true; account: AccountRow; code: string }
  | {
      ok: false;
      reason: 'clearing_account_missing' | 'clearing_account_invalid';
      code: string;
      message: string;
      account?: AccountRow;
    };

const CLEARING_HINT = `Create the account (l10n/jp seeds 3900 期首残高仮勘定) or change the setting ${OPENING_BALANCES_KEY}.`;

export async function clearingAccountState(ctx: Context): Promise<ClearingAccountState> {
  const { clearingAccount: code } = await openingBalancesSetting(ctx);
  const account = (await repo(ctx, Account).list({ where: { code }, limit: 1 })).items[0];
  if (!account)
    return { ok: false, reason: 'clearing_account_missing', code, message: `account ${code} does not exist` };
  const problems = [
    account.isActive ? null : 'inactive',
    account.type === 'revenue' || account.type === 'expense' ? `a ${account.type} account` : null,
    account.partnerRequired ? 'requires a partner' : null,
    account.taxRole !== 'none' ? `has tax role ${account.taxRole}` : null,
  ].filter((p): p is string => p !== null);
  if (problems.length > 0)
    return {
      ok: false,
      reason: 'clearing_account_invalid',
      code,
      account,
      message: `account ${code} ${account.name} cannot be the clearing account: ${problems.join(', ')}`,
    };
  return { ok: true, account, code };
}

/** AC-28: the clearing account, or a request-level StateError naming the setting and the code. */
export async function resolveOpeningClearingAccount(ctx: Context): Promise<AccountRow> {
  const state = await clearingAccountState(ctx);
  if (state.ok) return state.account;
  throw new StateError(state.message, CLEARING_HINT, {
    reason: state.reason,
    setting: OPENING_BALANCES_KEY,
    code: state.code,
  });
}

/** AC-27: the balance (debit +) of an account over posted lines dated on or before `date`. */
export async function clearingBalanceAt(ctx: Context, accountId: string, date: LocalDate): Promise<Decimal> {
  const rows = await repo(ctx, JournalLine).aggregate({
    where: { posted: true, accountId, entryDate: { $lte: date } },
    groupBy: ['accountId'],
    metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } },
  });
  const row = rows[0];
  return row ? Decimal.from(row.debit as Decimal).minus(row.credit as Decimal) : Decimal.zero();
}

/** AC-28: posted lines on the clearing account dated other than the opening date (it is used by something else). */
export async function foreignClearingPostings(
  ctx: Context,
  accountId: string,
  openingDate: LocalDate,
): Promise<number> {
  return repo(ctx, JournalLine).count({ posted: true, accountId, entryDate: { $ne: openingDate } });
}

export function clearingUsedNotice(count: number): OpeningMessage {
  return {
    code: 'clearing_account_used',
    message: `the clearing account has ${count} posted line(s) dated other than the opening date`,
    hint: 'Use the clearing account only for opening balances, or choose another account in accounting.opening_balances.',
  };
}

// ---- the opening posting path (AC-3, AC-17, AC-19) ---------------------------------------------------

/** postFromSource on the opening path: the date must be the opening date of the company's first fiscal year. */
export async function postOpeningFromSource(ctx: Context, input: PostFromSourceInput): Promise<EntryWithLines> {
  const first = await earliestFiscalYear(ctx);
  if (!first || openingDateOf(first.startDate) !== input.date)
    throw new ValidationError(
      `opening postings are dated the opening date of the first fiscal year${first ? ` (${openingDateOf(first.startDate)})` : ''}`,
      [{ path: 'date', message: 'must be the opening date' }],
      'Import opening balances through the opening balance import.',
    );
  return withOpening(ctx, (internal) => postFromSource(internal, input));
}

/** reverseSourceEntry on the opening path (a reversal without a correction date is dated the opening date). */
export async function reverseOpeningSourceEntry(
  ctx: Context,
  input: ReverseEntryInput & { sourceEntity: string; sourceId: string },
): Promise<EntryWithLines> {
  return withOpening(ctx, (internal) => reverseSourceEntry(internal, input));
}

// ---- opening invoices (AC-17, AC-19) -------------------------------------------------------------------

export interface OpeningInvoiceLine {
  productId: string | null;
  taxCategory: string | null;
  accountId?: string | null;
}

/**
 * AC-17: an opening invoice has exactly one out-of-scope line without a product (a purchase line posts to the clearing
 * account) and is dated the opening date of the company's first fiscal year. Returns the clearing account.
 */
export async function assertOpeningInvoice(
  ctx: Context,
  input: { entity: string; id: string; date: LocalDate; lines: readonly OpeningInvoiceLine[]; lineAccount: boolean },
): Promise<AccountRow> {
  const clearing = await resolveOpeningClearingAccount(ctx);
  const first = await earliestFiscalYear(ctx);
  const openingDate = first ? openingDateOf(first.startDate) : null;
  const issues: { path: string; message: string }[] = [];
  if (input.lines.length !== 1)
    issues.push({ path: 'lines', message: `an opening invoice has exactly 1 line (got ${input.lines.length})` });
  for (const line of input.lines) {
    if (line.taxCategory !== 'out_of_scope')
      issues.push({ path: 'lines.taxCategory', message: 'must be out_of_scope' });
    if (line.productId) issues.push({ path: 'lines.productId', message: 'an opening line has no product' });
    if (input.lineAccount && line.accountId !== clearing.id)
      issues.push({ path: 'lines.accountId', message: `must be the clearing account ${clearing.code}` });
  }
  if (input.date !== openingDate)
    issues.push({ path: 'date', message: `must be the opening date${openingDate ? ` ${openingDate}` : ''}` });
  if (issues.length > 0)
    throw new ValidationError(
      `${input.entity} ${input.id} is not a valid opening invoice`,
      issues,
      'Opening invoices are created by the opening balance import; import the balance again instead of editing it.',
    );
  return clearing;
}

/** AC-19: a draft amended from a cancelled opening invoice would post as an ordinary invoice; it is refused. */
export async function assertNotOpeningAmend(ctx: Context, entity: EntityDef, row: Record<string, unknown>) {
  if (typeof row.amendedFrom !== 'string') return;
  const source = (await repo(ctx, entity).find(row.amendedFrom)) as Record<string, unknown> | null;
  if (source?.openingBalance !== true) return;
  throw new ValidationError(
    `${entity.name} ${String(row.id)} is amended from an opening invoice`,
    [{ path: 'amendedFrom', message: 'opening_amend: an amended opening invoice cannot be submitted' }],
    'Import the balance again with the opening balance import (/finance/opening) instead of amending.',
  );
}

// ---- permissions (AC-6) ----------------------------------------------------------------------------

/** AC-6: the caller must hold every listed op before any row is processed; one 403 names what is missing. */
export function assertOpeningOps(
  ctx: Context,
  action: string,
  needs: readonly [EntityDef, Op][],
  extra: string[] = [],
) {
  const missing = needs.filter(([entity, op]) => !can(ctx, entity, op)).map(([entity, op]) => `${entity.name}:${op}`);
  const all = [...missing, ...extra];
  // details.op names every missing `<entity>:<op>` (and extra rules), so one 403 says what to grant.
  if (all.length > 0) throw new PermissionDenied(action, `opening-import:${all.join(',')}`, ctx.roles);
}

// ---- rows and the all-or-nothing runner (AC-25, AC-26) ------------------------------------------------

/** Kernel errors and data/constraint SQL errors fail a row (ADR-0028); anything else fails the request. */
export function rowFailureMessages(err: unknown): OpeningMessage[] | undefined {
  if (err instanceof DaifukuError) {
    const issues =
      err instanceof ValidationError ? ((err.details?.issues as { path: string; message: string }[]) ?? []) : [];
    if (issues.length > 0)
      return issues.map((i) => ({
        code: err.code,
        message: i.path ? `${i.path}: ${i.message}` : i.message,
        ...(err.hint ? { hint: err.hint } : {}),
      }));
    return [{ code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) }];
  }
  const state = safeErrorDiagnostics(err).sqlState;
  if (state && (state.startsWith('22') || state.startsWith('23')))
    return [{ code: 'database', message: `the database rejected the row (SQLSTATE ${state})` }];
  return undefined;
}

/** Runs one unit in its own savepoint; a row-level failure is rolled back and returned as messages. */
export async function attempt<T>(
  ctx: Context,
  work: (ctx: Context) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; messages: OpeningMessage[] }> {
  try {
    return { ok: true, value: await withSavepoint(ctx, work) };
  } catch (err) {
    const messages = rowFailureMessages(err);
    if (!messages) throw err;
    return { ok: false, messages };
  }
}

const ROLLBACK = Symbol('opening import rollback');

/**
 * AC-25 / AC-26: runs the import inside one outer savepoint. A dry-run, or an execute with any row error or issue,
 * rolls it back; the value computed inside (row results, totals, balances measured before the rollback) is returned.
 */
export async function runOpeningImport<T extends { failed: boolean }>(
  ctx: Context,
  mode: 'dry-run' | 'execute',
  work: (ctx: Context) => Promise<T>,
): Promise<{ committed: boolean; value: T }> {
  let value: T | undefined;
  try {
    await withSavepoint(ctx, async (sp) => {
      value = await work(sp);
      if (mode === 'dry-run' || value.failed) throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
    return { committed: false, value: value as T };
  }
  return { committed: true, value: value as T };
}

// ---- code lookups (AC-7, AC-9, AC-15, AC-23) -----------------------------------------------------------

export type Lookup<R> = { ok: true; row: R } | { ok: false; message: OpeningMessage };

const LOOKUP_CHUNK = 200;

/**
 * Resolves code cells (then names, when `byName`) of `entity` through the caller's Repository in chunks: 0 matches is
 * `ref_not_found`, 2+ is `ref_ambiguous`. Rows of other companies are never visible (company scope + row rules).
 * Callers have already refused `$ctx.` text (readCode).
 */
export async function lookupByCode<E extends EntityDef>(
  ctx: Context,
  entity: E,
  field: string,
  texts: readonly string[],
  opts: { byName?: boolean; normalize?: (s: string) => string } = {},
): Promise<Map<string, Lookup<Infer<E>>>> {
  const norm = opts.normalize ?? ((s: string) => s);
  const unique = [...new Set(texts)];
  const byKey = async (key: 'code' | 'name', values: string[]): Promise<Map<string, Infer<E>[]>> => {
    const out = new Map<string, Infer<E>[]>();
    for (let i = 0; i < values.length; i += LOOKUP_CHUNK) {
      const chunk = values.slice(i, i + LOOKUP_CHUNK);
      const page = await repo(ctx, entity).list({ where: { [key]: { $in: chunk } }, limit: 500 });
      for (const row of page.items) {
        const k = String((row as Record<string, unknown>)[key]);
        out.set(k, [...(out.get(k) ?? []), row]);
      }
    }
    return out;
  };
  const codes = await byKey('code', [...new Set(unique.map(norm))]);
  const unresolved = unique.filter((t) => !codes.has(norm(t)));
  const names = opts.byName && unresolved.length > 0 ? await byKey('name', unresolved) : new Map<string, Infer<E>[]>();
  const result = new Map<string, Lookup<Infer<E>>>();
  for (const text of unique) {
    const hits = codes.get(norm(text)) ?? names.get(text) ?? [];
    if (hits.length === 1) result.set(text, { ok: true, row: hits[0] as Infer<E> });
    else
      result.set(text, {
        ok: false,
        message: {
          code: hits.length === 0 ? 'ref_not_found' : 'ref_ambiguous',
          message:
            hits.length === 0
              ? `no ${entity.name} has the code${opts.byName ? ' or name' : ''} "${text}"`
              : `${hits.length} ${entity.name} records have the name "${text}"`,
          field,
          column: field,
          hint: hits.length === 0 ? `Check the ${entity.name} code.` : 'Use the code instead of the name.',
        },
      });
  }
  return result;
}

// ---- result (AC-27) ------------------------------------------------------------------------------------

const messageSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
  column: z.string().optional(),
  hint: z.string().optional(),
});

export const openingImportResult = z.object({
  mode: z.enum(['dry-run', 'execute']),
  committed: z.boolean(),
  fiscalYear: z.object({ id: z.uuid(), code: z.string(), startDate: z.string() }),
  openingDate: z.string(),
  summary: z.object({
    rows: z.number().int(),
    accepted: z.number().int(),
    clearing: z.number().int(),
    skipped: z.number().int(),
    errors: z.number().int(),
  }),
  totals: z.record(z.string(), z.string()),
  clearingBalance: z.object({ before: z.string(), after: z.string() }).optional(),
  clearingAccounts: z
    .array(z.object({ code: z.string(), name: z.string(), debit: z.string(), credit: z.string() }))
    .optional(),
  issues: z.array(messageSchema),
  notices: z.array(messageSchema),
  rows: z.array(
    z.object({
      line: z.number().int().min(1),
      status: z.enum(['ok', 'clearing', 'skipped', 'error']),
      messages: z.array(messageSchema).optional(),
    }),
  ),
  documents: z.array(z.object({ entity: z.string(), id: z.uuid(), number: z.string().nullable() })),
});
export type OpeningImportResult = z.output<typeof openingImportResult>;
export type OpeningDocument = OpeningImportResult['documents'][number];

/** Common request fields of the four imports (AC-9, AC-15, AC-23): cells are strings or null. */
export const openingCell = z.string().max(1000).nullable().optional();
export const openingMode = z.enum(['dry-run', 'execute']);

export function openingYearJson(year: OpeningYear): Pick<OpeningImportResult, 'fiscalYear' | 'openingDate'> {
  return {
    fiscalYear: { id: year.fiscalYear.id, code: year.fiscalYear.code, startDate: year.fiscalYear.startDate },
    openingDate: year.openingDate,
  };
}

/** AC-27: the row list in request order, with a message list only when there is one. */
export function rowResult(line: number, status: OpeningRowResult['status'], messages?: OpeningMessage[]) {
  return messages && messages.length > 0 ? { line, status, messages } : { line, status };
}
