// Postgres tests of the expense settlement document (docs/specs/expense-settlement.md AC-2, AC-6..AC-12): submit posts
// the expense entry and the clearing payment in one transaction (golden), failures roll back everything, concurrent
// settlements of one expense or advance have one winner, and cancel + amend reverse and recreate the postings.
// Test DB: TEST_DATABASE_URL* (see kernel/src/testing.ts).
import { DOCSTATUS, newId, registry, repo, setSetting, StateError, type HookFn } from '@daifuku/kernel';
import { FiscalPeriod, JournalEntry } from '@daifuku/mod-accounting';
import { Payment } from '@daifuku/mod-payment';
import { TAX_ROUNDING_KEY, taxRoundingSchema } from '@daifuku/mod-tax';
import { WorkforceExpense } from '@daifuku/mod-workforce';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPENSE_ACCOUNTS_KEY, ExpenseAdvance, ExpenseSettlement, expenseAccountsSchema } from '../src/index.ts';
import { caught, fixture, type Fixture, type Row, type Worker } from './fixture.ts';
import { goldenCases, type GoldenCase } from './golden.ts';
import { must } from './must.ts';

let f: Fixture;
/** Test-only failure injected into payment before_submit (AC-9) and payment before_cancel (AC-11 bank reconciliation). */
const inject = { paymentSubmit: false, paymentCancel: false };
beforeAll(async () => {
  f = await fixture();
  const failSubmit: HookFn = () => {
    if (inject.paymentSubmit) throw new StateError('injected payment failure', 'test hook (AC-9)');
  };
  const failCancel: HookFn = () => {
    if (inject.paymentCancel)
      throw new StateError('銀行照合を先に取り消してください。', 'test hook standing in for the banking guard (AC-11)');
  };
  registry.registerHook(Payment.name, 'before_submit', failSubmit);
  registry.registerHook(Payment.name, 'before_cancel', failCancel);
});
afterAll(async () => {
  await f?.db.close();
});

const METHOD = { reimbursement: 'personal', corporate_card: 'corporate_card', advance: 'advance' } as const;

async function advance(w: Worker, amount: string, date = '2026-10-01', partnerId = f.partners.alice) {
  const created = await f.act<Row & { id: string }>(f.settler.params, 'expense_advance.create', {
    employeeId: w.employeeId,
    partnerId,
    date,
    amount,
    purpose: '出張の仮払',
    method: 'bank_transfer',
  });
  return f.act<Row & { id: string; paymentId: string; status: string }>(f.settler.params, 'expense_advance.submit', {
    id: created.id,
  });
}
const settlementRow = (id: string) => f.run({}, (ctx) => repo(ctx, ExpenseSettlement).get(id));
const expenseRow = (id: string) => f.run({}, (ctx) => repo(ctx, WorkforceExpense).get(id));
const advanceRow = (id: string) => f.run({}, (ctx) => repo(ctx, ExpenseAdvance).get(id));
const counts = () =>
  f.run({}, async (ctx) => ({
    entries: await repo(ctx, JournalEntry).count({ sourceEntity: ExpenseSettlement.name }),
    payments: await repo(ctx, Payment).count({}),
  }));

