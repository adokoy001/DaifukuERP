// expense.draft_settlement (spec AC-3, D28): one draft settlement from approved expenses of one employee, kind and site.
// The roles are checked before anything is read (AC-15); the employee lock serializes it with other drafts, line saves
// and settlements of the same employee, so the second of two concurrent calls sees the first's lines (CONFLICT).
import {
  defineAction,
  DOCSTATUS,
  label,
  repo,
  saveLines,
  todayLocal,
  ValidationError,
  type Context,
} from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { lockEmployeeForSettlement, WorkforceEmployee, WorkforceExpense } from '@daifuku/mod-workforce';
import { refuseSelfSettlement, requireSettlementRoles } from '../access.ts';
import {
  draftSettlementInput,
  draftSettlementOutput,
  KIND_PAYMENT_METHOD,
  MAX_DRAFT_EXPENSES,
  type DraftSettlementInput,
} from '../contract.ts';
import { ExpenseAdvance, ExpenseSettlement, ExpenseSettlementLine } from '../entities/index.ts';
import { internalWrite } from '../internal.ts';
import { heldBy, type ExpenseRow } from '../services/load.ts';
import { loadExpenseAccountCodes } from '../settings.ts';

const MAX_EXPENSES = MAX_DRAFT_EXPENSES;

async function candidates(ctx: Context, input: DraftSettlementInput): Promise<ExpenseRow[]> {
  if (input.expenseIds) {
    const rows: ExpenseRow[] = [];
    for (const [i, id] of input.expenseIds.entries()) {
      const row = await repo(ctx, WorkforceExpense).find(id);
      if (!row)
        throw new ValidationError('expense does not exist or is not visible to you', [
          { path: `expenseIds[${i}]`, message: 'expense not found' },
        ]);
      rows.push(row);
    }
    return rows;
  }
  // Oldest first, paged until MAX_EXPENSES free ones are found: the first page may be held entirely by other drafts.
  const free: ExpenseRow[] = [];
  for (let offset = 0; free.length < MAX_EXPENSES; offset += 500) {
    const page = await repo(ctx, WorkforceExpense).list({
      where: { employeeId: input.employeeId, status: 'approved', paymentMethod: KIND_PAYMENT_METHOD[input.kind] },
      orderBy: [
        { field: 'expenseDate', dir: 'asc' },
        { field: 'createdAt', dir: 'asc' },
      ],
      limit: 500,
      offset,
    });
    const held = await heldBy(
      ctx,
      page.items.map((row) => row.id),
    );
    for (const row of page.items) if (free.length < MAX_EXPENSES && !held.has(row.id)) free.push(row);
    if (!page.items.length || offset + page.items.length >= page.total) break;
  }
  return free;
}

async function defaultPartner(ctx: Context, input: DraftSettlementInput, advancePartner: string | null) {
  if (input.partnerId) return input.partnerId;
  if (input.kind === 'advance' && advancePartner) return advancePartner;
  const latest = await repo(ctx, ExpenseSettlement).list({
    where: { employeeId: input.employeeId, kind: input.kind, docstatus: DOCSTATUS.submitted },
    orderBy: [
      { field: 'date', dir: 'desc' },
      { field: 'createdAt', dir: 'desc' },
    ],
    limit: 1,
  });
  return latest.items[0]?.partnerId ?? null;
}

async function draft(ctx: Context, input: DraftSettlementInput) {
  requireSettlementRoles(ctx, ExpenseSettlement.name, 'create');
  const employee = await repo(ctx, WorkforceEmployee).get(input.employeeId);
  refuseSelfSettlement(ctx, ExpenseSettlement.name, 'create', employee.userId);
  await lockEmployeeForSettlement(ctx, employee.id);
  const advance = input.advanceId ? await repo(ctx, ExpenseAdvance).get(input.advanceId) : null;
  if (advance && input.kind !== 'advance')
    throw new ValidationError('Only an advance settlement clears an advance', [
      { path: 'advanceId', message: 'omit advanceId or use kind advance' },
    ]);
  const expenses = await candidates(ctx, input);
  if (expenses.length === 0 && !(input.kind === 'advance' && advance))
    throw new ValidationError('No approved expense is waiting for this settlement', [
      {
        path: 'expenseIds',
        message: `employee ${employee.code} has no approved ${KIND_PAYMENT_METHOD[input.kind]} expense outside another settlement`,
      },
    ]);
  const sites = new Set(expenses.map((e) => e.siteId));
  if (sites.size > 1)
    throw new ValidationError('Expenses of several sites need one settlement per site', [
      { path: 'expenseIds', message: 'choose expenses of one site' },
    ]);
  const code = (await loadExpenseAccountCodes(ctx)).defaultExpense;
  const account = (await repo(ctx, Account).list({ where: { code }, limit: 1 })).items[0];
  if (!account && expenses.length > 0)
    throw new ValidationError(`no account has code ${code} (expense.accounts.defaultExpense)`, [
      { path: 'accountId', message: `default account code ${code} does not exist` },
    ]);
  const partnerId = await defaultPartner(ctx, input, advance?.partnerId ?? null);
  const created = await internalWrite(ctx, ExpenseSettlement, (write) =>
    repo(write, ExpenseSettlement).create({
      employeeId: employee.id,
      userId: employee.userId,
      kind: input.kind,
      date: input.date ?? todayLocal(ctx.now()),
      partnerId,
      advanceId: advance?.id ?? null,
      siteId: expenses[0]?.siteId ?? employee.siteId,
    }),
  );
  if (expenses.length > 0)
    await saveLines(ctx, ExpenseSettlement, created.id, {
      [ExpenseSettlementLine.name]: expenses.map((e) => ({
        expenseId: e.id,
        amount: e.amount.toString(),
        accountId: account?.id,
        taxCategory: account?.taxCategoryDefault ?? 'standard',
      })),
    });
  const after = await repo(ctx, ExpenseSettlement).get(created.id);
  return { id: after.id, version: after.version };
}

export const draftSettlementAction = defineAction({
  name: 'expense.draft_settlement',
  description: label(
    '承認済みの経費から経費精算書の下書きを作成（従業員・種類・拠点ごとに 1 枚）',
    'Create a draft expense settlement from approved expenses (one per employee, kind and site)',
  ),
  input: draftSettlementInput,
  output: draftSettlementOutput,
  permission: { entity: ExpenseSettlement.name, op: 'create' },
  siteAccess: false,
  handler: draft,
});
