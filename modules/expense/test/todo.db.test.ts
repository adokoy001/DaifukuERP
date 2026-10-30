// Postgres tests of the expense.todo inbox provider and the candidates action (docs/specs/expense-settlement.md AC-18,
// AC-20 data, docs/specs/inbox.md AC-1): drafts of other people's settlements and open advances, counted in the
// caller's context, only for callers who can act; the candidates group approved expenses by employee x method x site.
import { appMeta, companies, newId, type ContextParams } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SettlementCandidates } from '../src/index.ts';
import { caught, fixture, type Fixture, type Person, type Row } from './fixture.ts';

let f: Fixture;
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.db.close();
});

type Todo = {
  items: { key: string; count: number; href: string; severity: string; label: { ja: string; en: string } }[];
};
const todo = (params: Partial<ContextParams>) => f.act<Todo>(params, 'expense.todo', {});
const count = (t: Todo, key: string) => t.items.find((i) => i.key === key)?.count ?? 0;

describe('expense.todo (AC-18)', () => {
  it('AC-18 counts drafts of other employees and open advances, with the hrefs and severities of the spec', async () => {
    const before = await todo(f.settler.params);
    const w = await f.worker();
    const e = await f.approvedExpense(w);
    await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [e] });
    const adv = await f.act<Row & { id: string }>(f.settler.params, 'expense_advance.create', {
      employeeId: w.employeeId,
      partnerId: f.partners.alice,
      date: '2026-10-01',
      amount: '5000',
      purpose: '仮払',
    });
    expect(count(await todo(f.settler.params), 'open_advances')).toBe(count(before, 'open_advances'));
    await f.act(f.settler.params, 'expense_advance.submit', { id: adv.id });
    const after = await todo(f.settler.params);
    expect(count(after, 'draft_settlements')).toBe(count(before, 'draft_settlements') + 1);
    expect(count(after, 'open_advances')).toBe(count(before, 'open_advances') + 1);
    expect(after.items.map((i) => [i.key, i.severity, i.href, i.label.ja])).toEqual([
      ['draft_settlements', 'warn', '/e/expense_settlement?status=draft', '確定待ちの経費精算書'],
      ['open_advances', 'info', '/finance/expenses', '未精算の仮払'],
    ]);
  });
  it('AC-18 a draft of the caller’s own expenses is not counted for that caller', async () => {
    const selfie = await f.person('todo-self', ['workforce_employee']);
    const w = await f.worker('todo-self-emp', f.siteA, selfie);
    const asSettler: Partial<ContextParams> = {
      actor: { type: 'user', id: selfie.id },
      roles: ['accounting', 'workforce_payroll'],
      accessScope: 'all',
      siteIds: [],
    };
    const base = count(await todo(asSettler), 'draft_settlements');
    const baseOther = count(await todo(f.settler.params), 'draft_settlements');
    const e = await f.approvedExpense(w);
    await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [e] });
    expect(count(await todo(asSettler), 'draft_settlements')).toBe(base);
    expect(count(await todo(f.settler.params), 'draft_settlements')).toBe(baseOther + 1);
  });
  it('AC-18 accounting without workforce_payroll gets no items; roles without submit are refused and not offered', async () => {
    expect(await todo(f.accounting.params)).toEqual({ items: [] });
    for (const p of [f.payroll, f.hr, f.manager] as Person[]) {
      expect(await caught(todo(p.params))).toMatchObject({ code: 'PERMISSION_DENIED' });
      expect(await f.run(p.params, async (ctx) => appMeta(ctx).actions.map((a) => a.name))).not.toContain(
        'expense.todo',
      );
    }
    expect(await f.run(f.settler.params, async (ctx) => appMeta(ctx).actions.map((a) => a.name))).toContain(
      'expense.todo',
    );
  });
  it('AC-18 another company counts nothing of this company', async () => {
    const other = newId();
    await f.db.owner.drizzle
      .insert(companies)
      .values({ id: other, tenantId: f.db.tenantId, code: 'TODO2', name: '別会社' });
    expect(await todo({ ...f.settler.params, companyId: other })).toEqual({ items: [] });
  });
});

describe('expense.settlement_candidates (AC-20 data)', () => {
  it('AC-20 groups approved expenses by employee x method x site, counts drafted ones apart, lists open advances', async () => {
    const w = await f.worker('cand1');
    const a = await f.approvedExpense(w, { amount: '1100', expenseDate: '2026-10-03' });
    const b = await f.approvedExpense(w, { amount: '500', expenseDate: '2026-10-01' });
    const c = await f.approvedExpense(w, { amount: '700', paymentMethod: 'corporate_card' });
    const drafted = await f.approvedExpense(w, { amount: '300' });
    await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [drafted] });
    const adv = await f.act<Row & { id: string }>(f.settler.params, 'expense_advance.create', {
      employeeId: w.employeeId,
      partnerId: f.partners.alice,
      date: '2026-10-01',
      amount: '2000',
      purpose: '仮払',
    });
    await f.act(f.settler.params, 'expense_advance.submit', { id: adv.id });
    const out = await f.act<SettlementCandidates>(f.settler.params, 'expense.settlement_candidates', {});
    const mine = out.groups.filter((g) => g.employeeId === w.employeeId);
    expect(
      mine
        .map((g) => [
          g.paymentMethod,
          g.kind,
          g.count,
          g.total,
          g.oldestDate,
          [...g.expenseIds].sort(),
          g.inDraftCount,
          g.siteName,
        ])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ).toEqual([
      ['corporate_card', 'corporate_card', 1, '700', '2026-10-05', [c], 0, '東拠点'],
      ['personal', 'reimbursement', 2, '1600', '2026-10-01', [a, b].sort(), 1, '東拠点'],
    ]);
    expect(out.advances.find((x) => x.id === adv.id)).toMatchObject({ employeeName: 'cand1', amount: '2000' });
    expect(out.truncated).toBe(false);
  });
});