/** One ready-to-submit settlement of `kind` with the given receipts (each one expense), partner and invoice fields set. */
async function prepared(c: Pick<GoldenCase, 'kind' | 'date' | 'receipts' | 'advance'>, w?: Worker) {
  const worker = w ?? (await f.worker());
  const expenseIds: string[] = [];
  for (const r of c.receipts)
    expenseIds.push(
      await f.approvedExpense(worker, { expenseDate: r.expenseDate, amount: r.amount, paymentMethod: METHOD[c.kind] }),
    );
  const adv = c.kind === 'advance' ? await advance(worker, c.advance ?? '0') : null;
  const partnerId = c.kind === 'corporate_card' ? f.partners.card : f.partners.alice;
  const drafted = await f.draft({
    employeeId: worker.employeeId,
    kind: c.kind,
    date: c.date,
    ...(expenseIds.length ? { expenseIds } : {}),
    ...(adv ? { advanceId: adv.id } : { partnerId }),
  });
  const lines = c.receipts.flatMap((r, i) =>
    r.lines.map((l, j) => ({
      ...(j > 0 ? { $new: true } : {}),
      expenseId: expenseIds[i],
      accountId: f.acc[l.account as keyof typeof f.acc],
      taxCategory: l.taxCategory,
      amount: l.amount,
      invoiceKind: l.invoiceKind,
      payeeName: 'テスト交通',
      invoiceRegistrationNo: l.invoiceKind === 'qualified' ? 'T1234567890123' : null,
      booksOnlyReason: l.booksOnlyReason ?? null,
    })),
  );
  // a receipt split over two lines: the first line keeps the stored row, the second is new
  const ordered = c.receipts.length && lines.length !== c.receipts.length ? reorder(lines, c.receipts) : lines;
  if (ordered.length) await f.edit(drafted.id, {}, ordered);
  return { worker, id: drafted.id, expenseIds, advance: adv, partnerId };
}
function reorder(lines: Row[], receipts: GoldenCase['receipts']): Row[] {
  // stored lines are one per expense in receipt order; keep that order for the first line of each receipt and append
  // the extra lines after them so the stored ids line up with the first rows
  const first: Row[] = [];
  const extra: Row[] = [];
  let k = 0;
  for (const r of receipts)
    r.lines.forEach((_, j) => {
      (j === 0 ? first : extra).push(lines[k++] as Row);
    });
  return [...first, ...extra];
}

describe('expense settlement golden (AC-7, AC-8)', () => {
  for (const c of goldenCases())
    it(`AC-7 AC-8 golden ${c.id}: the posted entry, the clearing payment and its entry match the golden`, async () => {
      if (c.rounding !== 'down')
        await f.run({}, (ctx) =>
          setSetting(ctx, TAX_ROUNDING_KEY, taxRoundingSchema, { mode: c.rounding, unit: 'invoice' }),
        );
      try {
        const p = await prepared(c);
        const submitted = await f.submit(p.id);
        expect(submitted.docstatus).toBe(DOCSTATUS.submitted);
        expect(submitted.number).toMatch(/^EXP-2026-/);
        const row = await settlementRow(p.id);
        expect({
          subtotal: row.subtotal.toString(),
          taxTotal: row.taxTotal.toString(),
          deductibleTax: row.deductibleTax.toString(),
          nonDeductibleTax: row.nonDeductibleTax.toString(),
          total: row.total.toString(),
        }).toEqual(c.expect.totals);
        expect({
          advanceAmount: row.advanceAmount.toString(),
          payAmount: row.payAmount.toString(),
          refundAmount: row.refundAmount.toString(),
        }).toEqual(c.expect.amounts);
        if (c.expect.journal.length === 0) expect(row.journalEntryId).toBeNull();
        else {
          const entry = await f.run({}, (ctx) => repo(ctx, JournalEntry).get(row.journalEntryId as string));
          expect(entry.date).toBe(c.date);
          expect(entry.description).toBe(`経費精算 ${submitted.number} ${p.worker.name}`);
          const lines = await f.entryLines(entry.id);
          expect(
            lines.map((l) => [
              l.code,
              l.debit,
              l.credit,
              l.taxCategory,
              l.taxRate,
              l.memo,
              l.partnerId === p.partnerId ? 'P' : l.partnerId,
            ]),
          ).toEqual(c.expect.journal);
        }
        if (!c.expect.payment) expect(row.paymentId).toBeNull();
        else {
          const payment = await f.run({}, (ctx) => repo(ctx, Payment).get(row.paymentId as string));
          expect({
            direction: payment.direction,
            amount: payment.amount.toString(),
            counter: f.codeOf.get(payment.counterAccountId ?? ''),
          }).toEqual(c.expect.payment);
          expect([payment.docstatus, payment.date, payment.partnerId]).toEqual([
            DOCSTATUS.submitted,
            c.date,
            p.partnerId,
          ]);
          expect([payment.allocatedAmount.toString(), payment.unallocatedAmount.toString()]).toEqual(['0', '0']);
          expect(payment.note).toBe(`経費精算 ${submitted.number} ${p.worker.name}`);
          const plines = await f.entryLines(payment.journalEntryId as string);
          expect(plines.map((l) => [l.code, l.debit, l.credit])).toEqual(c.expect.paymentJournal);
          expect(plines.every((l) => l.partnerId === p.partnerId)).toBe(true);
        }
        for (const id of p.expenseIds)
          expect(await expenseRow(id)).toMatchObject({
            status: 'settled',
            paidOn: c.date,
            paymentReference: submitted.number,
            settledBy: f.settler.id,
          });
        if (p.advance) expect((await advanceRow(p.advance.id)).status).toBe('settled');
      } finally {
        if (c.rounding !== 'down')
          await f.run({}, (ctx) =>
            setSetting(ctx, TAX_ROUNDING_KEY, taxRoundingSchema, { mode: 'down', unit: 'invoice' }),
          );
      }
    });
});

