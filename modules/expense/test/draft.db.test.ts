// Postgres tests of drafting and editing an expense settlement (docs/specs/expense-settlement.md AC-3, AC-4, AC-5):
// expense.draft_settlement picks the approved expenses of one employee, kind and site; line saves re-check every
// expense under the employee lock and recompute the tax per receipt.
import { DOCSTATUS, newId, repo } from '@daifuku/kernel';
import { WorkforceEmployee } from '@daifuku/mod-workforce';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpenseSettlement } from '../src/index.ts';
import { caught, fixture, type Fixture, type Row } from './fixture.ts';
import { must } from './must.ts';

let f: Fixture;
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.db.close();
});

type Issues = { code: string; details: { issues: { path: string; message: string }[] } };
const messages = (e: unknown) => (e as Issues).details.issues.map((i) => i.message).join(' | ');

describe('expense.draft_settlement (AC-3)', () => {
  it('AC-3 drafts every approved expense of the kind outside another settlement, one line each, with defaults', async () => {
    const w = await f.worker();
    const a = await f.approvedExpense(w, { amount: '1100', expenseDate: '2026-10-02', description: '電車' });
    const b = await f.approvedExpense(w, { amount: '540', expenseDate: '2026-10-01', description: '弁当' });
    await f.approvedExpense(w, { amount: '9999', paymentMethod: 'corporate_card' });
    const out = await f.draft({ employeeId: w.employeeId, kind: 'reimbursement' });
    expect(out).toEqual({ id: expect.any(String), version: expect.any(Number) });
    const s = await f.getSettlement(out.id);
    expect(s).toMatchObject({
      docstatus: DOCSTATUS.draft,
      kind: 'reimbursement',
      date: '2026-10-10',
      partnerId: null,
      advanceId: null,
      siteId: f.siteA,
      userId: w.id,
      total: '1640',
    });
    expect(
      s.lines.expense_settlement_line.map((l) => [
        l.expenseId,
        l.expenseDate,
        l.description,
        l.amount,
        l.accountId,
        l.taxCategory,
        l.payeeName,
        l.invoiceKind,
      ]),
    ).toEqual([
      [b, '2026-10-01', '弁当', '540', f.acc['6900'], 'standard', null, null],
      [a, '2026-10-02', '電車', '1100', f.acc['6900'], 'standard', null, null],
    ]);
    expect(await caught(f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [a] }))).toMatchObject({
      code: 'CONFLICT',
      details: { expenseId: a, settlementId: out.id },
    });
  });
  it('AC-3 refuses when no expense is waiting (no empty draft), except an advance settlement naming its advance', async () => {
    const w = await f.worker();
    const before = await f.run({}, (ctx) => repo(ctx, ExpenseSettlement).count({ employeeId: w.employeeId }));
    expect(await caught(f.draft({ employeeId: w.employeeId, kind: 'corporate_card' }))).toMatchObject({
      code: 'VALIDATION',
    });
    expect(await f.run({}, (ctx) => repo(ctx, ExpenseSettlement).count({ employeeId: w.employeeId }))).toBe(before);
    const adv = await f.act<Row & { id: string }>(f.settler.params, 'expense_advance.create', {
      employeeId: w.employeeId,
      partnerId: f.partners.alice,
      date: '2026-10-01',
      amount: '10000',
      purpose: '仮払',
    });
    await f.act(f.settler.params, 'expense_advance.submit', { id: adv.id });
    const out = await f.draft({ employeeId: w.employeeId, kind: 'advance', advanceId: adv.id });
    const s = await f.getSettlement(out.id);
    expect(s).toMatchObject({
      advanceId: adv.id,
      partnerId: f.partners.alice,
      advanceAmount: '10000',
      refundAmount: '10000',
    });
    expect(s.lines.expense_settlement_line).toEqual([]);
  });
  it('AC-3 the partner defaults to the latest submitted settlement of the same kind for the employee', async () => {
    const w = await f.worker();
    const first = await f.approvedExpense(w, { amount: '1100', paymentMethod: 'corporate_card' });
    const d1 = await f.draft({
      employeeId: w.employeeId,
      kind: 'corporate_card',
      expenseIds: [first],
      partnerId: f.partners.card,
    });
    await f.edit(d1.id, { date: '2026-10-08' }, [{ invoiceKind: 'small_amount', payeeName: '店' }]);
    await f.submit(d1.id);
    const reimb = await f.approvedExpense(w, { amount: '500' });
    const card = await f.approvedExpense(w, { amount: '700', paymentMethod: 'corporate_card' });
    expect(
      (
        await f.getSettlement(
          (await f.draft({ employeeId: w.employeeId, kind: 'corporate_card', expenseIds: [card] })).id,
        )
      ).partnerId,
    ).toBe(f.partners.card);
    expect(
      (
        await f.getSettlement(
          (await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [reimb] })).id,
        )
      ).partnerId,
    ).toBeNull();
  });
  it('AC-3 refuses expenses of several sites (one settlement per site)', async () => {
    // An approved expense blocks a transfer, so two sites meet only when a settlement of the old site is cancelled
    // after the employee moved: the reopened expense stays at the old site.
    const p = await f.person('mover', ['workforce_employee'], [f.siteA, f.siteB]);
    const w = await f.worker('mover-emp', f.siteA, p);
    const atA = await f.approvedExpense(w, { amount: '1100' });
    const first = await f.draft({
      employeeId: w.employeeId,
      kind: 'reimbursement',
      expenseIds: [atA],
      partnerId: f.partners.alice,
    });
    await f.edit(first.id, { date: '2026-10-08' }, [{ invoiceKind: 'small_amount', payeeName: '店' }]);
    await f.submit(first.id);
    const employee = await f.run(f.hr.params, (ctx) => repo(ctx, WorkforceEmployee).get(w.employeeId));
    await f.run(f.hr.params, (ctx) =>
      repo(ctx, WorkforceEmployee).update(employee.id, { siteId: f.siteB }, { expectedVersion: employee.version }),
    );
    const atB = await f.approvedExpense(w, { amount: '500' }, f.remote);
    await f.cancel(first.id);
    const e = await caught(f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [atA, atB] }));
    expect(e).toMatchObject({ code: 'VALIDATION' });
    expect(messages(e)).toContain('one site');
    const atOld = await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [atA] });
    expect((await f.getSettlement(atOld.id)).siteId).toBe(f.siteA);
  });
  it('AC-3 an unknown or other-company employee is NOT_FOUND', async () => {
    expect(
      await caught(f.draft({ employeeId: '00000000-0000-4000-8000-000000000000', kind: 'reimbursement' })),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('line checks (AC-4)', () => {
  it('AC-4 refuses expenses of another employee, unapproved, or paid with another method; the issues name the line', async () => {
    const w = await f.worker();
    const other = await f.worker();
    const own = await f.approvedExpense(w, { amount: '1100' });
    const theirs = await f.approvedExpense(other, { amount: '200' });
    const card = await f.approvedExpense(w, { amount: '300', paymentMethod: 'corporate_card' });
    const d = await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [own] });
    const e1 = await caught(f.edit(d.id, {}, [{}, { $new: true, expenseId: theirs }]));
    expect(e1).toMatchObject({ code: 'VALIDATION' });
    expect(messages(e1)).toContain('another employee');
    const e2 = await caught(f.edit(d.id, {}, [{}, { $new: true, expenseId: card }]));
    expect(messages(e2)).toContain('takes personal');
    const pending = await f.act<{ id: string; version: number }>(w.params, 'workforce.save_expense', {
      expectedVersion: 0,
      idempotencyKey: newId(),
      expenseDate: '2026-10-05',
      category: '交通費',
      description: '未承認',
      amount: '100',
      evidence: 'x',
    });
    const e3 = await caught(f.edit(d.id, {}, [{}, { $new: true, expenseId: pending.id }]));
    expect(messages(e3)).toContain('not approved');
    expect((await f.getSettlement(d.id)).lines.expense_settlement_line).toHaveLength(1);
  });
  it('AC-4 an expense held by another draft is CONFLICT naming that settlement; copied fields are server-owned', async () => {
    const w = await f.worker();
    const a = await f.approvedExpense(w, { amount: '1100' });
    const b = await f.approvedExpense(w, { amount: '200' });
    const first = await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [a] });
    const second = await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [b] });
    expect(await caught(f.edit(second.id, {}, [{}, { $new: true, expenseId: a }]))).toMatchObject({
      code: 'CONFLICT',
      details: { expenseId: a, settlementId: first.id },
    });
    expect(await caught(f.edit(second.id, {}, [{ description: '改ざん' }]))).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(await caught(f.edit(second.id, {}, [{ expenseDate: '2026-01-01' }]))).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(await caught(f.edit(second.id, { total: '1' }))).toMatchObject({ code: 'PERMISSION_DENIED' });
    // deleting the first draft frees the expense
    const s1 = await f.getSettlement(first.id);
    await f.act(f.settler.params, 'expense_settlement.delete', { id: first.id, expectedVersion: s1.version });
    await f.edit(second.id, {}, [{}, { $new: true, expenseId: a }]);
    expect((await f.getSettlement(second.id)).lines.expense_settlement_line).toHaveLength(2);
  });
});

