import { Decimal, DOCSTATUS, repo, type Context, type Infer } from '@daifuku/kernel';
import type { z } from 'zod';
import { SalesInvoice } from '@daifuku/mod-sales';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import { Partner } from '@daifuku/mod-partner';
import type { boardInput } from './contract.ts';
import { type TradeOrderDetail } from './contract.ts';
import type { TradeFulfillmentLine, TradeOrderLine } from './entities.ts';
import { TradeBilling, TradeFulfillment, TradeOrder } from './entities.ts';
import { result } from './internal.ts';
import { fulfillmentQuantities, orderQuantities } from './quantities.ts';
const zero = Decimal.zero();
function lineView(line: Infer<typeof TradeOrderLine> | Infer<typeof TradeFulfillmentLine>) {
  return {
    id: line.id,
    seq: line.seq,
    productId: line.productId,
    description: line.description,
    uomCode: line.uomCode ?? '',
    quantity: line.quantity.toString(),
    unitPrice: line.unitPrice.toString(),
    amount: line.amount.toString(),
    taxCategory: line.taxCategory,
  };
}
async function orderRow(ctx: Context, row: Infer<typeof TradeOrder>, q: Awaited<ReturnType<typeof orderQuantities>>) {
  const openLineCount = q.lines.filter((l) => l.quantity.gt(q.fulfilled.get(l.id) ?? zero)).length;
  const unbilledLineCount = q.lines.filter((l) =>
    (q.fulfilled.get(l.id) ?? zero).gt(q.billed.get(l.id) ?? zero),
  ).length;
  const status =
    row.docstatus === DOCSTATUS.cancelled
      ? 'cancelled'
      : row.docstatus === DOCSTATUS.draft
        ? 'draft'
        : row.closed
          ? 'closed'
          : openLineCount
            ? 'open'
            : 'fulfilled';
  return {
    ...result(row, TradeOrder),
    direction: row.direction,
    partnerId: row.partnerId,
    partner: row.partnerName ?? (await repo(ctx, Partner).get(row.partnerId)).name,
    date: row.date,
    requiredDate: row.requiredDate,
    total: row.total.toString(),
    status,
    openLineCount,
    unbilledLineCount,
    closedReason: row.closedReason,
  } as TradeOrderDetail['order'];
}
async function billingRow(ctx: Context, row: Infer<typeof TradeBilling>) {
  const entity = row.direction === 'sales' ? SalesInvoice : PurchaseInvoice;
  const invoiceId = row.salesInvoiceId ?? row.purchaseInvoiceId;
  const invoice = invoiceId ? await repo(ctx, entity).get(invoiceId) : null;
  return {
    ...result(row, TradeBilling),
    date: row.date,
    cancelledDate: row.cancelledDate,
    invoiceId,
    invoiceEntity: entity.name,
    invoiceNumber: invoice?.number ?? null,
    total: row.total.toString(),
  };
}
export async function orderDetail(
  ctx: Context,
  {
    orderId,
  }: {
    orderId: string;
  },
): Promise<TradeOrderDetail> {
  const row = await repo(ctx, TradeOrder).get(orderId);
  const q = await orderQuantities(ctx, orderId);
  const fulfillments: TradeOrderDetail['fulfillments'] = [];
  for (const f of q.fulfillments) {
    const fq = await fulfillmentQuantities(ctx, f.id);
    fulfillments.push({
      ...result(f, TradeFulfillment),
      date: f.date,
      cancelledDate: f.cancelledDate,
      warehouseId: f.warehouseId,
      warehouse: f.warehouseName ?? '',
      stockEntryId: f.stockEntryId,
      lines: fq.lines.map((l) => ({
        ...lineView(l),
        orderLineId: l.orderLineId,
        billedQuantity: (fq.billed.get(l.id) ?? zero).toString(),
        unbilledQuantity: l.quantity.minus(fq.billed.get(l.id) ?? zero).toString(),
      })),
      billings: await Promise.all(fq.billings.map((b) => billingRow(ctx, b))),
    });
  }
  return {
    order: await orderRow(ctx, row, q),
    lines: q.lines.map((l) => ({
      ...lineView(l),
      fulfilledQuantity: (q.fulfilled.get(l.id) ?? zero).toString(),
      billedQuantity: (q.billed.get(l.id) ?? zero).toString(),
      remainingQuantity: l.quantity.minus(q.fulfilled.get(l.id) ?? zero).toString(),
      unbilledQuantity: (q.fulfilled.get(l.id) ?? zero).minus(q.billed.get(l.id) ?? zero).toString(),
    })),
    fulfillments,
  };
}
export async function tradeBoard(ctx: Context, input: z.infer<typeof boardInput>) {
  const page = await repo(ctx, TradeOrder).list({
    where: {
      direction: input.direction,
      ...(input.partnerId ? { partnerId: input.partnerId } : {}),
      ...(input.status === 'open' ? { docstatus: DOCSTATUS.submitted } : {}),
    },
    orderBy: [
      { field: 'date', dir: 'desc' },
      { field: 'id', dir: 'asc' },
    ],
    limit: input.limit,
    offset: input.offset,
  });
  const rows = [];
  for (const order of page.items) rows.push(await orderRow(ctx, order, await orderQuantities(ctx, order.id)));
  return {
    rows,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    currency: 'JPY' as const,
  };
}