const simple = (kind: GoldenCase['kind'] = 'reimbursement', amount = '1100', adv: string | null = null) => ({
  kind,
  date: '2026-10-08',
  advance: adv,
  receipts: [
    {
      ref: 'A',
      expenseDate: '2026-10-05',
      amount,
      lines: [{ account: '6500', taxCategory: 'standard' as const, amount, invoiceKind: 'small_amount' as const }],
    },
  ],
});

describe('approval and settled expenses (AC-2)', () => {
  it('AC-2 refuses an expense that is not approved and marks included expenses settled with the number', async () => {
    const w = await f.worker();
    const saved = await f.act<{ id: string; version: number }>(w.params, 'workforce.save_expense', {
      expectedVersion: 0,
      idempotencyKey: newId(),
      expenseDate: '2026-10-05',
      category: '交通費',
      description: '未承認',
      amount: '500',
      evidence: '領収書',
    });
    const refused = await caught(f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [saved.id] }));
    expect(refused).toMatchObject({ code: 'VALIDATION' });
    const before = await f.act<{ items: { key: string; count: number }[] }>(f.payroll.params, 'workforce.todo', {});
    const waiting = (todo: typeof before) => todo.items.find((i) => i.key === 'expense_settlement')?.count ?? 0;
    const p = await prepared(simple(), w);
    const mid = await f.act<typeof before>(f.payroll.params, 'workforce.todo', {});
    expect(waiting(mid)).toBe(waiting(before) + 1);
    const submitted = await f.submit(p.id);
    const after = await f.act<typeof before>(f.payroll.params, 'workforce.todo', {});
    expect(waiting(after)).toBe(waiting(before));
    const portal = await f.act<{ expenses: Row[] }>(w.params, 'workforce.my_portal', {});
    expect(portal.expenses.find((e) => e.id === p.expenseIds[0])).toMatchObject({
      status: 'settled',
      paymentReference: submitted.number,
      paidOn: '2026-10-08',
    });
  });
});