describe('draft recalculation (AC-5)', () => {
  it('AC-5 recomputes line tax, header totals and the tax summary on every save', async () => {
    const w = await f.worker();
    const a = await f.approvedExpense(w, { amount: '3300', expenseDate: '2026-10-05' });
    const b = await f.approvedExpense(w, { amount: '1080', expenseDate: '2026-10-06' });
    const d = await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [a, b] });
    const s0 = await f.getSettlement(d.id);
    expect(s0).toMatchObject({ total: '4380', taxTotal: '398' }); // both standard by default: 300 + 98
    const s1 = await f.edit(d.id, {}, [
      { invoiceKind: 'qualified', invoiceRegistrationNo: 'T1234567890123', payeeName: 'JR' },
      {
        taxCategory: 'reduced',
        invoiceKind: 'not_qualified',
        invoiceRegistrationNo: 'T1234567890123',
        payeeName: '弁当屋',
      },
    ]);
    const s = await f.getSettlement(s1.id);
    expect(s).toMatchObject({
      subtotal: '4000',
      taxTotal: '380',
      deductibleTax: '356',
      nonDeductibleTax: '24',
      total: '4380',
      payAmount: '4380',
    });
    expect(
      s.lines.expense_settlement_line.map((l) => [
        l.taxRate,
        l.taxableAmount,
        l.taxAmount,
        l.deductibleTax,
        l.nonDeductibleTax,
        l.creditRatio,
        l.invoiceRegistrationNo,
      ]),
    ).toEqual([
      ['0.1', '3000', '300', '300', '0', '1', 'T1234567890123'],
      ['0.08', '1000', '80', '56', '24', '0.7', null],
    ]);
    const summary = s.taxSummary as { groups: Row[]; totals: Row };
    expect(summary.groups.map((g) => [g.category, g.rate, g.tax, g.deductibleTax])).toEqual([
      ['standard', '0.1', '300', '300'],
      ['reduced', '0.08', '80', '56'],
    ]);
  });
  it('AC-5 keeps the registration number only for qualified and the reason only for books_only; zero-rate clears both', async () => {
    const w = await f.worker();
    const a = await f.approvedExpense(w, { amount: '550' });
    const d = await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [a] });
    await f.edit(d.id, {}, [
      { invoiceKind: 'books_only', booksOnlyReason: 'public_transport', invoiceRegistrationNo: 'T1234567890123' },
    ]);
    const lineOf = async () => must((await f.getSettlement(d.id)).lines.expense_settlement_line[0], 'line');
    let line = await lineOf();
    expect([line.invoiceKind, line.booksOnlyReason, line.invoiceRegistrationNo]).toEqual([
      'books_only',
      'public_transport',
      null,
    ]);
    await f.edit(d.id, {}, [{ invoiceKind: 'qualified', invoiceRegistrationNo: 'T1234567890123' }]);
    line = await lineOf();
    expect([line.invoiceKind, line.booksOnlyReason, line.invoiceRegistrationNo]).toEqual([
      'qualified',
      null,
      'T1234567890123',
    ]);
    await f.edit(d.id, {}, [{ taxCategory: 'non_taxable' }]);
    line = await lineOf();
    expect([line.invoiceKind, line.invoiceRegistrationNo, line.taxAmount, line.creditRatio]).toEqual([
      null,
      null,
      '0',
      null,
    ]);
    expect((await f.getSettlement(d.id)).taxTotal).toBe('0');
  });
  it('AC-5 refuses a non-positive or fractional yen amount and an invalid registration number', async () => {
    const w = await f.worker();
    const a = await f.approvedExpense(w, { amount: '550' });
    const d = await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [a] });
    for (const amount of ['0', '-10', '10.5'])
      expect(await caught(f.edit(d.id, {}, [{ amount }]))).toMatchObject({ code: 'VALIDATION' });
    expect(await caught(f.edit(d.id, {}, [{ invoiceKind: 'qualified', invoiceRegistrationNo: 'T123' }]))).toMatchObject(
      {
        code: 'VALIDATION',
      },
    );
  });
});
