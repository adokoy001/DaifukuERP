// expense_settlement header hooks (spec AC-3..AC-12, ADR-0039).
// before_validate (draft create/update): role and self-settlement checks first (AC-15; the self check covers create,
//   update and, in before_delete, delete of the draft), then on create the employee's user and site (server-owned),
//   today's date (JST) and zeroed computed fields. Internal updates (recalc, paymentId) carry the module capability
//   and skip these checks.
// before_create / before_update (draft): advance-derived amounts from the stored total (AC-7).
// after_lines_saved: one recalculation per replace-all line save (hooks/recalc.ts).
// before_submit: under the employee lock, every AC-6 check — including AC-4 on every line and the advance — then the
//   final tax computation, the computed line fields, and the expense entry through accounting `postFromSource`.
// after_submit: entry description with the number, expenses settled (workforce), advance settled, clearing payment.
// before_cancel / after_cancel: reverse the entry, reopen the expenses and the advance, then cancel the payment with the
//   same correction date (it can only be cancelled once this document is no longer submitted: kernel findDependents).
import {
  cancelDocument,
  Conflict,
  Decimal,
  DOCSTATUS,
  hasWriteCapability,
  registry,
  repo,
  todayLocal,
  ValidationError,
  type Context,
  type HookArgs,
  type LocalDate,
} from '@daifuku/kernel';
import {
  assertJpySettlement,
  JournalEntry,
  postFromSource,
  postingDimensions,
  reverseSourceEntry,
} from '@daifuku/mod-accounting';
import { createClearingPayment, defaultAccountIdFor, Payment, type PaymentMethod } from '@daifuku/mod-payment';
import {
  lockEmployeeForSettlement,
  reopenExpensesForSource,
  settleExpensesForSource,
  WorkforceEmployee,
  WorkforceExpense,
} from '@daifuku/mod-workforce';
import { refuseSelfSettlement, requireSettlementRoles } from '../access.ts';
import type { ExpenseSettlementKind } from '../contract.ts';
import { ExpenseAdvance, ExpenseSettlement, ExpenseSettlementLine } from '../entities/index.ts';
import { internalWrite } from '../internal.ts';
import {
  computeFor,
  expenseIssues,
  lineTaxPatch,
  liveSettlementOf,
  loadLines,
  zeroIfMissing,
  type ExpenseRow,
  type ValidationIssue,
} from '../services/load.ts';
import { invoiceIssues } from '../services/invoice.ts';
import { clearingPlan, settlementAmounts, settlementJournalLines } from '../services/posting.ts';
import { taxSummaryJson } from '../services/tax.ts';
import { resolveExpenseAccounts } from '../settings.ts';
import { recalculateSettlement } from './recalc.ts';

type Raw = Record<string, unknown>;
const S = ExpenseSettlement.name;

export const SUBMIT_HINT = 'Fix the listed fields of the settlement and its lines (details.issues), then submit again.';

export function entryDescription(employeeName: string, number: string | null): string {
  return number ? `経費精算 ${number} ${employeeName}` : `経費精算 ${employeeName}`;
}

async function advanceAmountOf(ctx: Context, kind: unknown, advanceId: unknown): Promise<Decimal> {
  if (kind !== 'advance' || typeof advanceId !== 'string') return Decimal.zero();
  const advance = await repo(ctx, ExpenseAdvance).find(advanceId);
  return advance ? advance.amount : Decimal.zero();
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (previous && previous.docstatus !== DOCSTATUS.draft) return; // allowOnSubmit fields only
  if (previous && hasWriteCapability(ctx, S, 'update')) return; // module-internal recalculation
  requireSettlementRoles(ctx, S, previous ? 'update' : 'create');
  if (previous) {
    refuseSelfSettlement(ctx, S, 'update', previous.userId); // nobody edits the draft of their own settlement
    return;
  }
  if (typeof row.employeeId !== 'string') return; // zod reports it
  const employee = await repo(ctx, WorkforceEmployee).get(row.employeeId);
  refuseSelfSettlement(ctx, S, 'create', employee.userId);
  row.userId = employee.userId;
  if (typeof row.siteId !== 'string') row.siteId = employee.siteId; // the draft action passes the expenses' site
  if (row.date === undefined || row.date === null) row.date = todayLocal(ctx.now());
  Object.assign(row, {
    subtotal: '0',
    taxTotal: '0',
    deductibleTax: '0',
    nonDeductibleTax: '0',
    total: '0',
    taxSummary: null,
    journalEntryId: null,
    paymentId: null,
  });
}

