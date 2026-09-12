// Pure moving-average engine (移動平均法, docs/specs/inventory.md AC-3/AC-4; docs/domain/inventory.md). No DB.
//
// State per product × warehouse: qty, value, avgCost. `value` is the accumulator (every movement's costDelta is
// exactly value_after − value_before, so value = Σ costDelta always); avgCost is re-derived on inbound movements as
// round6(value / qty) — the statutory definition "数量及び取得価額を基礎として算出した平均単価によつて改定".
//   inbound  (qty ≥ 0 before): costDelta = cost (round6(inQty × inCost), or an explicit total), avg = round6(value / qty)
//   outbound 'average' (issue): costDelta = −min(value, round6(outQty × avg)); the last unit takes the remaining value
//            (qty 0 ⇒ value 0); avg unchanged
//   outbound 'cost' (reversal of an inbound row): the original cost is taken back and avg recomputed from what remains
// Negative stock (only when the caller allows it): while qty < 0 the value is round6(qty × avg) and avg is frozen; an
// inbound movement that brings qty back above 0 values the remaining quantity at the incoming unit cost.
// Invariants (test/moving-average.test.ts, property): value = Σ costDelta; avg ≥ 0; qty = 0 ⇒ value = 0; qty > 0 ⇒ value ≥ 0.
import { Decimal, ValidationError } from '@daifuku/kernel';

/** Decimal places kept for avgCost / costDelta / value (the column scale, numeric(20,6)). */
export const COST_SCALE = 6;

export interface StockState {
  qty: Decimal;
  value: Decimal;
  avgCost: Decimal;
}

export interface Movement {
  /** Signed quantity change. */
  qtyDelta: Decimal;
  /** Signed value change: after.value − before.value. */
  costDelta: Decimal;
  /** Moving average after the movement (the ledger's unitCost column). */
  unitCost: Decimal;
  after: StockState;
}

/** How an inbound movement is costed: a unit cost (receipts) or an exact total (transfer in, reversal of an outbound row). */
export type InboundCost = { unitCost: Decimal } | { totalCost: Decimal };
/** How an outbound movement is costed: at the moving average (issues) or taking back an exact total (reversal of an inbound row). */
export type OutboundCost = { mode: 'average' } | { mode: 'cost'; totalCost: Decimal };

export function round6(d: Decimal): Decimal {
  return d.roundHalfUp(COST_SCALE);
}

export function emptyState(): StockState {
  return { qty: Decimal.zero(), value: Decimal.zero(), avgCost: Decimal.zero() };
}

/** True when the decimal has at most `scale` fractional digits (numeric(20,6) would silently round more). */
export function fitsScale(d: Decimal, scale = COST_SCALE): boolean {
  return d.roundHalfUp(scale).eq(d);
}

function assertPositive(qty: Decimal, what: string): void {
  if (!qty.gt(0)) throw new ValidationError(`${what} quantity ${qty.toString()} must be greater than 0`, [{ path: 'quantity', message: 'must be > 0' }], 'Quantities are positive; the entry type (or line sign) gives the direction.');
}

function assertNonNegative(d: Decimal, path: string): void {
  if (d.lt(0)) throw new ValidationError(`${path} ${d.toString()} must not be negative`, [{ path, message: 'must be >= 0' }], 'Costs are never negative.');
}

function maxDecimal(a: Decimal, b: Decimal): Decimal {
  return a.gte(b) ? a : b;
}
function minDecimal(a: Decimal, b: Decimal): Decimal {
  return a.lte(b) ? a : b;
}

/** decimal.js keeps a sign on zero (−3 × 0 is −0, and −0 isNegative()); positive zero keeps branches and JSON plain. */
function plainZero(d: Decimal): Decimal {
  return d.isZero() ? Decimal.zero() : d;
}

function movement(before: StockState, next: StockState): Movement {
  const after = { qty: plainZero(next.qty), value: plainZero(next.value), avgCost: plainZero(next.avgCost) };
  return { qtyDelta: after.qty.minus(before.qty), costDelta: plainZero(after.value.minus(before.value)), unitCost: after.avgCost, after };
}

/** Receipt / adjustment in / transfer in / reversal of an outbound row. */
export function inbound(state: StockState, qty: Decimal, cost: InboundCost): Movement {
  assertPositive(qty, 'inbound');
  if ('unitCost' in cost) assertNonNegative(cost.unitCost, 'unitCost');
  const total = 'totalCost' in cost ? round6(cost.totalCost) : round6(qty.times(cost.unitCost));
  assertNonNegative(total, 'totalCost');
  const newQty = state.qty.plus(qty);
  if (!state.qty.lt(0)) {
    const value = state.value.plus(total);
    return movement(state, { qty: newQty, value, avgCost: round6(value.div(newQty)) });
  }
  // negative stock before: the hole is filled at the frozen average, the rest enters at the incoming unit cost
  const incomingUnit = 'unitCost' in cost ? round6(cost.unitCost) : round6(total.div(qty));
  if (newQty.gt(0)) return movement(state, { qty: newQty, value: round6(newQty.times(incomingUnit)), avgCost: incomingUnit });
  if (newQty.isZero()) return movement(state, { qty: newQty, value: Decimal.zero(), avgCost: state.avgCost });
  return movement(state, { qty: newQty, value: round6(newQty.times(state.avgCost)), avgCost: state.avgCost });
}

/** Issue / adjustment out / transfer out (mode 'average'), or reversal of an inbound row (mode 'cost'). */
export function outbound(state: StockState, qty: Decimal, cost: OutboundCost): Movement {
  assertPositive(qty, 'outbound');
  const newQty = state.qty.minus(qty);
  if (newQty.lt(0)) return movement(state, { qty: newQty, value: round6(newQty.times(state.avgCost)), avgCost: state.avgCost });
  if (newQty.isZero()) return movement(state, { qty: newQty, value: Decimal.zero(), avgCost: state.avgCost });
  // 0 < newQty < qty before
  const wanted = cost.mode === 'cost' ? round6(cost.totalCost) : round6(qty.times(state.avgCost));
  const take = minDecimal(state.value, maxDecimal(wanted, Decimal.zero()));
  const value = state.value.minus(take);
  const avgCost = cost.mode === 'cost' ? round6(value.div(newQty)) : state.avgCost;
  return movement(state, { qty: newQty, value, avgCost });
}

/** Replays a sequence of movements from an empty state (golden tests and property checks). */
export type Step = { op: 'in'; qty: Decimal; cost: InboundCost } | { op: 'out'; qty: Decimal; cost: OutboundCost };

export function replay(steps: readonly Step[], start: StockState = emptyState()): Movement[] {
  const out: Movement[] = [];
  let state = start;
  for (const s of steps) {
    const m = s.op === 'in' ? inbound(state, s.qty, s.cost) : outbound(state, s.qty, s.cost);
    out.push(m);
    state = m.after;
  }
  return out;
}
