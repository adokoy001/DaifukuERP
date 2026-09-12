// Pure services of the inventory module: the moving-average engine (AC-3/AC-4, golden AC-11, fast-check properties AC-10),
// the stock entry rules (AC-2/AC-9) and the invoice / count mappings (AC-5/AC-6). No DB.
import { Decimal, StateError, ValidationError } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { entryIssues, headIssues, lineDirection, lineIssues, needsUnitCost, roleAllowsEntry, tryDecimal, type EntryLineInput } from '../src/services/entry-rules.ts';
import { adjustmentLinesFromCount, issueLinesFromSales, netUnitPrice, ratesFromTaxSummary, receiptLinesFromPurchase, stockLines, type InvoiceLineLike } from '../src/services/from-invoice.ts';
import { emptyState, fitsScale, inbound, outbound, replay, round6, type Movement, type StockState, type Step } from '../src/services/moving-average.ts';
import { golden, type GoldenStep } from './golden.ts';

const d = (s: string) => Decimal.from(s);
const view = (m: Movement) => ({ qtyDelta: m.qtyDelta.toString(), costDelta: m.costDelta.toString(), unitCost: m.unitCost.toString(), balanceQty: m.after.qty.toString(), balanceCost: m.after.value.toString() });

function stepOf(s: GoldenStep): Step {
  switch (s.op) {
    case 'receipt':
      return { op: 'in', qty: d(s.qty), cost: { unitCost: d(s.unitCost) } };
    case 'issue':
      return { op: 'out', qty: d(s.qty), cost: { mode: 'average' } };
    case 'reverse_receipt':
      return { op: 'out', qty: d(s.qty), cost: { mode: 'cost', totalCost: d(s.totalCost) } };
    case 'reverse_issue':
      return { op: 'in', qty: d(s.qty), cost: { totalCost: d(s.totalCost) } };
  }
}

describe('moving average golden (AC-11, test/golden/moving-average.json)', () => {
  for (const scenario of golden.scenarios) {
    it(`AC-11 ${scenario.name}`, () => {
      const movements = replay(scenario.steps.map(stepOf));
      expect(movements.map(view)).toEqual(scenario.steps.map((s) => s.expect));
      expect(Decimal.sum(movements.map((m) => m.costDelta)).toString()).toBe(scenario.steps.at(-1)?.expect.balanceCost);
      if (!scenario.allowNegative) expect(movements.every((m) => !m.after.qty.isNegative())).toBe(true);
    });
  }

  it('AC-11 the spec example ends at average 115, not 120: (15 × 110 + 5 × 130) / 20 = 2,300 / 20', () => {
    const [, , , fourth] = replay(golden.scenarios[0]?.steps.map(stepOf) ?? []);
    expect(fourth?.unitCost.toString()).toBe('115');
    expect(d('15').times('110').plus(d('5').times('130')).div('20').toString()).toBe('115');
  });
});

