// Postgres tests of roles and boundaries (docs/specs/expense-settlement.md AC-15, AC-16, AC-17, D25, D26, D27):
// accounting + workforce_payroll are both required (PERMISSION_DENIED details.op names the missing one), nobody settles
// their own expenses, employees read only their own records, site-scoped managers only their sites, and nothing
// crosses companies.
import {
  appMeta,
  companies,
  companyMemberships,
  newId,
  repo,
  users,
  hashPassword,
  type ContextParams,
} from '@daifuku/kernel';
import { Account, JournalEntry } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { Payment } from '@daifuku/mod-payment';
import { seedTaxRates } from '@daifuku/mod-tax';
import { WorkforceExpense, WorkforceSite } from '@daifuku/mod-workforce';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpenseSettlement, ExpenseSettlementLine } from '../src/index.ts';
import { caught, fixture, type Fixture, type Person, type Row, type Worker } from './fixture.ts';

let f: Fixture;
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.db.close();
});

const denied = (op: string) => ({ code: 'PERMISSION_DENIED', details: expect.objectContaining({ op }) });
type List = { items: (Row & { id: string })[]; total: number };

/** A settlement of `w` with one approved 1,100 yen expense, ready to submit. */
async function ready(w: Worker, by: Person = f.settler, approver: Person = f.manager) {
  const id = await f.approvedExpense(w, {}, approver);
  const d = await f.draft(
    { employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [id], partnerId: f.partners.alice },
    by.params,
  );
  await f.edit(d.id, { date: '2026-10-08' }, [{ invoiceKind: 'small_amount', payeeName: '店' }], by.params);
  return { id: d.id, expenseId: id };
}

describe('two roles are required (AC-15, D26)', () => {
  it('AC-15 accounting without workforce_payroll is refused with <op>:requires-workforce_payroll before any write', async () => {
    const w = await f.worker();
    const a = f.accounting.params;
    const expense = await f.approvedExpense(w);
    expect(await caught(f.act(a, 'expense.settlement_candidates', {}))).toMatchObject(
      denied('candidates:requires-workforce_payroll'),
    );
    expect(await caught(f.draft({ employeeId: w.employeeId, kind: 'reimbursement' }, a))).toMatchObject(
      denied('create:requires-workforce_payroll'),
    );
    expect(
      await caught(f.act(a, 'expense_settlement.create', { employeeId: w.employeeId, kind: 'reimbursement' })),
    ).toMatchObject(denied('create:requires-workforce_payroll'));
    expect(
      await caught(
        f.act(a, 'expense_advance.create', {
          employeeId: w.employeeId,
          partnerId: f.partners.alice,
          amount: '1000',
          purpose: 'x',
        }),
      ),
    ).toMatchObject(denied('create:requires-workforce_payroll'));
    const r = await ready(w);
    expect(await caught(f.edit(r.id, { note: 'x' }, undefined, a))).toMatchObject(
      denied('update:requires-workforce_payroll'),
    );
    expect(await caught(f.edit(r.id, {}, [{ payeeName: 'x' }], a))).toMatchObject(
      denied('update:requires-workforce_payroll'),
    );
    expect(await caught(f.submit(r.id, a))).toMatchObject(denied('submit:requires-workforce_payroll'));
    const s = await f.getSettlement(r.id);
    expect(await caught(f.act(a, 'expense_settlement.delete', { id: r.id, expectedVersion: s.version }))).toMatchObject(
      denied('delete:requires-workforce_payroll'),
    );
    await f.submit(r.id);
    expect(await caught(f.cancel(r.id, undefined, a))).toMatchObject(denied('cancel:requires-workforce_payroll'));
    expect((await f.run({}, (ctx) => repo(ctx, WorkforceExpense).get(r.expenseId))).status).toBe('settled');
    expect((await f.run({}, (ctx) => repo(ctx, WorkforceExpense).get(expense))).status).toBe('approved');
  });
  it('AC-15 workforce_payroll without accounting gets the kernel refusal (details.op create / submit)', async () => {
    const w = await f.worker();
    const p = f.payroll.params;
    expect(await caught(f.act(p, 'expense.settlement_candidates', {}))).toMatchObject(denied('create'));
    expect(await caught(f.draft({ employeeId: w.employeeId, kind: 'reimbursement' }, p))).toMatchObject(
      denied('create'),
    );
    const r = await ready(w);
    expect(await caught(f.submit(r.id, p))).toMatchObject(denied('submit'));
  });
  it('AC-15 nobody creates, submits or cancels a settlement of their own expenses (admin included)', async () => {
    const selfie = await f.person('selfie', ['workforce_employee']);
    const w = await f.worker('selfie-emp', f.siteA, selfie);
    const asSettler: Person = {
      id: selfie.id,
      params: {
        actor: { type: 'user', id: selfie.id },
        roles: ['accounting', 'workforce_payroll'],
        accessScope: 'all',
        siteIds: [],
      },
    };
    const expense = await f.approvedExpense(w);
    expect(
      await caught(
        f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [expense] }, asSettler.params),
      ),
    ).toMatchObject(denied('create:self-settlement'));
    const d = await f.draft({
      employeeId: w.employeeId,
      kind: 'reimbursement',
      expenseIds: [expense],
      partnerId: f.partners.alice,
    });
    await f.edit(d.id, { date: '2026-10-08' }, [{ invoiceKind: 'small_amount', payeeName: '店' }]);
    expect(await caught(f.submit(d.id, asSettler.params))).toMatchObject(denied('submit:self-settlement'));
    await f.submit(d.id);
    expect(await caught(f.cancel(d.id, undefined, asSettler.params))).toMatchObject(denied('cancel:self-settlement'));
    expect(
      await caught(
        f.act(asSettler.params, 'expense_advance.create', {
          employeeId: w.employeeId,
          partnerId: f.partners.alice,
          amount: '1000',
          purpose: 'x',
        }),
      ),
    ).toMatchObject(denied('create:self-settlement'));
    const adminEmployee = await f.worker('admin-emp', f.siteA, f.admin);
    expect(
      await caught(f.draft({ employeeId: adminEmployee.employeeId, kind: 'reimbursement' }, f.admin.params)),
    ).toMatchObject(denied('create:self-settlement'));
  });
});

