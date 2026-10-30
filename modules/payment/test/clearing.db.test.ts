// Postgres tests of clearing payments (docs/specs/expense-settlement.md AC-14, D22, D23, ADR-0039): payments created by
// another module's document through createClearingPayment post their whole amount to a counter account (未払金 / 仮払金)
// instead of 前払金 / 前受金, carry no allocations, are not counted as unallocated, and cannot be amended here.
import {
  DOCSTATUS,
  defineWriteCapability,
  newId,
  registerCrudActions,
  repo,
  runAction,
  saveLines,
  withWriteCapability,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account, FiscalPeriod, JournalLine, openFiscalYear } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClearingPayment, Payment } from '../src/index.ts';

const FIXED_NOW = new Date('2026-09-10T03:00:00Z');
let db: TestDb;
let acc: Record<string, string>;
let codeOf: Map<string, string>;
let partnerId: string;
const accounting = { roles: ['accounting'], actor: { type: 'user' as const, id: newId() } };
const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) =>
  db.run({ now: () => FIXED_NOW, ...params }, fn);
const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
/** Test-only capability standing in for a misuse of the field that only createClearingPayment may write. */
const MISUSE = defineWriteCapability({
  name: 'test.payment.counter',
  entity: Payment.name,
  fields: ['counterAccountId'],
  operations: ['create', 'update'],
});

async function entryLines(entryId: string) {
  return run({}, async (ctx) =>
    (
      await repo(ctx, JournalLine).list({ where: { entryId }, orderBy: [{ field: 'seq', dir: 'asc' }], limit: 50 })
    ).items.map((l) => [codeOf.get(l.accountId), l.debit.toString(), l.credit.toString(), l.partnerId, l.memo]),
  );
}
const clearing = (over: Record<string, unknown> = {}) =>
  run(accounting, (ctx) =>
    createClearingPayment(ctx, {
      direction: 'pay',
      partnerId,
      date: '2026-09-05',
      amount: '4930',
      method: 'bank_transfer',
      counterAccountId: acc['2150'] as string,
      note: '経費精算 EXP-2026-00001',
      ...over,
    } as never),
  );

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await run({}, (ctx) => openFiscalYear(ctx, { startDate: '2026-01-01' }));
  acc = {};
  const accounts: [string, string, 'asset' | 'liability' | 'expense', Record<string, unknown>][] = [
    ['1000', '現金', 'asset', {}],
    ['1100', '普通預金', 'asset', {}],
    ['1300', '売掛金', 'asset', { partnerRequired: true }],
    ['1500', '仮払消費税', 'asset', { taxRole: 'input_tax' }],
    ['1800', '仮払金', 'asset', {}],
    ['1900', '前払金', 'asset', {}],
    ['2100', '買掛金', 'liability', { partnerRequired: true }],
    ['2150', '未払金', 'liability', {}],
    ['2400', '前受金', 'liability', {}],
    ['6900', '雑費', 'expense', {}],
  ];
  await run({}, async (ctx) => {
    for (const [code, name, type, extra] of accounts)
      acc[code] = (await repo(ctx, Account).create({ code, name, type, ...extra } as never)).id;
    partnerId = (await repo(ctx, Partner).create({ code: 'E-1', name: '従業員 一郎', isSupplier: true })).id;
  });
  codeOf = new Map(Object.entries(acc).map(([code, id]) => [id, code]));
});
afterAll(async () => {
  await db?.close();
});