describe('moving average rules (AC-3, AC-4)', () => {
  it('AC-3 receipt: newAvg = (value + inQty × inCost) / (qty + inQty), 6 decimals; costDelta = inQty × inCost', () => {
    const m = inbound({ qty: d('3'), value: d('100'), avgCost: d('33.333333') }, d('1'), { unitCost: d('50') });
    expect(view(m)).toEqual({ qtyDelta: '1', costDelta: '50', unitCost: '37.5', balanceQty: '4', balanceCost: '150' });
    expect(round6(d('2').div('3')).toString()).toBe('0.666667');
  });

  it('AC-3 issue: costDelta = −outQty × avg, avg unchanged; never more than the remaining value; the last unit takes the rest', () => {
    const s: StockState = { qty: d('3'), value: d('100'), avgCost: d('33.333333') };
    expect(view(outbound(s, d('1'), { mode: 'average' }))).toEqual({ qtyDelta: '-1', costDelta: '-33.333333', unitCost: '33.333333', balanceQty: '2', balanceCost: '66.666667' });
    expect(view(outbound(s, d('3'), { mode: 'average' }))).toEqual({ qtyDelta: '-3', costDelta: '-100', unitCost: '33.333333', balanceQty: '0', balanceCost: '0' });
    // the rounded average would take round6(1.9 × 0.000002) = 0.000004 of a 0.000003 value: capped at the value
    const tiny: StockState = { qty: d('2'), value: d('0.000003'), avgCost: d('0.000002') };
    expect(view(outbound(tiny, d('1.9'), { mode: 'average' }))).toEqual({ qtyDelta: '-1.9', costDelta: '-0.000003', unitCost: '0.000002', balanceQty: '0.1', balanceCost: '0' });
  });

  it('AC-3 negative stock: frozen average while below zero; a receipt that closes the gap re-bases at its unit cost', () => {
    const neg = outbound({ qty: d('2'), value: d('200'), avgCost: d('100') }, d('5'), { mode: 'average' });
    expect(view(neg)).toEqual({ qtyDelta: '-5', costDelta: '-500', unitCost: '100', balanceQty: '-3', balanceCost: '-300' });
    expect(view(outbound(neg.after, d('1'), { mode: 'average' }))).toEqual({ qtyDelta: '-1', costDelta: '-100', unitCost: '100', balanceQty: '-4', balanceCost: '-400' });
    expect(view(inbound(neg.after, d('1'), { unitCost: d('130') }))).toEqual({ qtyDelta: '1', costDelta: '100', unitCost: '100', balanceQty: '-2', balanceCost: '-200' });
    expect(view(inbound(neg.after, d('3'), { unitCost: d('130') }))).toEqual({ qtyDelta: '3', costDelta: '300', unitCost: '100', balanceQty: '0', balanceCost: '0' });
    // never received: an issue at average 0 costs nothing (plain zero, not −0)
    const fromNothing = outbound(emptyState(), d('2'), { mode: 'average' });
    expect(view(fromNothing)).toEqual({ qtyDelta: '-2', costDelta: '0', unitCost: '0', balanceQty: '-2', balanceCost: '0' });
    expect(fromNothing.after.value.isNegative()).toBe(false);
  });

  it('AC-4 reversal of an inbound row takes back its cost and recomputes the average; of an outbound row returns its cost', () => {
    const s: StockState = { qty: d('15'), value: d('1650'), avgCost: d('110') };
    expect(view(outbound(s, d('10'), { mode: 'cost', totalCost: d('1200') }))).toEqual({ qtyDelta: '-10', costDelta: '-1200', unitCost: '90', balanceQty: '5', balanceCost: '450' });
    expect(view(inbound(s, d('5'), { totalCost: d('550') }))).toEqual({ qtyDelta: '5', costDelta: '550', unitCost: '110', balanceQty: '20', balanceCost: '2200' });
  });

  it('refuses non-positive quantities and negative costs (VALIDATION)', () => {
    expect(() => inbound(emptyState(), d('0'), { unitCost: d('1') })).toThrow(ValidationError);
    expect(() => outbound(emptyState(), d('-1'), { mode: 'average' })).toThrow(ValidationError);
    expect(() => inbound(emptyState(), d('1'), { unitCost: d('-0.01') })).toThrow(ValidationError);
    expect(() => inbound(emptyState(), d('1'), { totalCost: d('-1') })).toThrow(ValidationError);
    expect(fitsScale(d('1.123456'))).toBe(true);
    expect(fitsScale(d('1.1234567'))).toBe(false);
  });
});

// ---- properties (AC-10) -------------------------------------------------------------------------------------------

const qtyArb = fc.integer({ min: 1, max: 5_000_000 }).map((n) => Decimal.from(n).div(1000)); // 0.001 .. 5000
const costArb = fc.integer({ min: 0, max: 10_000_000 }).map((n) => Decimal.from(n).div(100)); // 0 .. 100000.00
const opArb = fc.oneof(
  fc.record({ kind: fc.constant('in' as const), qty: qtyArb, unitCost: costArb }),
  fc.record({ kind: fc.constant('out' as const), qty: qtyArb, unitCost: fc.constant(Decimal.zero()) }),
);