/** AC-7: advance / pay-out / refund amounts follow the stored total and the chosen advance while the draft changes. */
async function deriveAdvanceAmounts(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.docstatus !== undefined && row.docstatus !== DOCSTATUS.draft) return;
  const kind = row.kind as ExpenseSettlementKind;
  const advance = await advanceAmountOf(ctx, kind, row.advanceId);
  const a = settlementAmounts(kind, zeroIfMissing(row.total), advance);
  Object.assign(row, { advanceAmount: advance, payAmount: a.payAmount, refundAmount: a.refundAmount });
}

async function afterLinesSaved(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.docstatus !== DOCSTATUS.draft) return;
  await recalculateSettlement(ctx, row.id as string);
}

interface SubmitState {
  employeeName: string;
  issues: ValidationIssue[];
  expenses: Map<string, ExpenseRow>;
}

/** AC-6: every check that does not depend on the computation; ValidationError lists them all, Conflict for overlaps. */
async function checkForSubmit(ctx: Context, row: Raw, lines: Raw[]): Promise<SubmitState> {
  const issues: ValidationIssue[] = [];
  const kind = row.kind as ExpenseSettlementKind;
  const date = row.date as LocalDate;
  const employee = await repo(ctx, WorkforceEmployee).get(row.employeeId as string);
  if (typeof row.partnerId !== 'string') issues.push({ path: 'partnerId', message: 'required' });
  if (date > todayLocal(ctx.now())) issues.push({ path: 'date', message: 'must be today (JST) or earlier' });
  if (kind !== 'advance' && lines.length === 0)
    issues.push({ path: 'lines', message: 'at least one line is required' });
  if (kind !== 'advance' && typeof row.advanceId === 'string')
    issues.push({ path: 'advanceId', message: 'only an advance settlement clears an advance' });
  const head = { employeeId: row.employeeId as string, siteId: row.siteId as string, kind };
  const expenses = new Map<string, ExpenseRow>();
  const byExpense = new Map<string, Raw[]>();
  lines.forEach((line, i) => {
    const list = byExpense.get(line.expenseId as string) ?? [];
    list.push({ ...line, index: i });
    byExpense.set(line.expenseId as string, list);
  });
  for (const [expenseId, own] of byExpense) {
    const path = `lines[${String(own[0]?.index)}].expenseId`;
    const expense = await repo(ctx, WorkforceExpense).find(expenseId);
    issues.push(...expenseIssues(head, expense, path));
    if (!expense) continue;
    expenses.set(expenseId, expense);
    if (date < expense.expenseDate)
      issues.push({ path: 'date', message: `must be on or after the expense date ${expense.expenseDate}` });
    const sum = Decimal.sum(own.map((l) => zeroIfMissing(l.amount)));
    if (!sum.eq(expense.amount))
      issues.push({
        path,
        message: `lines of this expense total ${sum.toString()}, the expense is ${expense.amount.toString()}`,
      });
    const first = own[0] ?? {};
    if (own.some((l) => l.invoiceKind !== first.invoiceKind || l.invoiceRegistrationNo !== first.invoiceRegistrationNo))
      issues.push({ path, message: 'lines of one receipt need the same invoice kind and registration number' });
    for (const l of own) issues.push(...invoiceIssues(l, `lines[${String(l.index)}]`));
    const other = await liveSettlementOf(ctx, expenseId, row.id as string);
    if (other)
      throw new Conflict(
        `expense ${expenseId} is already in settlement ${other}`,
        'Remove the expense from one of the settlements, or cancel the other settlement first.',
        { expenseId, settlementId: other },
      );
  }
  return { employeeName: employee.name, issues, expenses };
}

