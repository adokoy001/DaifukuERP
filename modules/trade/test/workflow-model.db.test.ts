import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@daifuku/kernel';
import type { TradeOrderDetail } from '../src/index.ts';
import { DAY, quantity, required, tradeModelFixture, type TradeFixture } from './model-fixture.ts';
type Kind = 'fulfill' | 'bill' | 'cancelBill' | 'cancelFulfillment' | 'retryFulfill' | 'retryBill' | 'close';
type Op = { kind: Kind; quarters: number; pick: number };
type Bill = { id: string; quantity: number; active: boolean; input: unknown };
type Fulfillment = { id: string; quantity: number; active: boolean; input: unknown; bills: Bill[] };
type Model = { side: number; movements: { quarters: number; reverse: boolean }[]; ordered: number; closed: boolean; fulfillments: Fulfillment[]; success: number; rejected: number; retries: number };
let f: TradeFixture;
beforeAll(async () => { f = await tradeModelFixture(); });
afterAll(async () => { await f.db.close(); });
const ops = fc.array(fc.record({ kind: fc.constantFrom<Kind>('fulfill', 'bill', 'cancelBill', 'cancelFulfillment', 'retryFulfill', 'retryBill', 'close'), quarters: fc.integer({ min: 1, max: 48 }), pick: fc.nat(8) }), { minLength: 3, maxLength: 10 });
const op = (kind: Kind, quarters = 4, pick = 0): Op => ({ kind, quarters, pick });
const totals = (m: Model) => ({ fulfilled: m.fulfillments.filter((v) => v.active).reduce((n, v) => n + v.quantity, 0), billed: m.fulfillments.flatMap((v) => v.bills).filter((v) => v.active).reduce((n, v) => n + v.quantity, 0) });
const pick = <T>(values: T[], n: number) => values.length ? values[n % values.length] : undefined;
async function verify(m: Model, order: Awaited<ReturnType<TradeFixture['order']>>) {
  const d = await f.detail(order.id), { fulfilled, billed } = totals(m), p = await f.projection(order);
  expect(billed).toBeGreaterThanOrEqual(0); expect(billed).toBeLessThanOrEqual(fulfilled); expect(fulfilled).toBeLessThanOrEqual(order.quarters);
  expect(d.lines[0]).toMatchObject({ fulfilledQuantity: quantity(fulfilled), billedQuantity: quantity(billed), remainingQuantity: quantity(order.quarters - fulfilled), unbilledQuantity: quantity(fulfilled - billed) });
  expect(d.order.status).toBe(m.closed ? 'closed' : fulfilled === order.quarters ? 'fulfilled' : 'open');
  const stockQuarters = order.direction === 'sales' ? 400 - fulfilled : fulfilled;
  expect(p.quantity).toBe(quantity(stockQuarters)); expect(p.cost).toBe(String(BigInt(stockQuarters) * 200n));
  const bills = m.fulfillments.flatMap((v) => v.bills);
  expect(p.journalLineCount).toBe(bills.reduce((n, v) => n + (v.active ? 1 : 2), 0));
  expect(p.net).toBe(String(BigInt(billed) * (order.direction === 'sales' ? 300n : 200n)));
  expect(p.movements).toEqual(m.movements.map((v) => ({ qty: quantity(v.quarters), cost: String(BigInt(v.quarters) * 200n), reverse: v.reverse })));
  expect(d.fulfillments).toHaveLength(m.fulfillments.length);
  for (const fm of m.fulfillments) {
    const actual = required(d.fulfillments.find((v) => v.id === fm.id));
    expect(actual.docstatus).toBe(fm.active ? 1 : 2); expect(actual.billings).toHaveLength(fm.bills.length);
    for (const bm of fm.bills) expect(actual.billings.find((v) => v.id === bm.id)?.docstatus).toBe(bm.active ? 1 : 2);
  }
}
async function attempt(m: Model, valid: boolean, name: string, input: unknown, update: (id: string) => void, code = 'INVALID_STATE') {
  if (valid) { const result = await f.action(name, input); update(result.id); m.success++; }
  else { await expect(f.action(name, input)).rejects.toMatchObject({ code }); m.rejected++; }
}
async function fulfill(m: Model, step: Op, d: TradeOrderDetail) {
  const input = { orderId: d.order.id, expectedVersion: d.order.version, date: DAY, warehouseId: f.warehouse, requestId: newId(), lines: [{ orderLineId: required(d.lines[0]).id, quantity: quantity(step.quarters) }] };
  const valid = !m.closed && totals(m).fulfilled + step.quarters <= m.ordered;
  await attempt(m, valid, 'trade.fulfill_order', input, (id) => { m.fulfillments.push({ id, quantity: step.quarters, active: true, input, bills: [] }); m.movements.push({ quarters: m.side * step.quarters, reverse: false }); });
}
async function bill(m: Model, step: Op, d: TradeOrderDetail) {
  const target = pick(m.fulfillments, step.pick), actual = d.fulfillments.find((v) => v.id === target?.id);
  const input = { fulfillmentId: target?.id ?? newId(), expectedVersion: actual?.version ?? 1, date: DAY, requestId: newId(), lines: [{ fulfillmentLineId: actual?.lines[0]?.id ?? newId(), quantity: quantity(step.quarters) }] };
  const used = target?.bills.filter((v) => v.active).reduce((n, v) => n + v.quantity, 0) ?? 0;
  await attempt(m, !!target?.active && used + step.quarters <= target.quantity, 'trade.bill_fulfillment', input, (id) => required(target).bills.push({ id, quantity: step.quarters, active: true, input }));
}
async function cancel(m: Model, step: Op, d: TradeOrderDetail) {
  if (step.kind === 'cancelBill') {
    const target = pick(m.fulfillments.flatMap((v) => v.bills), step.pick);
    const actual = d.fulfillments.flatMap((v) => v.billings).find((v) => v.id === target?.id);
    await attempt(m, !!target?.active, 'trade.cancel_billing', { billingId: target?.id ?? newId(), expectedVersion: actual?.version ?? 1, correctionDate: DAY, reason: 'Generated correction' }, () => { required(target).active = false; });
  } else {
    const target = pick(m.fulfillments, step.pick), actual = d.fulfillments.find((v) => v.id === target?.id);
    await attempt(m, !!target?.active && target.bills.every((v) => !v.active), 'trade.cancel_fulfillment', { fulfillmentId: target?.id ?? newId(), expectedVersion: actual?.version ?? 1, correctionDate: DAY, reason: 'Generated correction' }, () => { required(target).active = false; m.movements.push({ quarters: -m.side * required(target).quantity, reverse: true }); }, target?.active && target.bills.some((v) => v.active) ? 'HAS_DEPENDENTS' : 'INVALID_STATE');
  }
}
async function retry(m: Model, step: Op) {
  const target = step.kind === 'retryFulfill' ? pick(m.fulfillments, step.pick) : pick(m.fulfillments.flatMap((v) => v.bills), step.pick);
  // The deterministic prefix always establishes a target; no generated command is skipped.
  expect(target).toBeDefined();
  await attempt(m, required(target).active, step.kind === 'retryFulfill' ? 'trade.fulfill_order' : 'trade.bill_fulfillment', required(target).input, (id) => { expect(id).toBe(required(target).id); m.retries++; });
}
async function execute(m: Model, step: Op, order: Awaited<ReturnType<TradeFixture['order']>>) {
  const before = { detail: await f.detail(order.id), effects: await f.projection(order) }, rejected = m.rejected;
  switch (step.kind) {
    case 'fulfill': await fulfill(m, step, before.detail); break;
    case 'bill': await bill(m, step, before.detail); break;
    case 'cancelBill': case 'cancelFulfillment': await cancel(m, step, before.detail); break;
    case 'retryBill': case 'retryFulfill': await retry(m, step); break;
    case 'close': await attempt(m, !m.closed, 'trade.close_order', { orderId: order.id, expectedVersion: before.detail.order.version, reason: 'Generated close' }, () => { m.closed = true; });
  }
  if (m.rejected > rejected) expect({ detail: await f.detail(order.id), effects: await f.projection(order) }).toEqual(before);
  await verify(m, order);
}
describe('AC-2 / TRADE-QTY-01 generated operation traces', () => {
  it.each(['sales', 'purchase'] as const)('%s compares every transition, rejection and replay with an independent quantity/history model', async (direction) => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 12, max: 48 }), ops, async (quarters, tail) => {
      const order = await f.order(direction, quarters), model: Model = { side: direction === 'sales' ? -1 : 1, movements: direction === 'sales' ? [{ quarters: 400, reverse: false }] : [], ordered: quarters, closed: false, fulfillments: [], success: 0, rejected: 0, retries: 0 };
      const prefix = [op('fulfill', 8), op('retryFulfill'), op('bill'), op('retryBill'), op('fulfill', 49), op('cancelFulfillment'), op('cancelBill'), op('cancelFulfillment'), op('retryBill'), op('fulfill', 4, 1), op('bill', 4, 1)];
      for (const step of [...prefix, ...tail, op('close'), op('fulfill')]) await execute(model, step, order);
      expect(model.success).toBeGreaterThanOrEqual(9); expect(model.rejected).toBeGreaterThanOrEqual(3); expect(model.retries).toBeGreaterThanOrEqual(2);
    }), { seed: Number(process.env['PBT_SEED'] ?? 730202), numRuns: Number(process.env['PBT_RUNS'] ?? 6), ...(process.env['PBT_PATH'] ? { path: process.env['PBT_PATH'] } : {}) });
  }, 180_000);
});