describe('employee and site boundaries (AC-16, D25)', () => {
  it('AC-16 an employee reads only their own settlements, lines and advances; others are NOT_FOUND; no export', async () => {
    const alice = await f.worker();
    const bob = await f.worker();
    const mine = await ready(alice);
    const theirs = await ready(bob);
    await f.submit(mine.id);
    const list = await f.act<List>(alice.params, 'expense_settlement.list', {});
    expect(list.items.map((s) => s.id)).toEqual([mine.id]);
    expect(await caught(f.getSettlement(theirs.id, alice.params))).toMatchObject({ code: 'NOT_FOUND' });
    expect((await f.getSettlement(mine.id, alice.params)).lines.expense_settlement_line).toHaveLength(1);
    const lines = await f.run(alice.params, (ctx) => repo(ctx, ExpenseSettlementLine).list({ limit: 500 }));
    expect(new Set(lines.items.map((l) => l.settlementId))).toEqual(new Set([mine.id]));
    expect(await caught(f.act(alice.params, 'expense_settlement.related', { id: theirs.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    const related = await f.act<{ groups: { entity: string; items: Row[] }[] } & Row>(
      alice.params,
      'expense_settlement.related',
      {
        id: mine.id,
      },
    );
    expect(related).toBeTruthy();
    expect(await caught(f.act(alice.params, 'expense_settlement.export_rows', {}))).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    const adv = await f.act<Row & { id: string }>(f.settler.params, 'expense_advance.create', {
      employeeId: bob.employeeId,
      partnerId: f.partners.alice,
      date: '2026-10-01',
      amount: '1000',
      purpose: 'x',
    });
    expect(await caught(f.act(alice.params, 'expense_advance.get', { id: adv.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await f.act<List>(bob.params, 'expense_advance.list', {})).items.map((a) => a.id)).toEqual([adv.id]);
  });
  it('AC-16 a site-scoped manager reads only settlements of their sites', async () => {
    const atA = await f.worker();
    const atB = await f.worker('west1', f.siteB);
    const a = await ready(atA);
    const b = await ready(atB, f.settler, f.remote);
    const visible = async (p: Person) =>
      (await f.act<List>(p.params, 'expense_settlement.list', { limit: 500 })).items.map((s) => s.id);
    expect(await visible(f.manager)).toContain(a.id);
    expect(await visible(f.manager)).not.toContain(b.id);
    expect(await visible(f.remote)).toContain(b.id);
    expect(await visible(f.remote)).not.toContain(a.id);
    expect(await caught(f.getSettlement(b.id, f.manager.params))).toMatchObject({ code: 'NOT_FOUND' });
  });
  it('AC-16 D25 site-scoped settlers cannot list candidates, draft, submit or create for another site; the inbox skips expense.todo', async () => {
    const atA = await f.worker();
    const atB = await f.worker('west2', f.siteB);
    const scoped: Partial<ContextParams> = { ...f.settler.params, accessScope: 'sites', siteIds: [f.siteA] };
    expect(await caught(f.act(scoped, 'expense.settlement_candidates', {}))).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(await caught(f.draft({ employeeId: atA.employeeId, kind: 'reimbursement' }, scoped))).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    // the employee of the other site is invisible to the scoped context, so nothing can be created for them
    expect(
      await caught(f.act(scoped, 'expense_settlement.create', { employeeId: atB.employeeId, kind: 'reimbursement' })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(await f.run({}, (ctx) => repo(ctx, ExpenseSettlement).count({ employeeId: atB.employeeId }))).toBe(0);
    const r = await ready(atA);
    expect(await caught(f.submit(r.id, scoped))).toMatchObject({ code: 'PERMISSION_DENIED' });
    // D25: a site-scoped context cannot submit (kernel), so it is not offered the provider and the inbox never calls it
    const actions = await f.run(scoped, async (ctx) => appMeta(ctx).actions.map((a) => a.name));
    expect(actions).not.toContain('expense.todo');
    expect(actions).not.toContain('expense.settlement_candidates');
    expect(await caught(f.act(scoped, 'expense.todo', {}))).toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('AC-16 D27 accounting alone reads the copied expense date and description but not the workforce expense', async () => {
    const w = await f.worker();
    const r = await ready(w);
    const s = await f.getSettlement(r.id, f.accounting.params);
    expect(s.lines.expense_settlement_line[0]).toMatchObject({ expenseDate: '2026-10-05', description: '訪問交通費' });
    expect(
      await caught(f.run(f.accounting.params, (ctx) => repo(ctx, WorkforceExpense).get(r.expenseId))),
    ).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
});

describe('company isolation (AC-17)', () => {
  it('AC-17 records of another company are NOT_FOUND / absent, and its refs are VALIDATION; it stays unchanged', async () => {
    const other = newId();
    await f.db.owner.drizzle
      .insert(companies)
      .values({ id: other, tenantId: f.db.tenantId, code: 'B2', name: '別会社' });
    const inB = (p: Partial<ContextParams> = {}) => ({ ...p, companyId: other });
    const site = await f.run(inB(), async (ctx) => {
      await seedTaxRates(ctx);
      return repo(ctx, WorkforceSite).create({ code: 'X', name: '別会社拠点' });
    });
    const userId = newId();
    await f.db.owner.drizzle.insert(users).values({
      id: userId,
      tenantId: f.db.tenantId,
      email: 'b2-emp@example.com',
      name: 'b2',
      passwordHash: await hashPassword('test-password'),
      roles: ['workforce_employee'],
      defaultCompanyId: other,
    });
    await f.db.owner.drizzle.insert(companyMemberships).values({
      tenantId: f.db.tenantId,
      companyId: other,
      userId,
      roles: ['workforce_employee'],
      accessScope: 'sites',
      siteIds: [site.id],
    });
    const empB = await f.act<{ id: string }>(inB(f.hr.params), 'workforce.register_employee', {
      userId,
      siteId: site.id,
      code: 'B2E',
      name: 'B2 社員',
      hiredOn: '2026-01-01',
    });
    const employeeB: Worker = {
      id: userId,
      employeeId: empB.id,
      name: 'B2 社員',
      params: inB({
        actor: { type: 'user', id: userId },
        roles: ['workforce_employee'],
        accessScope: 'sites',
        siteIds: [site.id],
      }),
    };
    const managerB: Person = {
      id: newId(),
      params: inB({ actor: { type: 'user', id: newId() }, roles: ['workforce_manager'], accessScope: 'all' }),
    };
    const expenseB = await f.approvedExpense(employeeB, {}, managerB);
    const partnerB = await f.run(
      inB(),
      async (ctx) => (await repo(ctx, Partner).create({ code: 'PB', name: '別会社取引先' })).id,
    );
    const advanceB = await f.act<{ id: string }>(inB(), 'expense_advance.create', {
      employeeId: empB.id,
      partnerId: partnerB,
      date: '2026-10-01',
      amount: '1000',
      purpose: 'x',
    });
    const accountB = await f.run(inB(), async (ctx) => {
      await repo(ctx, Account).create({ code: '6900', name: '雑費', type: 'expense' });
      return (await repo(ctx, Account).create({ code: '1100', name: '普通預金', type: 'asset' })).id;
    });
    const settlementB = await f.draft({ employeeId: empB.id, kind: 'reimbursement', expenseIds: [expenseB] }, inB());
    const snapshot = () =>
      f.run(inB(), async (ctx) => ({
        entries: await repo(ctx, JournalEntry).count({}),
        payments: await repo(ctx, Payment).count({}),
        expense: (await repo(ctx, WorkforceExpense).get(expenseB)).version,
      }));
    const before = await snapshot();

    expect(await caught(f.getSettlement(settlementB.id))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await caught(f.act(f.settler.params, 'expense_advance.get', { id: advanceB.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(
      (await f.act<List>(f.settler.params, 'expense_settlement.list', { limit: 500 })).items.map((s) => s.id),
    ).not.toContain(settlementB.id);
    expect(await caught(f.draft({ employeeId: empB.id, kind: 'reimbursement' }))).toMatchObject({ code: 'NOT_FOUND' });
    const w = await f.worker();
    const r = await ready(w);
    for (const head of [{ partnerId: partnerB }, { advanceId: advanceB.id }, { paymentAccountId: accountB }])
      expect(await caught(f.edit(r.id, head))).toMatchObject({ code: 'VALIDATION' });
    expect(await caught(f.edit(r.id, {}, [{}, { $new: true, expenseId: expenseB }]))).toMatchObject({
      code: 'VALIDATION',
    });
    expect(await snapshot()).toEqual(before);
  });
});