async function checkAdvance(ctx: Context, row: Raw, issues: ValidationIssue[]): Promise<Decimal> {
  if (row.kind !== 'advance') return Decimal.zero();
  if (typeof row.advanceId !== 'string') {
    issues.push({ path: 'advanceId', message: 'an advance settlement needs the advance it clears' });
    return Decimal.zero();
  }
  const advance = await repo(ctx, ExpenseAdvance).lock(row.advanceId); // serializes two settlements of one advance
  if (advance.employeeId !== row.employeeId)
    issues.push({ path: 'advanceId', message: 'the advance was paid to another employee' });
  if (advance.docstatus !== DOCSTATUS.submitted || advance.status !== 'open')
    issues.push({ path: 'advanceId', message: 'the advance must be submitted and open (not yet settled)' });
  if (advance.date > String(row.date))
    issues.push({ path: 'advanceId', message: `the advance is dated ${advance.date}, after the settlement date` });
  if (advance.partnerId !== row.partnerId)
    issues.push({ path: 'partnerId', message: "must be the advance's partner so 仮払金 nets to zero per partner" });
  return advance.amount;
}

async function paymentAccount(ctx: Context, row: Raw, issues: ValidationIssue[]): Promise<void> {
  if (typeof row.paymentAccountId === 'string') return;
  const found = await defaultAccountIdFor(ctx, row.method as PaymentMethod);
  if (found.id) row.paymentAccountId = found.id;
  else
    issues.push({ path: 'paymentAccountId', message: `required: default account code ${found.code} does not exist` });
}

async function beforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  requireSettlementRoles(ctx, S, 'submit');
  refuseSelfSettlement(ctx, S, 'submit', row.userId);
  await lockEmployeeForSettlement(ctx, row.employeeId as string);
  const id = row.id as string;
  const date = row.date as LocalDate;
  const kind = row.kind as ExpenseSettlementKind;
  const lines = await loadLines(ctx, id);
  const state = await checkForSubmit(ctx, row, lines as unknown as Raw[]);
  const advance = await checkAdvance(ctx, row, state.issues);
  const { settings, tax } = await computeFor(ctx, lines, date);
  if (clearingPlan(kind, tax.totals.total, advance)) await paymentAccount(ctx, row, state.issues);
  if (state.issues.length > 0) throw new ValidationError(`${S} ${id} cannot be submitted`, state.issues, SUBMIT_HINT);
  await assertJpySettlement(ctx, tax.totals.total, 'total');
  const accounts = await resolveExpenseAccounts(ctx);
  for (const [i, line] of lines.entries()) {
    const computed = tax.lines[i];
    const patch = computed ? lineTaxPatch(line, computed) : {};
    if (Object.keys(patch).length > 0)
      await internalWrite(ctx, ExpenseSettlementLine, (write) =>
        repo(write, ExpenseSettlementLine).update(line.id, patch),
      );
  }
  const amounts = settlementAmounts(kind, tax.totals.total, advance);
  const journal = settlementJournalLines({
    kind,
    partnerId: row.partnerId as string,
    total: tax.totals.total,
    advanceAmount: advance,
    lines: lines.map((line, i) => ({
      accountId: line.accountId,
      taxCategory: line.taxCategory,
      taxRate: tax.lines[i]?.taxRate ?? Decimal.zero(),
      taxableAmount: tax.lines[i]?.taxableAmount ?? Decimal.zero(),
      nonDeductibleTax: tax.lines[i]?.nonDeductibleTax ?? Decimal.zero(),
    })),
    groups: tax.groups,
    accounts,
  });
  const ext = row.ext as Record<string, unknown> | undefined;
  const entry =
    journal.length > 0
      ? await postFromSource(ctx, {
          sourceEntity: S,
          sourceId: id,
          date,
          description: entryDescription(state.employeeName, null),
          ext,
          lines: journal.map((l) => ({ ...l, ext: postingDimensions(S, 'journal_line', ext) })),
        })
      : null;
  Object.assign(row, {
    subtotal: tax.totals.subtotal,
    taxTotal: tax.totals.taxTotal,
    deductibleTax: tax.totals.deductibleTax,
    nonDeductibleTax: tax.totals.nonDeductibleTax,
    total: tax.totals.total,
    advanceAmount: advance,
    payAmount: amounts.payAmount,
    refundAmount: amounts.refundAmount,
    taxSummary: taxSummaryJson(tax, settings.rounding),
    journalEntryId: entry?.id ?? null,
  });
}

