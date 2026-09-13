import { Decimal, DOCSTATUS, type Context } from '@daifuku/kernel';
import { TradeBilling, TradeBillingLine, TradeFulfillment, TradeFulfillmentLine, TradeOrderLine } from './entities.ts';
import { all } from './internal.ts';
export async function fulfillmentQuantities(ctx: Context, fulfillmentId: string) {
  const lines = await all(ctx, TradeFulfillmentLine, {
    where: { fulfillmentId },
    orderBy: [{ field: 'seq', dir: 'asc' }],
  });
  const billings = await all(ctx, TradeBilling, {
    where: { fulfillmentId },
    orderBy: [{ field: 'createdAt', dir: 'asc' }],
  });
  const ids = billings.filter((b) => b.docstatus === DOCSTATUS.submitted).map((b) => b.id);
  const billed = new Map<string, Decimal>();
  if (ids.length)
    for (const line of await all(ctx, TradeBillingLine, { where: { billingId: { $in: ids } } }))
      billed.set(line.fulfillmentLineId, (billed.get(line.fulfillmentLineId) ?? Decimal.zero()).plus(line.quantity));
  return { lines, billings, billed };
}
export async function orderQuantities(ctx: Context, orderId: string) {
  const lines = await all(ctx, TradeOrderLine, { where: { orderId }, orderBy: [{ field: 'seq', dir: 'asc' }] });
  const fulfillments = await all(ctx, TradeFulfillment, {
    where: { orderId },
    orderBy: [{ field: 'createdAt', dir: 'asc' }],
  });
  const fulfilled = new Map<string, Decimal>();
  const billed = new Map<string, Decimal>();
  for (const fulfillment of fulfillments) {
    if (fulfillment.docstatus !== DOCSTATUS.submitted) continue;
    const q = await fulfillmentQuantities(ctx, fulfillment.id);
    for (const line of q.lines) {
      fulfilled.set(line.orderLineId, (fulfilled.get(line.orderLineId) ?? Decimal.zero()).plus(line.quantity));
      billed.set(
        line.orderLineId,
        (billed.get(line.orderLineId) ?? Decimal.zero()).plus(q.billed.get(line.id) ?? Decimal.zero()),
      );
    }
  }
  return {
    lines,
    fulfillments,
    fulfilled,
    billed,
  };
}
