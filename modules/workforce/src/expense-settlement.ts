// Settlement of approved expenses by an accounting document of another module (docs/specs/expense-settlement.md AC-2,
// AC-11, D28). workforce does not know that document: the caller passes its number as `reference`, and reopening only
// touches expenses that carry that same reference. Both run in the caller's Context under the employee lock that the
// manual `workforce.settle_expense` also takes, so a manual settlement and a settlement document cannot both win.
// Authority is the same as the manual settlement: workforce_payroll (or admin), never the employee themself.
import { PermissionDenied, StateError, ValidationError, repo, type Context, type Infer } from '@daifuku/kernel';
import { employeeLock, requireOther, userId } from './common.ts';
import { WorkforceExpense } from './entities/index.ts';
import { internalWrite } from './internal.ts';
import { jstDate } from './services/time.ts';

type ExpenseRow = Infer<typeof WorkforceExpense>;

export interface SettleExpensesInput {
  employeeId: string;
  expenseIds: readonly string[];
  /** The settlement date written to `paidOn`. */
  paidOn: string;
  /** The settling document's number, written to `paymentReference`. */
  reference: string;
}

export interface ReopenExpensesInput {
  employeeId: string;
  expenseIds: readonly string[];
  /** Only expenses whose `paymentReference` equals this are reopened. */
  reference: string;
}

function requireSettler(ctx: Context): void {
  if (!ctx.roles.includes('admin') && !ctx.roles.includes('workforce_payroll'))
    throw new PermissionDenied(WorkforceExpense.name, 'settle:requires-workforce_payroll', ctx.roles);
}

/** Takes the employee lock for the rest of the transaction (the key `workforce.settle_expense` uses). */
export async function lockEmployeeForSettlement(ctx: Context, employeeId: string): Promise<void> {
  await employeeLock(ctx, employeeId, async () => undefined);
}

async function lockedExpenses(ctx: Context, employeeId: string, ids: readonly string[]): Promise<ExpenseRow[]> {
  const rows: ExpenseRow[] = [];
  for (const id of [...new Set(ids)].sort()) {
    const row = await repo(ctx, WorkforceExpense).lock(id);
    if (row.employeeId !== employeeId)
      throw new ValidationError('Expense belongs to another employee', [
        { path: 'expenseIds', message: `expense ${id} is not an expense of employee ${employeeId}` },
      ]);
    rows.push(row);
  }
  return rows;
}

/** approved → settled for every expense (AC-2). Fails as a whole when any expense is no longer approved. */
export async function settleExpensesForSource(ctx: Context, input: SettleExpensesInput): Promise<void> {
  requireSettler(ctx);
  await lockEmployeeForSettlement(ctx, input.employeeId);
  const rows = await lockedExpenses(ctx, input.employeeId, input.expenseIds);
  const today = jstDate(ctx.now());
  for (const row of rows) {
    requireOther(ctx, row);
    if (row.status !== 'approved')
      throw new StateError(
        `Expense ${row.id} is ${row.status}, not approved and unsettled`,
        'Reload the expenses: another settlement or a manual settlement may have completed first.',
        { expenseId: row.id, status: row.status },
      );
    if (input.paidOn < row.expenseDate || input.paidOn > today)
      throw new ValidationError('Settlement date must be between expense date and today', [
        { path: 'date', message: `expense ${row.id} is dated ${row.expenseDate}` },
      ]);
  }
  for (const row of rows)
    await internalWrite(ctx, WorkforceExpense, (write) =>
      repo(write, WorkforceExpense).update(
        row.id,
        { status: 'settled', paidOn: input.paidOn, paymentReference: input.reference, settledBy: userId(ctx) },
        { expectedVersion: row.version },
      ),
    );
}

/** settled → approved for the expenses settled by `reference` (cancellation of the settling document, AC-11). */
export async function reopenExpensesForSource(ctx: Context, input: ReopenExpensesInput): Promise<void> {
  requireSettler(ctx);
  await lockEmployeeForSettlement(ctx, input.employeeId);
  const rows = await lockedExpenses(ctx, input.employeeId, input.expenseIds);
  for (const row of rows) {
    if (row.status !== 'settled' || row.paymentReference !== input.reference) continue;
    await internalWrite(ctx, WorkforceExpense, (write) =>
      repo(write, WorkforceExpense).update(
        row.id,
        { status: 'approved', paidOn: null, paymentReference: null, settledBy: null },
        { expectedVersion: row.version },
      ),
    );
  }
}