describe('submit validation (AC-6)', () => {
  it('AC-6 lists missing partner, invoice fields, payee and a future date; nothing is written', async () => {
    const w = await f.worker();
    const id = await f.approvedExpense(w, { amount: '1100' });
    const d = await f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [id] });
    await f.edit(d.id, { date: '2026-10-12' });
    const before = await counts();
    const e = (await caught(f.submit(d.id))) as { code: string; details: { issues: { path: string }[] } };
    expect(e).toMatchObject({ code: 'VALIDATION' });
    const paths = e.details.issues.map((i) => i.path).sort();
    expect(paths).toEqual(['date', 'lines[0].invoiceKind', 'lines[0].payeeName', 'partnerId'].sort());
    expect(await counts()).toEqual(before);
    expect((await settlementRow(d.id)).docstatus).toBe(DOCSTATUS.draft);
    expect((await expenseRow(id)).status).toBe('approved');
  });
  it('AC-6 requires line amounts per expense to equal the expense, one invoice kind per receipt and a date after the expense', async () => {
    const w = await f.worker();
    const id = await f.approvedExpense(w, { amount: '1100', expenseDate: '2026-10-05' });
    const d = await f.draft({
      employeeId: w.employeeId,
      kind: 'reimbursement',
      expenseIds: [id],
      partnerId: f.partners.alice,
    });
    await f.edit(d.id, { date: '2026-10-04' }, [
      { amount: '600', invoiceKind: 'small_amount', payeeName: '店' },
      { $new: true, expenseId: id, amount: '400', invoiceKind: 'none', payeeName: '店' },
    ]);
    const e = (await caught(f.submit(d.id))) as {
      code: string;
      details: { issues: { path: string; message: string }[] };
    };
    expect(e).toMatchObject({ code: 'VALIDATION' });
    const messages = e.details.issues.map((i) => i.message).join(' | ');
    expect(messages).toContain('total 1000');
    expect(messages).toContain('same invoice kind');
    expect(messages).toContain('on or after the expense date');
  });
  it('AC-6 the kind is immutable, and an expense settled manually after the draft fails the submit with nothing posted', async () => {
    const w = await f.worker();
    const p = await prepared(simple(), w);
    expect(await caught(f.edit(p.id, { kind: 'corporate_card' }))).toMatchObject({ code: 'VALIDATION' });
    const row = await expenseRow(p.expenseIds[0] as string);
    await f.act(f.payroll.params, 'workforce.settle_expense', {
      expenseId: row.id,
      expectedVersion: row.version,
      paidOn: '2026-10-08',
      reference: 'MANUAL-1',
    });
    const before = await counts();
    const e = (await caught(f.submit(p.id))) as { code: string; details: { issues: { message: string }[] } };
    expect(e).toMatchObject({ code: 'VALIDATION' });
    expect(e.details.issues.map((i) => i.message).join(' ')).toContain('settled, not approved');
    expect(await counts()).toEqual(before);
  });
  it('AC-6 an advance settlement needs an open advance of the same employee and partner; others refuse an advance', async () => {
    const w = await f.worker();
    const other = await f.worker();
    const theirs = await advance(other, '5000');
    const id = await f.approvedExpense(w, { amount: '1100', paymentMethod: 'advance' });
    const d = await f.draft({
      employeeId: w.employeeId,
      kind: 'advance',
      expenseIds: [id],
      partnerId: f.partners.alice,
    });
    await f.edit(d.id, { advanceId: theirs.id, partnerId: f.partners.card }, [
      { invoiceKind: 'small_amount', payeeName: '店' },
    ]);
    const e = (await caught(f.submit(d.id))) as {
      code: string;
      details: { issues: { path: string; message: string }[] };
    };
    expect(e).toMatchObject({ code: 'VALIDATION' });
    const messages = e.details.issues.map((i) => `${i.path}: ${i.message}`).join(' | ');
    expect(messages).toContain('another employee');
    expect(messages).toContain("partnerId: must be the advance's partner");
    const r = await f.approvedExpense(w, { amount: '500' });
    const reimb = await f.draft({
      employeeId: w.employeeId,
      kind: 'reimbursement',
      expenseIds: [r],
      partnerId: f.partners.alice,
    });
    await f.edit(reimb.id, { advanceId: theirs.id }, [{ invoiceKind: 'small_amount', payeeName: '店' }]);
    const e2 = (await caught(f.submit(reimb.id))) as { code: string; details: { issues: { path: string }[] } };
    expect(e2.details.issues.map((i) => i.path)).toContain('advanceId');
  });
});