function assertInvariants(state: StockState, sumDelta: Decimal): void {
  expect(state.value.eq(sumDelta)).toBe(true);
  expect(state.avgCost.isNegative()).toBe(false);
  if (state.qty.isZero()) expect(state.value.isZero()).toBe(true);
  if (state.qty.gt(0)) expect(state.value.isNegative()).toBe(false);
  if (state.qty.isNegative()) expect(state.value.eq(round6(state.qty.times(state.avgCost)))).toBe(true);
}

describe('moving average properties (AC-10)', () => {
  it('AC-10 without negative stock: value == Σ costDelta, avgCost ≥ 0, qty ≥ 0, qty 0 ⇒ value 0; LIFO reversal restores every state', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        let state = emptyState();
        let sum = Decimal.zero();
        const history: { before: StockState; m: Movement }[] = [];
        for (const op of ops) {
          if (op.kind === 'out' && !state.qty.gt(0)) continue;
          const qty = op.kind === 'out' && op.qty.gt(state.qty) ? state.qty : op.qty; // never below zero
          const m = op.kind === 'in' ? inbound(state, qty, { unitCost: op.unitCost }) : outbound(state, qty, { mode: 'average' });
          history.push({ before: state, m });
          state = m.after;
          sum = sum.plus(m.costDelta);
          assertInvariants(state, sum);
          expect(state.qty.isNegative()).toBe(false);
        }
        for (const { before, m } of [...history].reverse()) {
          const r = m.qtyDelta.gt(0) ? outbound(state, m.qtyDelta, { mode: 'cost', totalCost: m.costDelta }) : inbound(state, m.qtyDelta.neg(), { totalCost: m.costDelta.neg() });
          state = r.after;
          sum = sum.plus(r.costDelta);
          assertInvariants(state, sum);
          expect([state.qty.toString(), state.value.toString()]).toEqual([before.qty.toString(), before.value.toString()]);
        }
        expect([state.qty.toString(), state.value.toString()]).toEqual(['0', '0']);
      }),
      { numRuns: 300 },
    );
  });

  it('AC-10 with negative stock allowed: value == Σ costDelta, avgCost never negative, qty 0 ⇒ value 0', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        let state = emptyState();
        let sum = Decimal.zero();
        for (const op of ops) {
          const m = op.kind === 'in' ? inbound(state, op.qty, { unitCost: op.unitCost }) : outbound(state, op.qty, { mode: 'average' });
          state = m.after;
          sum = sum.plus(m.costDelta);
          assertInvariants(state, sum);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('AC-10 receipts then a full issue leave qty 0 and value 0 (exactly, hence within 1e-6)', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ qty: qtyArb, unitCost: costArb }), { minLength: 1, maxLength: 20 }), (receipts) => {
        const steps: Step[] = receipts.map((r) => ({ op: 'in', qty: r.qty, cost: { unitCost: r.unitCost } }));
        const total = Decimal.sum(receipts.map((r) => r.qty));
        const movements = replay([...steps, { op: 'out', qty: total, cost: { mode: 'average' } }]);
        const last = movements.at(-1);
        expect(last?.after.qty.toString()).toBe('0');
        expect(last?.after.value.abs().lte('0.000001')).toBe(true);
        expect(last?.after.value.toString()).toBe('0');
        expect(Decimal.sum(movements.map((m) => m.costDelta)).toString()).toBe('0');
      }),
      { numRuns: 300 },
    );
  });
});

// ---- entry rules (AC-2, AC-9) -------------------------------------------------------------------------------------

