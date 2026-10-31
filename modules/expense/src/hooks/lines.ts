// expense_settlement_line hooks (spec AC-4, AC-5, D28).
// before_validate (caller writes; internal recalculation writes carry the capability and skip): the roles, a parent
//   that is not the caller's own settlement (AC-15, also on delete), a draft parent, then under the employee lock the
//   AC-4 checks of the expense (VALIDATION with every issue) and the overlap with another draft or submitted
//   settlement (CONFLICT naming it). The expense's user, date and description are copied (server-owned); account and
//   tax category default from `expense.accounts.defaultExpense`; the invoice fields that do not apply to the chosen
//   kind or category are cleared.
// after_create/update/delete (direct line writes only): recalculate the parent; a replace-all save recalculates once
//   in the header's after_lines_saved instead.
import {
  Conflict,
  DOCSTATUS,
  hasWriteCapability,
  isSavingLines,
  isUuid,
  registry,
  repo,
  StateError,
  ValidationError,
  type Context,
  type HookArgs,
} from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { isZeroRateCategory, type TaxCategory } from '@daifuku/mod-tax';
import { lockEmployeeForSettlement, WorkforceExpense } from '@daifuku/mod-workforce';
import { refuseSelfSettlement, requireSettlementRoles } from '../access.ts';
import type { ExpenseSettlementKind } from '../contract.ts';
import { ExpenseSettlement, ExpenseSettlementLine } from '../entities/index.ts';
import { expenseIssues, liveSettlementOf, zeroIfMissing } from '../services/load.ts';
import { loadExpenseAccountCodes } from '../settings.ts';
import { recalculateSettlement } from './recalc.ts';

type Raw = Record<string, unknown>;
const L = ExpenseSettlementLine.name;

export const FROZEN_HINT = 'Cancel and amend the settlement to change its lines (ADR-0006).';

function merged(row: Raw, previous: Raw | undefined, key: string): unknown {
  return row[key] !== undefined ? row[key] : previous?.[key];
}

async function parentOf(ctx: Context, id: unknown) {
  if (typeof id !== 'string' || !isUuid(id)) return null;
  return repo(ctx, ExpenseSettlement).find(id);
}

async function defaultAccount(ctx: Context): Promise<{ id: string; taxCategory: TaxCategory }> {
  const code = (await loadExpenseAccountCodes(ctx)).defaultExpense;
  const found = await repo(ctx, Account).list({ where: { code }, limit: 1 });
  const account = found.items[0];
  if (!account)
    throw new ValidationError(
      `no account has code ${code} (expense.accounts.defaultExpense)`,
      [{ path: 'accountId', message: `required: default account code ${code} does not exist` }],
      'Pass accountId, create the account, or change expense.accounts.',
    );
  return { id: account.id, taxCategory: (account.taxCategoryDefault ?? 'standard') as TaxCategory };
}

function normalizeInvoiceFields(row: Raw, previous: Raw | undefined): void {
  const category = merged(row, previous, 'taxCategory') as TaxCategory;
  const kind = merged(row, previous, 'invoiceKind');
  const clear = (key: string) => {
    if (merged(row, previous, key) !== null && merged(row, previous, key) !== undefined) row[key] = null;
  };
  if (isZeroRateCategory(category)) {
    clear('invoiceKind');
    clear('booksOnlyReason');
    clear('invoiceRegistrationNo');
    return;
  }
  if (kind !== 'books_only') clear('booksOnlyReason');
  if (kind !== 'qualified') clear('invoiceRegistrationNo');
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (hasWriteCapability(ctx, L, previous ? 'update' : 'create')) return; // computed fields from recalc
  requireSettlementRoles(ctx, ExpenseSettlement.name, 'update');
  const parent = await parentOf(ctx, merged(row, previous, 'settlementId'));
  if (!parent) return; // FK reports it
  refuseSelfSettlement(ctx, ExpenseSettlement.name, 'update', parent.userId);
  if (parent.docstatus !== DOCSTATUS.draft)
    throw new StateError(`${ExpenseSettlement.name} ${parent.number ?? parent.id} is not a draft`, FROZEN_HINT);
  await lockEmployeeForSettlement(ctx, parent.employeeId);
  const expenseId = merged(row, previous, 'expenseId');
  if (typeof expenseId !== 'string' || !isUuid(expenseId)) return; // zod reports it
  const expense = await repo(ctx, WorkforceExpense).find(expenseId);
  const issues = expenseIssues(
    { employeeId: parent.employeeId, siteId: parent.siteId, kind: parent.kind as ExpenseSettlementKind },
    expense,
    'expenseId',
  );
  const amount = merged(row, previous, 'amount');
  const value = amount === undefined || amount === null ? null : zeroIfMissing(amount);
  if (value && (!value.gt(0) || !value.eq(value.roundDown(0))))
    issues.push({ path: 'amount', message: 'must be a positive whole-yen amount (tax included)' });
  if (issues.length > 0 || !expense)
    throw new ValidationError(
      `${L}: ${issues.map((i) => i.message).join('; ')}`,
      issues,
      'Use an approved expense of the same employee and site, paid with the method this settlement kind settles.',
    );
  const other = await liveSettlementOf(ctx, expenseId, parent.id);
  if (other)
    throw new Conflict(
      `expense ${expenseId} is already in settlement ${other}`,
      'Remove it from the other settlement or cancel that settlement first (one live settlement per expense).',
      { expenseId, settlementId: other },
    );
  Object.assign(row, {
    userId: parent.userId,
    expenseDate: expense.expenseDate,
    description: expense.description,
  });
  if (!previous && (row.accountId === undefined || row.accountId === null)) {
    const fallback = await defaultAccount(ctx);
    row.accountId = fallback.id;
    if (row.taxCategory === undefined || row.taxCategory === null) row.taxCategory = fallback.taxCategory;
  }
  if (!previous && (row.amount === undefined || row.amount === null)) row.amount = expense.amount;
  normalizeInvoiceFields(row, previous);
}

async function beforeDelete(ctx: Context, { row }: HookArgs): Promise<void> {
  requireSettlementRoles(ctx, ExpenseSettlement.name, 'update');
  const parent = await parentOf(ctx, row.settlementId);
  if (parent) refuseSelfSettlement(ctx, ExpenseSettlement.name, 'update', parent.userId);
}

async function touch(ctx: Context, settlementId: unknown): Promise<void> {
  if (typeof settlementId !== 'string') return;
  if (hasWriteCapability(ctx, L, 'update') || hasWriteCapability(ctx, L, 'create')) return;
  if (isSavingLines(ctx, ExpenseSettlement.name, settlementId)) return; // after_lines_saved recalculates once
  await recalculateSettlement(ctx, settlementId);
}

export function registerLineHooks(): void {
  registry.registerHook(L, 'before_validate', beforeValidate);
  registry.registerHook(L, 'before_delete', beforeDelete);
  registry.registerHook(L, 'after_create', (ctx, { row }) => touch(ctx, row.settlementId));
  registry.registerHook(L, 'after_update', (ctx, { row }) => touch(ctx, row.settlementId));
  registry.registerHook(L, 'after_delete', (ctx, { row }) => touch(ctx, row.settlementId));
}
