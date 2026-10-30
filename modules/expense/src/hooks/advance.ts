// expense_advance hooks (spec AC-13, AC-12, ADR-0039).
// before_validate (draft): roles and self check (AC-15), the employee's user and site, today's date (JST); a positive
//   whole-yen amount. before_submit: date not in the future, JPY, the cash/bank account default, status `open`.
// after_submit: the payout through payment `createClearingPayment` (Dr 仮払金 / Cr cash/bank), its id recorded.
// before_cancel: refused while `settled` (cancel the settlement first); after_cancel: the payout is cancelled with the
//   same correction date. A submitted settlement that clears the advance blocks its cancellation (kernel DependencyError).
import {
  DOCSTATUS,
  hasWriteCapability,
  registry,
  repo,
  StateError,
  todayLocal,
  ValidationError,
  cancelDocument,
  type Context,
  type HookArgs,
  type LocalDate,
} from '@daifuku/kernel';
import { assertJpySettlement } from '@daifuku/mod-accounting';
import { createClearingPayment, defaultAccountIdFor, Payment, type PaymentMethod } from '@daifuku/mod-payment';
import { WorkforceEmployee } from '@daifuku/mod-workforce';
import { refuseSelfSettlement, requireSettlementRoles } from '../access.ts';
import { ExpenseAdvance } from '../entities/index.ts';
import { internalWrite } from '../internal.ts';
import { zeroIfMissing } from '../services/load.ts';
import { resolveExpenseAccounts } from '../settings.ts';

const A = ExpenseAdvance.name;

export function advanceNote(employeeName: string, number: string): string {
  return `仮払 ${number} ${employeeName}`;
}

function assertAmount(value: unknown): void {
  if (value === undefined || value === null) return;
  const amount = zeroIfMissing(value);
  if (!amount.gt(0) || !amount.eq(amount.roundDown(0)))
    throw new ValidationError('Advance amount must be a positive whole-yen amount', [
      { path: 'amount', message: 'must be > 0, whole yen' },
    ]);
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (previous && previous.docstatus !== DOCSTATUS.draft) return; // allowOnSubmit fields only
  if (previous && hasWriteCapability(ctx, A, 'update')) return;
  requireSettlementRoles(ctx, A, previous ? 'update' : 'create');
  assertAmount(row.amount);
  if (previous) return;
  if (typeof row.employeeId !== 'string') return; // zod reports it
  const employee = await repo(ctx, WorkforceEmployee).get(row.employeeId);
  refuseSelfSettlement(ctx, A, 'create', employee.userId);
  Object.assign(row, { userId: employee.userId, siteId: employee.siteId, status: null, paymentId: null });
  if (row.date === undefined || row.date === null) row.date = todayLocal(ctx.now());
}

async function beforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  requireSettlementRoles(ctx, A, 'submit');
  refuseSelfSettlement(ctx, A, 'submit', row.userId);
  assertAmount(row.amount);
  const issues: { path: string; message: string }[] = [];
  if (String(row.date) > todayLocal(ctx.now()))
    issues.push({ path: 'date', message: 'must be today (JST) or earlier' });
  if (typeof row.paymentAccountId !== 'string') {
    const found = await defaultAccountIdFor(ctx, row.method as PaymentMethod);
    if (found.id) row.paymentAccountId = found.id;
    else
      issues.push({ path: 'paymentAccountId', message: `required: default account code ${found.code} does not exist` });
  }
  if (issues.length > 0) throw new ValidationError(`${A} ${String(row.id)} cannot be submitted`, issues);
  await assertJpySettlement(ctx, zeroIfMissing(row.amount), 'amount');
  await resolveExpenseAccounts(ctx);
  row.status = 'open';
}

async function afterSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const employee = await repo(ctx, WorkforceEmployee).get(row.employeeId as string);
  const accounts = await resolveExpenseAccounts(ctx);
  const payment = await createClearingPayment(ctx, {
    direction: 'pay',
    partnerId: row.partnerId as string,
    date: row.date as LocalDate,
    amount: zeroIfMissing(row.amount),
    method: row.method as PaymentMethod,
    accountId: row.paymentAccountId as string,
    counterAccountId: accounts.advance,
    note: advanceNote(employee.name, row.number as string),
  });
  await internalWrite(ctx, ExpenseAdvance, (write) =>
    repo(write, ExpenseAdvance).update(row.id as string, { paymentId: payment.id }),
  );
}

async function beforeCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  requireSettlementRoles(ctx, A, 'cancel');
  refuseSelfSettlement(ctx, A, 'cancel', row.userId);
  if (row.status === 'settled')
    throw new StateError(
      `${A} ${String(row.number)} is settled`,
      'Cancel the expense settlement that cleared it first; that reopens the advance.',
    );
  if (correctionDate && correctionDate < String(row.date))
    throw new ValidationError('Cancellation cannot precede the advance', [
      { path: 'correctionDate', message: 'must be on or after the payment date' },
    ]);
  row.status = 'cancelled';
}

async function afterCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  if (typeof row.paymentId !== 'string') return;
  await cancelDocument(ctx, Payment, row.paymentId, { correctionDate });
}

export function registerAdvanceHooks(): void {
  registry.registerHook(A, 'before_validate', beforeValidate);
  registry.registerHook(A, 'before_delete', (ctx) => requireSettlementRoles(ctx, A, 'delete'));
  registry.registerHook(A, 'before_submit', beforeSubmit);
  registry.registerHook(A, 'after_submit', afterSubmit);
  registry.registerHook(A, 'before_cancel', beforeCancel);
  registry.registerHook(A, 'after_cancel', afterCancel);
}
