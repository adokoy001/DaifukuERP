import { getCompany, repo, StateError, ValidationError, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import {
  expenseCancelInput,
  expenseReviewInput,
  expenseSaveInput,
  expenseSettleInput,
  expenseSubmitInput,
} from '../contract.ts';
import { WorkforceExpense } from '../entities/index.ts';
import { E, H, M, P } from '../entities/common.ts';
import {
  activeEmployee,
  command,
  D,
  employeeLock,
  expectVersion,
  identity,
  replay,
  requireOther,
  requireSelf,
  reviewed,
  selfEmployee,
  userId,
} from '../common.ts';
import { internalWrite } from '../internal.ts';
import { jstDate } from '../services/time.ts';
import { workflowAction } from './define.ts';

async function save(ctx: Context, input: z.infer<typeof expenseSaveInput>) {
  const self = await selfEmployee(ctx);
  return employeeLock(ctx, self.id, async () => {
    const employee = await activeEmployee(ctx, self.id, input.expenseDate);
    requireSelf(ctx, employee);
    if (
      (await getCompany(ctx)).currency !== 'JPY' ||
      input.expenseDate > jstDate(ctx.now()) ||
      D(input.amount).lte(0) ||
      !D(input.amount).eq(D(input.amount).roundDown(0))
    )
      throw new ValidationError('Expense needs a past date and a positive integer JPY amount', [
        { path: 'amount', message: 'Use actual JPY expenditure.' },
      ]);
    const patch = {
      expenseDate: input.expenseDate,
      category: input.category,
      description: input.description,
      amount: input.amount,
      evidence: input.evidence,
    };
    if (!input.expenseId) {
      const prior = await replay(ctx, WorkforceExpense, input.idempotencyKey, input);
      if (prior) return command(prior);
      expectVersion(0, input.expectedVersion);
      return command(
        await internalWrite(ctx, WorkforceExpense, (write) =>
          repo(write, WorkforceExpense).create({
            ...identity(employee),
            ...patch,
            idempotencyKey: input.idempotencyKey,
            requestSnapshot: input,
          }),
        ),
      );
    }
    const row = await repo(ctx, WorkforceExpense).lock(input.expenseId);
    requireSelf(ctx, row);
    expectVersion(row.version, input.expectedVersion);
    if (!['draft', 'returned'].includes(row.status))
      throw new StateError(
        'Submitted expenses are frozen',
        'Ask the reviewer to return the expense before correcting it.',
      );
    return command(
      await internalWrite(ctx, WorkforceExpense, (write) =>
        repo(write, WorkforceExpense).update(row.id, patch, { expectedVersion: row.version }),
      ),
    );
  });
}
async function submit(ctx: Context, input: z.infer<typeof expenseSubmitInput>) {
  const initial = await repo(ctx, WorkforceExpense).get(input.expenseId);
  return employeeLock(ctx, initial.employeeId, async () => {
    const row = await repo(ctx, WorkforceExpense).lock(initial.id);
    requireSelf(ctx, row);
    expectVersion(row.version, input.expectedVersion);
    await activeEmployee(ctx, row.employeeId, row.expenseDate);
    if (!['draft', 'returned'].includes(row.status))
      throw new StateError('Expense cannot be submitted in this state', 'Reload its current state.');
    return command(
      await internalWrite(ctx, WorkforceExpense, (write) =>
        repo(write, WorkforceExpense).update(
          row.id,
          { status: 'submitted', reviewReason: null },
          { expectedVersion: row.version },
        ),
      ),
    );
  });
}
async function review(ctx: Context, input: z.infer<typeof expenseReviewInput>) {
  const initial = await repo(ctx, WorkforceExpense).get(input.expenseId);
  return employeeLock(ctx, initial.employeeId, async () => {
    const row = await repo(ctx, WorkforceExpense).lock(initial.id);
    requireOther(ctx, row);
    expectVersion(row.version, input.expectedVersion);
    if (row.status !== 'submitted')
      throw new StateError('Only submitted expenses can be reviewed', 'Ask the employee to submit the expense.');
    return command(
      await internalWrite(ctx, WorkforceExpense, (write) =>
        repo(write, WorkforceExpense).update(
          row.id,
          { status: input.decision === 'approve' ? 'approved' : 'returned', ...reviewed(ctx, input.reason) },
          { expectedVersion: row.version },
        ),
      ),
    );
  });
}
async function settle(ctx: Context, input: z.infer<typeof expenseSettleInput>) {
  const initial = await repo(ctx, WorkforceExpense).get(input.expenseId);
  return employeeLock(ctx, initial.employeeId, async () => {
    const row = await repo(ctx, WorkforceExpense).lock(initial.id);
    requireOther(ctx, row);
    expectVersion(row.version, input.expectedVersion);
    if (row.status !== 'approved')
      throw new StateError('Expense must be approved and unsettled', 'Complete the other-person approval first.');
    if (input.paidOn < row.expenseDate || input.paidOn > jstDate(ctx.now()))
      throw new ValidationError('Settlement date must be between expense date and today', [
        { path: 'paidOn', message: 'Use the actual completed settlement date.' },
      ]);
    return command(
      await internalWrite(ctx, WorkforceExpense, (write) =>
        repo(write, WorkforceExpense).update(
          row.id,
          { status: 'settled', paidOn: input.paidOn, paymentReference: input.reference, settledBy: userId(ctx) },
          { expectedVersion: row.version },
        ),
      ),
    );
  });
}
async function cancel(ctx: Context, input: z.infer<typeof expenseCancelInput>) {
  const initial = await repo(ctx, WorkforceExpense).get(input.expenseId);
  return employeeLock(ctx, initial.employeeId, async () => {
    const row = await repo(ctx, WorkforceExpense).lock(initial.id);
    requireSelf(ctx, row);
    expectVersion(row.version, input.expectedVersion);
    if (!['draft', 'returned', 'submitted'].includes(row.status))
      throw new StateError(
        'Approved or settled expenses cannot be withdrawn by the applicant',
        'Ask headquarters to review the settlement separately.',
      );
    return command(
      await internalWrite(ctx, WorkforceExpense, (write) =>
        repo(write, WorkforceExpense).update(
          row.id,
          { status: 'cancelled', reviewReason: input.reason },
          { expectedVersion: row.version },
        ),
      ),
    );
  });
}
export const saveExpenseAction = workflowAction(
  'save_expense',
  '本人経費の下書きを保存',
  expenseSaveInput,
  [E, M, H, P],
  save,
);
export const submitExpenseAction = workflowAction(
  'submit_expense',
  '本人経費を提出',
  expenseSubmitInput,
  [E, M, H, P],
  submit,
);
export const reviewExpenseAction = workflowAction(
  'review_expense',
  '経費を拠点承認・差戻し',
  expenseReviewInput,
  [M, H],
  review,
);
export const settleExpenseAction = workflowAction(
  'settle_expense',
  '承認済経費の本部精算を記録',
  expenseSettleInput,
  [P],
  settle,
  false,
);
export const cancelExpenseAction = workflowAction(
  'cancel_expense',
  '本人経費を理由付きで取り下げ',
  expenseCancelInput,
  [E, M, H, P],
  cancel,
);