const line = (over: Partial<EntryLineInput> = {}): EntryLineInput => ({ seq: 1, productId: 'p1', quantity: d('2'), sign: null, unitCost: d('100'), ...over });
const goods = new Map([['p1', 'goods' as const], ['svc', 'service' as const]]);
const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe('stock entry rules (AC-2, AC-9)', () => {
  it('AC-2 direction and unit cost by type / sign', () => {
    expect([lineDirection('receipt', null), lineDirection('issue', null), lineDirection('transfer', null), lineDirection('adjustment', 'in'), lineDirection('adjustment', 'out'), lineDirection('adjustment', null)]).toEqual(['in', 'out', 'transfer', 'in', 'out', null]);
    expect([needsUnitCost('receipt', null), needsUnitCost('issue', null), needsUnitCost('transfer', null), needsUnitCost('adjustment', 'in'), needsUnitCost('adjustment', 'out')]).toEqual([true, false, false, true, false]);
  });

  it('AC-2 header: warehouse required; transfer needs a different destination; others must not have one', () => {
    expect(headIssues({ type: 'receipt', warehouseId: 'w1', toWarehouseId: null })).toEqual([]);
    expect(paths(headIssues({ type: 'receipt', warehouseId: null, toWarehouseId: 'w2' }))).toEqual(['warehouseId', 'toWarehouseId']);
    expect(headIssues({ type: 'transfer', warehouseId: 'w1', toWarehouseId: null })).toEqual([{ path: 'toWarehouseId', message: 'required for a transfer' }]);
    expect(headIssues({ type: 'transfer', warehouseId: 'w1', toWarehouseId: 'w1' })).toEqual([{ path: 'toWarehouseId', message: 'must differ from warehouseId' }]);
    expect(headIssues({ type: 'transfer', warehouseId: 'w1', toWarehouseId: 'w2' })).toEqual([]);
  });

  it('AC-2 lines: goods only, quantity > 0 with ≤ 6 decimals, sign only on adjustments, unit cost on inbound lines', () => {
    expect(lineIssues('receipt', line(), 'goods')).toEqual([]);
    expect(lineIssues('receipt', line({ productId: 'svc' }), 'service')).toEqual([{ path: 'lines.1.productId', message: 'a service product has no stock; use a goods product' }]);
    expect(paths(lineIssues('receipt', line(), undefined))).toEqual(['lines.1.productId']);
    expect(paths(lineIssues('issue', line({ quantity: d('0'), unitCost: null }), 'goods'))).toEqual(['lines.1.quantity']);
    expect(paths(lineIssues('issue', line({ quantity: d('0.0000001'), unitCost: null }), 'goods'))).toEqual(['lines.1.quantity']);
    expect(paths(lineIssues('receipt', line({ unitCost: null }), 'goods', ''))).toEqual(['unitCost']);
    expect(paths(lineIssues('receipt', line({ unitCost: d('-1') }), 'goods'))).toEqual(['lines.1.unitCost']);
    expect(paths(lineIssues('receipt', line({ sign: 'in' }), 'goods'))).toEqual(['lines.1.sign']);
    expect(paths(lineIssues('adjustment', line({ sign: null, unitCost: null }), 'goods'))).toEqual(['lines.1.sign']);
    expect(lineIssues('adjustment', line({ sign: 'out', unitCost: null }), 'goods')).toEqual([]);
    expect(paths(lineIssues('adjustment', line({ sign: 'in', unitCost: null }), 'goods'))).toEqual(['lines.1.unitCost']);
    expect(lineIssues('transfer', line({ unitCost: null }), 'goods')).toEqual([]);
    expect(paths(entryIssues({ type: 'issue', warehouseId: 'w1', toWarehouseId: null }, [], goods))).toEqual(['lines']);
    expect(paths(entryIssues({ type: 'issue', warehouseId: 'w1', toWarehouseId: null }, [line({ unitCost: null }), line({ seq: 2, productId: 'svc', unitCost: null })], goods))).toEqual(['lines.2.productId']);
  });

  it('AC-9 roles: inventory/admin any type, purchasing receipts, sales only through the module', () => {
    for (const type of ['receipt', 'issue', 'transfer', 'adjustment'] as const) {
      expect(roleAllowsEntry(['inventory'], type, false)).toBe(true);
      expect(roleAllowsEntry(['admin'], type, false)).toBe(true);
      expect(roleAllowsEntry(['purchasing'], type, false)).toBe(type === 'receipt');
      expect(roleAllowsEntry(['sales'], type, false)).toBe(false);
      expect(roleAllowsEntry(['sales'], type, true)).toBe(true);
      expect(roleAllowsEntry(['viewer', 'accounting'], type, false)).toBe(false);
    }
    expect([tryDecimal('1.5')?.toString(), tryDecimal(3)?.toString(), tryDecimal('x'), tryDecimal(1.5)]).toEqual(['1.5', '3', null, null]);
  });
});