async function afterSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const id = row.id as string;
  const number = row.number as string;
  const employeeId = row.employeeId as string;
  const kind = row.kind as ExpenseSettlementKind;
  const employee = await repo(ctx, WorkforceEmployee).get(employeeId);
  if (typeof row.journalEntryId === 'string')
    await repo(ctx, JournalEntry).update(row.journalEntryId, { description: entryDescription(employee.name, number) });
  const expenseIds = [...new Set((await loadLines(ctx, id)).map((l) => l.expenseId))];
  if (expenseIds.length > 0)
    await settleExpensesForSource(ctx, { employeeId, expenseIds, paidOn: row.date as string, reference: number });
  if (kind === 'advance' && typeof row.advanceId === 'string') {
    const advanceId = row.advanceId;
    await internalWrite(ctx, ExpenseAdvance, (write) =>
      repo(write, ExpenseAdvance).update(advanceId, { status: 'settled' }),
    );
  }
  const plan = clearingPlan(kind, zeroIfMissing(row.total), zeroIfMissing(row.advanceAmount));
  if (!plan) return;
  const accounts = await resolveExpenseAccounts(ctx);
  // C5 hook: expense.render_expense_settlement_html prints this settlement once the shared print layout is merged.
  const payment = await createClearingPayment(ctx, {
    direction: plan.direction,
    partnerId: row.partnerId as string,
    date: row.date as LocalDate,
    amount: plan.amount,
    method: row.method as PaymentMethod,
    accountId: row.paymentAccountId as string,
    counterAccountId: plan.counter === 'payable' ? accounts.payable : accounts.advance,
    note: entryDescription(employee.name, number),
  });
  await internalWrite(ctx, ExpenseSettlement, (write) =>
    repo(write, ExpenseSettlement).update(id, { paymentId: payment.id }),
  );
}

async function beforeCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  requireSettlementRoles(ctx, S, 'cancel');
  refuseSelfSettlement(ctx, S, 'cancel', row.userId);
  const employeeId = row.employeeId as string;
  await lockEmployeeForSettlement(ctx, employeeId);
  const date = correctionDate ?? (row.date as LocalDate);
  if (date < String(row.date))
    throw new ValidationError('Cancellation cannot precede the settlement', [
      { path: 'correctionDate', message: 'must be on or after the settlement date' },
    ]);
  if (typeof row.journalEntryId === 'string')
    await reverseSourceEntry(ctx, { id: row.journalEntryId, sourceEntity: S, sourceId: row.id as string, date });
  const expenseIds = [...new Set((await loadLines(ctx, row.id as string)).map((l) => l.expenseId))];
  if (expenseIds.length > 0)
    await reopenExpensesForSource(ctx, { employeeId, expenseIds, reference: row.number as string });
  if (row.kind === 'advance' && typeof row.advanceId === 'string') {
    const advanceId = row.advanceId;
    const advance = await repo(ctx, ExpenseAdvance).lock(advanceId);
    if (advance.status === 'settled')
      await internalWrite(ctx, ExpenseAdvance, (write) =>
        repo(write, ExpenseAdvance).update(advanceId, { status: 'open' }),
      );
  }
}

async function afterCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  if (typeof row.paymentId !== 'string') return;
  await cancelDocument(ctx, Payment, row.paymentId, { correctionDate });
}

export function registerSettlementHooks(): void {
  registry.registerHook(S, 'before_validate', beforeValidate);
  registry.registerHook(S, 'before_create', deriveAdvanceAmounts);
  registry.registerHook(S, 'before_update', deriveAdvanceAmounts);
  registry.registerHook(S, 'before_delete', (ctx, { row }) => {
    requireSettlementRoles(ctx, S, 'delete');
    refuseSelfSettlement(ctx, S, 'delete', row.userId);
  });
  registry.registerHook(S, 'after_lines_saved', afterLinesSaved);
  registry.registerHook(S, 'before_submit', beforeSubmit);
  registry.registerHook(S, 'after_submit', afterSubmit);
  registry.registerHook(S, 'before_cancel', beforeCancel);
  registry.registerHook(S, 'after_cancel', afterCancel);
}