describe('clearing payments (AC-14)', () => {
  it('AC-14 counterAccountId is server-owned on generic create and update', async () => {
    expect(
      await caught(
        run(accounting, (ctx) =>
          runAction(ctx, 'payment.create', {
            direction: 'pay',
            partnerId,
            amount: '100',
            counterAccountId: acc['2150'],
          }),
        ),
      ),
    ).toMatchObject({ code: 'PERMISSION_DENIED' });
    const draft = (await run(accounting, (ctx) =>
      runAction(ctx, 'payment.create', { direction: 'pay', partnerId, amount: '100' }),
    )) as { id: string; version: number };
    expect(
      await caught(
        run(accounting, (ctx) =>
          runAction(ctx, 'payment.update', { id: draft.id, patch: { counterAccountId: acc['2150'] } }),
        ),
      ),
    ).toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('AC-14 D22 posts Dr counter / Cr cash with the partner, allocated = unallocated = 0, and is not counted as unallocated', async () => {
    const todoBefore = (await run(accounting, (ctx) => runAction(ctx, 'payment.todo', {}))) as {
      items: { key: string; count: number }[];
    };
    const p = await clearing();
    expect(p).toMatchObject({ docstatus: DOCSTATUS.submitted, direction: 'pay', note: '経費精算 EXP-2026-00001' });
    expect([p.allocatedAmount.toString(), p.unallocatedAmount.toString(), codeOf.get(p.accountId)]).toEqual([
      '0',
      '0',
      '1100',
    ]);
    expect(await entryLines(p.journalEntryId as string)).toEqual([
      ['2150', '4930', '0', partnerId, '精算'],
      ['1100', '0', '4930', partnerId, '支払'],
    ]);
    const refund = await clearing({ direction: 'receive', amount: '700', counterAccountId: acc['1800'] });
    expect(await entryLines(refund.journalEntryId as string)).toEqual([
      ['1100', '700', '0', partnerId, '入金'],
      ['1800', '0', '700', partnerId, '精算'],
    ]);
    // control: one ordinary payment with an unallocated amount in the same period is counted, the clearing ones are not
    const ordinary = (await run(accounting, (ctx) =>
      runAction(ctx, 'payment.create', { direction: 'pay', partnerId, amount: '90', date: '2026-09-06' }),
    )) as { id: string };
    await run(accounting, (ctx) => runAction(ctx, 'payment.submit', { id: ordinary.id }));
    const todo = (await run(accounting, (ctx) => runAction(ctx, 'payment.todo', {}))) as typeof todoBefore;
    const unallocated = (t: typeof todo) => t.items.find((i) => i.key === 'unallocated_payments')?.count ?? 0;
    expect(unallocated(todo)).toBe(unallocated(todoBefore) + 1);
    const september = await run(
      {},
      async (ctx) => (await repo(ctx, FiscalPeriod).list({ where: { code: '2026-09' } })).items[0],
    );
    const readiness = (await run(accounting, (ctx) =>
      runAction(ctx, 'accounting.close_readiness', { periodId: september?.id }),
    )) as { items: { id: string; count: number }[] };
    expect(readiness.items.find((i) => i.id === 'unallocated_payments')?.count).toBe(1);
  });
  it('AC-14 refuses a counter account that is not an asset/liability, has a tax role, is the cash account or is unknown', async () => {
    for (const counter of [acc['6900'], acc['1500'], acc['1100'], newId()])
      expect(await caught(clearing({ counterAccountId: counter }))).toMatchObject({ code: 'VALIDATION' });
    expect(await caught(clearing({ counterAccountId: acc['2150'], accountId: acc['2150'] }))).toMatchObject({
      code: 'VALIDATION',
    });
  });
  it('AC-14 the direction rule still applies: a purchasing context cannot create a clearing receipt', async () => {
    const purchasing = { roles: ['purchasing'], actor: { type: 'user' as const, id: newId() } };
    expect(
      await caught(
        run(purchasing, (ctx) =>
          createClearingPayment(ctx, {
            direction: 'receive',
            partnerId,
            date: '2026-09-05',
            amount: '100',
            method: 'bank_transfer',
            counterAccountId: acc['1800'] as string,
          }),
        ),
      ),
    ).toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('AC-14 a clearing payment refuses allocation lines (the line hook; submit re-checks as a second guard)', async () => {
    const invoiceId = newId();
    const e = await caught(
      run(accounting, async (ctx) => {
        const draft = await withWriteCapability(ctx, MISUSE, (w) =>
          repo(w, Payment).create({
            direction: 'pay',
            partnerId,
            amount: '100',
            counterAccountId: acc['2150'],
          } as never),
        );
        expect(draft.unallocatedAmount.toString()).toBe('0');
        return saveLines(ctx, Payment, draft.id, {
          payment_allocation: [{ invoiceEntity: 'purchase_invoice', invoiceId, amount: '100' }],
        });
      }),
    );
    expect(e).toMatchObject({ code: 'VALIDATION' });
    expect((e as { details: { issues: { path: string }[] } }).details.issues[0]?.path).toBe('invoiceId');
  });
  it('AC-14 D23 a draft amended from a clearing payment cannot be updated or submitted, and posts no 前払金', async () => {
    const advanceLines = () => run({}, (ctx) => repo(ctx, JournalLine).count({ accountId: acc['1900'] as string }));
    const before = await advanceLines();
    const p = await clearing({ amount: '300' });
    await run(accounting, (ctx) => runAction(ctx, 'payment.cancel', { id: p.id }));
    const amended = (await run(accounting, (ctx) => runAction(ctx, 'payment.amend', { id: p.id }))) as {
      id: string;
      counterAccountId: string | null;
      unallocatedAmount: string;
    };
    expect(amended.counterAccountId).toBeNull();
    expect(
      await caught(
        run(accounting, (ctx) => runAction(ctx, 'payment.update', { id: amended.id, patch: { note: 'x' } })),
      ),
    ).toMatchObject({ code: 'INVALID_STATE' });
    expect(await caught(run(accounting, (ctx) => runAction(ctx, 'payment.submit', { id: amended.id })))).toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(await advanceLines()).toBe(before);
  });
  it('AC-14 an ordinary payment still posts its unallocated amount to 前払金 (unchanged)', async () => {
    const draft = (await run(accounting, (ctx) =>
      runAction(ctx, 'payment.create', { direction: 'pay', partnerId, amount: '250', date: '2026-09-05' }),
    )) as { id: string };
    const s = (await run(accounting, (ctx) => runAction(ctx, 'payment.submit', { id: draft.id }))) as {
      journalEntryId: string;
      unallocatedAmount: string;
      counterAccountId: string | null;
    };
    expect([s.unallocatedAmount, s.counterAccountId]).toEqual(['250', null]);
    expect((await entryLines(s.journalEntryId)).map((l) => l[0])).toEqual(['1900', '1100']);
  });
});