// ---- invoice / count mappings (AC-5, AC-6) ------------------------------------------------------------------------

const invLine = (over: Partial<InvoiceLineLike> = {}): InvoiceLineLike => ({ seq: 1, productId: 'p1', quantity: d('10'), unitPrice: d('1100'), taxCategory: 'standard', ...over });
const kinds = new Map([['p1', 'goods' as const], ['p2', 'goods' as const], ['svc', 'service' as const]]);

describe('invoice and count mappings (AC-5, AC-6)', () => {
  it('AC-5 only goods lines with a positive quantity and a non-negative price move stock (services, expense lines, returns, discounts are skipped)', () => {
    const lines = [invLine(), invLine({ seq: 2, productId: 'svc' }), invLine({ seq: 3, productId: null }), invLine({ seq: 4, quantity: d('-1') }), invLine({ seq: 5, productId: 'unknown' }), invLine({ seq: 6, productId: 'p2' })];
    expect(stockLines(lines, kinds).map((l) => l.seq)).toEqual([1, 6]);
    expect(stockLines([invLine({ unitPrice: d('-100') }), invLine({ seq: 2, quantity: d('0') }), invLine({ seq: 3, unitPrice: d('0') })], kinds).map((l) => l.seq)).toEqual([3]);
    expect(issueLinesFromSales(lines, kinds)).toEqual([{ productId: 'p1', quantity: '10' }, { productId: 'p2', quantity: '10' }]);
    expect(issueLinesFromSales([invLine({ productId: 'svc' })], kinds)).toEqual([]);
  });

  it('AC-5 receipt unit cost = 税抜 unit price: as is when prices exclude tax, ÷ (1 + rate) to 6 decimals when they include it', () => {
    expect(netUnitPrice(d('1100'), d('0.1'), false).toString()).toBe('1100');
    expect(netUnitPrice(d('1100'), d('0.1'), true).toString()).toBe('1000');
    expect(netUnitPrice(d('1000'), d('0.08'), true).toString()).toBe('925.925926');
    expect(netUnitPrice(d('500'), d('0'), true).toString()).toBe('500');
    const rates = ratesFromTaxSummary({ creditRatio: '1', groups: [{ category: 'standard', rate: '0.1' }, { category: 'reduced', rate: '0.08' }, { category: 'bad', rate: 0.1 }] });
    expect([...rates.entries()].map(([k, v]) => [k, v.toString()])).toEqual([['standard', '0.1'], ['reduced', '0.08']]);
    expect([...ratesFromTaxSummary([{ category: 'exempt', rate: '0' }]).keys()]).toEqual(['exempt']);
    expect(ratesFromTaxSummary(null).size).toBe(0);
    const lines = [invLine(), invLine({ seq: 2, productId: 'p2', quantity: d('3'), unitPrice: d('1000'), taxCategory: 'reduced' }), invLine({ seq: 3, productId: 'svc' })];
    expect(receiptLinesFromPurchase(lines, kinds, { priceIncludesTax: true, rates })).toEqual([
      { productId: 'p1', quantity: '10', unitCost: '1000' },
      { productId: 'p2', quantity: '3', unitCost: '925.925926' },
    ]);
    expect(receiptLinesFromPurchase(lines, kinds, { priceIncludesTax: false, rates })[0]).toEqual({ productId: 'p1', quantity: '10', unitCost: '1100' });
    expect(() => receiptLinesFromPurchase([invLine({ taxCategory: 'exempt' })], kinds, { priceIncludesTax: true, rates })).toThrow(StateError);
  });

  it('AC-6 count adjustments: one line per non-zero variance, in at the current average, out without a cost', () => {
    const avg = (id: string) => (id === 'p1' ? d('110') : d('0'));
    expect(adjustmentLinesFromCount([{ productId: 'p1', varianceQty: d('-2') }, { productId: 'p2', varianceQty: d('0') }, { productId: 'p1', varianceQty: d('1.5') }], avg)).toEqual([
      { productId: 'p1', quantity: '2', sign: 'out' },
      { productId: 'p1', quantity: '1.5', sign: 'in', unitCost: '110' },
    ]);
  });
});
