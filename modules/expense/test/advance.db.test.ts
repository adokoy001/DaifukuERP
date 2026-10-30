// Postgres tests of the expense advance (docs/specs/expense-settlement.md AC-12, AC-13, D24): submit pays it out through
// payment createClearingPayment (Dr 仮払金 / Cr cash), cancel cancels that payment, and a submitted settlement that
// clears the advance protects both from being cancelled on their own.
import { DOCSTATUS, registry, repo, StateError, type HookFn } from '@daifuku/kernel';
import { JournalEntry } from '@daifuku/mod-accounting';
import { Payment } from '@daifuku/mod-payment';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpenseAdvance } from '../src/index.ts';
import { caught, fixture, type Fixture, type Row, type Worker } from './fixture.ts';

let f: Fixture;
const inject = { paymentCancel: false };
beforeAll(async () => {
  f = await fixture();
  const reconciled: HookFn = () => {
    if (inject.paymentCancel)
      throw new StateError('銀行照合を先に取り消してください。', 'test hook standing in for the banking guard');
  };
  registry.registerHook(Payment.name, 'before_cancel', reconciled);
});
afterAll(async () => {
  await f?.db.close();
});

type AdvanceJson = Row & {
  id: string;
  number: string | null;
  docstatus: number;
  status: string | null;
  paymentId: string | null;
};
const create = (w: Worker, over: Row = {}) =>
  f.act<AdvanceJson>(f.settler.params, 'expense_advance.create', {
    employeeId: w.employeeId,
    partnerId: f.partners.alice,
    date: '2026-10-01',
    amount: '30000',
    purpose: '大阪出張の仮払',
    ...over,
  });
const submit = (id: string) => f.act<AdvanceJson>(f.settler.params, 'expense_advance.submit', { id });
const advanceRow = (id: string) => f.run({}, (ctx) => repo(ctx, ExpenseAdvance).get(id));
const paymentRow = (id: string) => f.run({}, (ctx) => repo(ctx, Payment).get(id));

describe('expense advance (AC-13)', () => {
  it('AC-13 submit pays the advance out (Dr 仮払金 / Cr 普通預金, partner) and records the payment and status open', async () => {
    const w = await f.worker();
    const created = await create(w);
    expect(created).toMatchObject({
      siteId: f.siteA,
      userId: w.id,
      status: null,
      paymentId: null,
      method: 'bank_transfer',
    });
    const submitted = await submit(created.id);
    expect(submitted).toMatchObject({
      docstatus: DOCSTATUS.submitted,
      status: 'open',
      number: expect.stringMatching(/^ADV-2026-/),
    });
    const payment = await paymentRow(submitted.paymentId as string);
    expect({
      direction: payment.direction,
      amount: payment.amount.toString(),
      date: payment.date,
      partner: payment.partnerId,
      counter: f.codeOf.get(payment.counterAccountId ?? ''),
      account: f.codeOf.get(payment.accountId),
      docstatus: payment.docstatus,
      note: payment.note,
    }).toEqual({
      direction: 'pay',
      amount: '30000',
      date: '2026-10-01',
      partner: f.partners.alice,
      counter: '1800',
      account: '1100',
      docstatus: DOCSTATUS.submitted,
      note: `仮払 ${submitted.number} ${w.name}`,
    });
    expect(
      (await f.entryLines(payment.journalEntryId as string)).map((l) => [l.code, l.debit, l.credit, l.partnerId]),
    ).toEqual([
      ['1800', '30000', '0', f.partners.alice],
      ['1100', '0', '30000', f.partners.alice],
    ]);
  });
  it('AC-13 refuses a non-positive or fractional amount and a future payment date', async () => {
    const w = await f.worker();
    for (const amount of ['0', '-1', '100.5'])
      expect(await caught(create(w, { amount }))).toMatchObject({ code: 'VALIDATION' });
    const future = await create(w, { date: '2026-10-11' });
    expect(await caught(submit(future.id))).toMatchObject({ code: 'VALIDATION' });
    expect((await advanceRow(future.id)).docstatus).toBe(DOCSTATUS.draft);
  });
  it('AC-13 cancelling an open advance cancels its payment with the same correction date', async () => {
    const w = await f.worker();
    const s = await submit((await create(w)).id);
    const cancelled = await f.act<AdvanceJson>(f.settler.params, 'expense_advance.cancel', {
      id: s.id,
      correctionDate: '2026-10-09',
    });
    expect(cancelled).toMatchObject({ docstatus: DOCSTATUS.cancelled, status: 'cancelled' });
    const payment = await paymentRow(s.paymentId as string);
    expect(payment.docstatus).toBe(DOCSTATUS.cancelled);
    const reversal = await f.run(
      {},
      async (ctx) =>
        (await repo(ctx, JournalEntry).list({ where: { reversalOf: payment.journalEntryId as string } })).items,
    );
    expect(reversal.map((e) => e.date)).toEqual(['2026-10-09']);
  });
  it('AC-13 a bank-reconciled payout refuses the cancel and nothing changes', async () => {
    const w = await f.worker();
    const s = await submit((await create(w)).id);
    inject.paymentCancel = true;
    try {
      expect(await caught(f.act(f.settler.params, 'expense_advance.cancel', { id: s.id }))).toMatchObject({
        code: 'INVALID_STATE',
      });
    } finally {
      inject.paymentCancel = false;
    }
    expect(await advanceRow(s.id)).toMatchObject({ docstatus: DOCSTATUS.submitted, status: 'open' });
    expect((await paymentRow(s.paymentId as string)).docstatus).toBe(DOCSTATUS.submitted);
  });
});

describe('advance dependencies (AC-12, D24)', () => {
  it('AC-12 a settled advance and its payout cannot be cancelled until the settlement is cancelled', async () => {
    const w = await f.worker();
    const partnerId = await f.partner('E-D24', '従業員 D24');
    const adv = await submit((await create(w, { amount: '10000', partnerId })).id);
    const d = await f.draft({ employeeId: w.employeeId, kind: 'advance', advanceId: adv.id, date: '2026-10-08' });
    const s = await f.submit(d.id);
    expect((await advanceRow(adv.id)).status).toBe('settled');
    expect(await caught(f.act(f.settler.params, 'expense_advance.cancel', { id: adv.id }))).toMatchObject({
      code: 'HAS_DEPENDENTS',
    });
    expect(await caught(f.act(f.settler.params, 'payment.cancel', { id: adv.paymentId }))).toMatchObject({
      code: 'HAS_DEPENDENTS',
    });
    // D24: the unused advance came back in full (receive 10,000, Dr 普通預金 / Cr 仮払金) and 仮払金 nets to zero
    expect(await f.balance('1800', partnerId)).toBe('0');
    await f.cancel(s.id);
    expect((await advanceRow(adv.id)).status).toBe('open');
    const cancelled = await f.act<AdvanceJson>(f.settler.params, 'expense_advance.cancel', { id: adv.id });
    expect(cancelled.status).toBe('cancelled');
  });
});
