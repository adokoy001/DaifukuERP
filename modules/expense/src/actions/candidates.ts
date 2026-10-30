// expense.settlement_candidates (spec AC-20): approved expenses waiting for a settlement, grouped by employee x payment
// method x site, plus the open advances. Read-only, in the caller's Context (roles checked before any read, AC-15).
import {
  Decimal,
  defineAction,
  DOCSTATUS,
  label,
  repo,
  type Context,
  type EntityDef,
  type Infer,
} from '@daifuku/kernel';
import { WorkforceEmployee, WorkforceExpense, WorkforceSite } from '@daifuku/mod-workforce';
import { requireSettlementRoles } from '../access.ts';
import {
  PAYMENT_METHOD_KIND,
  settlementCandidatesInput,
  settlementCandidatesOutput,
  type CandidateGroup,
  type ExpensePaymentMethodValue,
  type SettlementCandidates,
} from '../contract.ts';
import { ExpenseAdvance, ExpenseSettlement, ExpenseSettlementLine } from '../entities/index.ts';

const MAX_EXPENSES = 2000;

async function byIds<E extends EntityDef>(ctx: Context, entity: E, ids: readonly string[]): Promise<Infer<E>[]> {
  const out: Infer<E>[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    out.push(...(await repo(ctx, entity).list({ where: { id: { $in: chunk } }, limit: 500 })).items);
  }
  return out;
}

async function approvedExpenses(ctx: Context) {
  const items: Infer<typeof WorkforceExpense>[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await repo(ctx, WorkforceExpense).list({
      where: { status: 'approved' },
      orderBy: [{ field: 'expenseDate', dir: 'asc' }],
      limit: 500,
      offset,
    });
    items.push(...page.items);
    if (items.length >= MAX_EXPENSES)
      return { items: items.slice(0, MAX_EXPENSES), truncated: page.total > MAX_EXPENSES };
    if (!page.items.length || offset + page.items.length >= page.total) return { items, truncated: false };
  }
}

/** expense id -> docstatus of the draft/submitted settlement that holds it. */
async function heldBy(ctx: Context, expenseIds: readonly string[]): Promise<Map<string, number>> {
  const lines: Infer<typeof ExpenseSettlementLine>[] = [];
  for (let i = 0; i < expenseIds.length; i += 500)
    lines.push(
      ...(
        await repo(ctx, ExpenseSettlementLine).list({
          where: { expenseId: { $in: expenseIds.slice(i, i + 500) } },
          limit: 500,
        })
      ).items,
    );
  const settlements = await byIds(
    ctx,
    ExpenseSettlement,
    lines.map((l) => l.settlementId),
  );
  const live = new Map(
    settlements.filter((s) => s.docstatus !== DOCSTATUS.cancelled).map((s) => [s.id, s.docstatus] as const),
  );
  const out = new Map<string, number>();
  for (const line of lines) {
    const status = live.get(line.settlementId);
    if (status !== undefined) out.set(line.expenseId, status);
  }
  return out;
}

async function candidates(ctx: Context): Promise<SettlementCandidates> {
  requireSettlementRoles(ctx, ExpenseSettlement.name, 'candidates');
  const { items: expenses, truncated } = await approvedExpenses(ctx);
  const held = await heldBy(
    ctx,
    expenses.map((e) => e.id),
  );
  const advances = (
    await repo(ctx, ExpenseAdvance).list({
      where: { docstatus: DOCSTATUS.submitted, status: 'open' },
      orderBy: [{ field: 'date', dir: 'asc' }],
      limit: 500,
    })
  ).items;
  const employees = new Map(
    (
      await byIds(ctx, WorkforceEmployee, [...expenses.map((e) => e.employeeId), ...advances.map((a) => a.employeeId)])
    ).map((e) => [e.id, e]),
  );
  const sites = new Map(
    (
      await byIds(
        ctx,
        WorkforceSite,
        expenses.map((e) => e.siteId),
      )
    ).map((s) => [s.id, s]),
  );
  const groups = new Map<string, CandidateGroup & { sum: Decimal }>();
  for (const e of expenses) {
    const status = held.get(e.id);
    if (status === DOCSTATUS.submitted) continue; // being settled in this transaction's view; not waiting
    const method = e.paymentMethod as ExpensePaymentMethodValue;
    const key = `${e.employeeId}|${method}|${e.siteId}`;
    const employee = employees.get(e.employeeId);
    const g = groups.get(key) ?? {
      employeeId: e.employeeId,
      employeeCode: employee?.code ?? '',
      employeeName: employee?.name ?? '',
      siteId: e.siteId,
      siteName: sites.get(e.siteId)?.name ?? '',
      paymentMethod: method,
      kind: PAYMENT_METHOD_KIND[method],
      count: 0,
      total: '0',
      sum: Decimal.zero(),
      oldestDate: null,
      expenseIds: [],
      inDraftCount: 0,
    };
    if (status === DOCSTATUS.draft) g.inDraftCount += 1;
    else {
      g.count += 1;
      g.sum = g.sum.plus(e.amount);
      g.expenseIds.push(e.id);
      if (!g.oldestDate || e.expenseDate < g.oldestDate) g.oldestDate = e.expenseDate;
    }
    groups.set(key, g);
  }
  return {
    groups: [...groups.values()].map(({ sum, ...g }) => ({ ...g, total: sum.toString() })),
    advances: advances.map((a) => ({
      id: a.id,
      number: a.number,
      employeeId: a.employeeId,
      employeeName: employees.get(a.employeeId)?.name ?? '',
      siteId: a.siteId,
      date: a.date,
      amount: a.amount.toString(),
      purpose: a.purpose,
    })),
    truncated,
  };
}

export const settlementCandidatesAction = defineAction({
  name: 'expense.settlement_candidates',
  description: label(
    '精算待ちの承認済み経費（従業員 × 支払方法 × 拠点）と未精算の仮払',
    'Approved expenses awaiting settlement (employee x method x site) and open advances',
  ),
  input: settlementCandidatesInput,
  output: settlementCandidatesOutput,
  permission: { entity: ExpenseSettlement.name, op: 'create' },
  siteAccess: false,
  mutates: false,
  handler: candidates,
});