describe('atomic submit (AC-9)', () => {
  it('AC-9 a failing payment rolls back the entry, the payment, the expenses and the advance', async () => {
    const w = await f.worker();
    const p = await prepared(simple('advance', '3300', '1000'), w);
    const before = await counts();
    inject.paymentSubmit = true;
    try {
      expect(await caught(f.submit(p.id))).toMatchObject({
        code: 'INVALID_STATE',
        message: 'injected payment failure',
      });
    } finally {
      inject.paymentSubmit = false;
    }
    expect(await counts()).toEqual(before);
    expect((await settlementRow(p.id)).docstatus).toBe(DOCSTATUS.draft);
    expect((await expenseRow(p.expenseIds[0] as string)).status).toBe('approved');
    expect((await advanceRow(must(p.advance, 'advance').id)).status).toBe('open');
    expect((await f.submit(p.id)).docstatus).toBe(DOCSTATUS.submitted);
  });
  it('AC-9 a closed period and a missing account refuse the submit with nothing written', async () => {
    const w = await f.worker();
    const p = await prepared(
      { ...simple(), date: '2026-09-30', receipts: [{ ...must(simple().receipts[0]), expenseDate: '2026-09-29' }] },
      w,
    );
    const september = await f.run(
      {},
      async (ctx) => (await repo(ctx, FiscalPeriod).list({ where: { code: '2026-09' } })).items[0],
    );
    await f.act({}, 'accounting.close_period', { periodId: must(september, 'period 2026-09').id });
    const before = await counts();
    try {
      expect(await caught(f.submit(p.id))).toMatchObject({ code: 'INVALID_STATE' });
      expect(await counts()).toEqual(before);
      expect((await expenseRow(p.expenseIds[0] as string)).status).toBe('approved');
    } finally {
      await f.act({}, 'accounting.reopen_period', { periodId: must(september, 'period 2026-09').id });
    }
    const accounts = (payable: string) =>
      f.run({}, (ctx) =>
        setSetting(ctx, EXPENSE_ACCOUNTS_KEY, expenseAccountsSchema, {
          advance: '1800',
          payable,
          defaultExpense: '6900',
        }),
      );
    await accounts('2999');
    try {
      const e = await caught(f.submit(p.id, f.settler.params));
      expect(e).toMatchObject({ code: 'INVALID_STATE', details: { missing: [{ role: 'payable', code: '2999' }] } });
      expect(await counts()).toEqual(before);
    } finally {
      await accounts('2150');
    }
    expect((await f.submit(p.id)).docstatus).toBe(DOCSTATUS.submitted);
  });
});

describe('concurrency (AC-10)', () => {
  it('AC-10 two concurrent drafts of the same expense: one draft, the other CONFLICT', async () => {
    const w = await f.worker();
    const id = await f.approvedExpense(w);
    const results = await Promise.allSettled([
      f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [id] }),
      f.draft({ employeeId: w.employeeId, kind: 'reimbursement', expenseIds: [id] }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'CONFLICT' });
    const live = await f.run({}, (ctx) => repo(ctx, ExpenseSettlement).count({ employeeId: w.employeeId }));
    expect(live).toBe(1);
  });
  it('AC-10 a manual workforce.settle_expense racing the submit: exactly one wins and the loser leaves nothing', async () => {
    const w = await f.worker();
    const p = await prepared(simple(), w);
    const expense = await expenseRow(p.expenseIds[0] as string);
    const before = await counts();
    const results = await Promise.allSettled([
      f.submit(p.id),
      f.act(f.payroll.params, 'workforce.settle_expense', {
        expenseId: expense.id,
        expectedVersion: expense.version,
        paidOn: '2026-10-08',
        reference: 'MANUAL-RACE',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const after = await counts();
    const settledBySettlement = results[0]?.status === 'fulfilled';
    expect(after.entries - before.entries).toBe(settledBySettlement ? 1 : 0);
    expect(after.payments - before.payments).toBe(settledBySettlement ? 1 : 0);
    expect((await expenseRow(expense.id)).status).toBe('settled');
    expect((await settlementRow(p.id)).docstatus).toBe(settledBySettlement ? DOCSTATUS.submitted : DOCSTATUS.draft);
  });
  it('AC-10 two settlements clearing the same advance submitted concurrently: one wins', async () => {
    const w = await f.worker();
    const adv = await advance(w, '2000');
    const drafts = [];
    for (const amount of ['1100', '550']) {
      const id = await f.approvedExpense(w, { amount, paymentMethod: 'advance' });
      const d = await f.draft({ employeeId: w.employeeId, kind: 'advance', expenseIds: [id], advanceId: adv.id });
      await f.edit(d.id, {}, [{ invoiceKind: 'small_amount', payeeName: '店' }]);
      drafts.push(d.id);
    }
    const results = await Promise.allSettled(drafts.map((id) => f.submit(id)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'VALIDATION' });
    expect((await advanceRow(adv.id)).status).toBe('settled');
    const submitted = await f.run({}, (ctx) =>
      repo(ctx, ExpenseSettlement).count({ advanceId: adv.id, docstatus: DOCSTATUS.submitted }),
    );
    expect(submitted).toBe(1);
  });
});

describe('immutability, cancel and amend (AC-11, AC-12)', () => {
  it('AC-11 a submitted settlement refuses header, line and delete changes', async () => {
    const p = await prepared(simple());
    const s = await f.submit(p.id);
    expect(await caught(f.edit(p.id, { note: 'changed' }))).toMatchObject({ code: 'INVALID_STATE' });
    expect(await caught(f.edit(p.id, {}, [{ amount: '1000' }]))).toMatchObject({ code: 'INVALID_STATE' });
    expect(
      await caught(f.act(f.settler.params, 'expense_settlement.delete', { id: p.id, expectedVersion: s.version })),
    ).toMatchObject({ code: 'INVALID_STATE' });
  });
  it('AC-11 cancel reverses the entry, cancels the payment, reopens the expenses and the advance; amend re-posts', async () => {
    const w = await f.worker();
    const p = await prepared(simple('advance', '3300', '1000'), w);
    const s = await f.submit(p.id);
    const row = await settlementRow(p.id);
    expect(await f.balance('1800', f.partners.alice)).not.toBe('0');
    const cancelled = await f.cancel(p.id, '2026-10-09');
    expect(cancelled.docstatus).toBe(DOCSTATUS.cancelled);
    const reversal = await f.run(
      {},
      async (ctx) =>
        (await repo(ctx, JournalEntry).list({ where: { reversalOf: row.journalEntryId as string } })).items,
    );
    expect(reversal).toHaveLength(1);
    expect(reversal[0]?.date).toBe('2026-10-09');
    const payment = await f.run({}, (ctx) => repo(ctx, Payment).get(row.paymentId as string));
    expect(payment.docstatus).toBe(DOCSTATUS.cancelled);
    const paymentReversal = await f.run(
      {},
      async (ctx) =>
        (await repo(ctx, JournalEntry).list({ where: { reversalOf: payment.journalEntryId as string } })).items,
    );
    expect(paymentReversal[0]?.date).toBe('2026-10-09');
    expect(await expenseRow(p.expenseIds[0] as string)).toMatchObject({
      status: 'approved',
      paidOn: null,
      paymentReference: null,
      settledBy: null,
    });
    expect((await advanceRow(must(p.advance, 'advance').id)).status).toBe('open');
    const amended = await f.act<Row & { id: string; amendedFrom: string }>(
      f.settler.params,
      'expense_settlement.amend',
      {
        id: p.id,
      },
    );
    expect(amended.amendedFrom).toBe(p.id);
    const copy = await f.getSettlement(amended.id);
    expect(copy.lines.expense_settlement_line.map((l) => [l.expenseId, l.amount, l.invoiceKind, l.payeeName])).toEqual([
      [p.expenseIds[0], '3300', 'small_amount', 'テスト交通'],
    ]);
    const again = await f.submit(amended.id);
    expect(again.number).toBe(`${s.number}-1`);
    const next = await settlementRow(amended.id);
    expect(next.journalEntryId).not.toBe(row.journalEntryId);
    expect(next.paymentId).not.toBe(row.paymentId);
    expect((await expenseRow(p.expenseIds[0] as string)).paymentReference).toBe(`${s.number}-1`);
    expect((await advanceRow(must(p.advance, 'advance').id)).status).toBe('settled');
  });
  it('AC-11 a settlement of a closed period is cancelled on a correction date in an open period', async () => {
    const w = await f.worker();
    const p = await prepared(
      { ...simple(), date: '2026-09-30', receipts: [{ ...must(simple().receipts[0]), expenseDate: '2026-09-29' }] },
      w,
    );
    await f.submit(p.id);
    const september = await f.run(
      {},
      async (ctx) => (await repo(ctx, FiscalPeriod).list({ where: { code: '2026-09' } })).items[0],
    );
    await f.act({}, 'accounting.close_period', { periodId: must(september, 'period 2026-09').id });
    try {
      expect(await caught(f.cancel(p.id))).toMatchObject({ code: 'INVALID_STATE' });
      expect((await settlementRow(p.id)).docstatus).toBe(DOCSTATUS.submitted);
      expect((await f.cancel(p.id, '2026-10-01')).docstatus).toBe(DOCSTATUS.cancelled);
    } finally {
      await f.act({}, 'accounting.reopen_period', { periodId: must(september, 'period 2026-09').id });
    }
  });
  it('AC-11 a bank-reconciled payment refuses the cancel and nothing changes', async () => {
    const p = await prepared(simple());
    await f.submit(p.id);
    const before = await f.run({}, async (ctx) => repo(ctx, JournalEntry).count({ reversalOf: { $ne: null } }));
    inject.paymentCancel = true;
    try {
      expect(await caught(f.cancel(p.id))).toMatchObject({ code: 'INVALID_STATE' });
    } finally {
      inject.paymentCancel = false;
    }
    expect((await settlementRow(p.id)).docstatus).toBe(DOCSTATUS.submitted);
    expect((await expenseRow(p.expenseIds[0] as string)).status).toBe('settled');
    expect(await f.run({}, async (ctx) => repo(ctx, JournalEntry).count({ reversalOf: { $ne: null } }))).toBe(before);
  });
  it('AC-12 the payment and the advance of a submitted settlement cannot be cancelled on their own', async () => {
    const w = await f.worker();
    const p = await prepared(simple('advance', '1100', '5000'), w);
    await f.submit(p.id);
    const row = await settlementRow(p.id);
    expect(await caught(f.act(f.settler.params, 'payment.cancel', { id: row.paymentId }))).toMatchObject({
      code: 'HAS_DEPENDENTS',
    });
    expect(
      await caught(f.act(f.settler.params, 'expense_advance.cancel', { id: must(p.advance, 'advance').id })),
    ).toMatchObject({
      code: 'HAS_DEPENDENTS',
    });
    expect(
      await caught(f.act(f.settler.params, 'payment.cancel', { id: must(p.advance, 'advance').paymentId })),
    ).toMatchObject({
      code: 'HAS_DEPENDENTS',
    });
    await f.cancel(p.id);
    expect((await f.act<Row>(f.settler.params, 'payment.get', { id: row.paymentId })).docstatus).toBe(
      DOCSTATUS.cancelled,
    );
  });
});
