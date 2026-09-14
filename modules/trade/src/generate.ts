import {
  contentHash,
  DOCSTATUS,
  repo,
  saveLines,
  StateError,
  submitDocument,
  todayLocal,
  withLock,
  type Context,
  type Infer,
} from '@daifuku/kernel';
import type { z } from 'zod';
import { Warehouse } from '@daifuku/mod-inventory';
import type { billInput, convertInput, fulfillInput } from './contract.ts';
import {
  TradeBilling,
  TradeBillingLine,
  TradeFulfillment,
  TradeFulfillmentLine,
  TradeOrder,
  TradeOrderLine,
  TradeQuotation,
  TradeQuotationLine,
} from './entities.ts';
import { all, assertDirection, assertVersion, positiveQuantity, result, writeTrade } from './internal.ts';
import { fulfillmentQuantities, orderQuantities } from './quantities.ts';
type Line = Infer<typeof TradeOrderLine> | Infer<typeof TradeFulfillmentLine>;
export function copiedLine(line: Line, quantity: string) {
  return {
    productId: line.productId,
    description: line.description,
    uomId: line.uomId,
    uomCode: line.uomCode,
    unitPrice: line.unitPrice,
    quantity,
    amount: positiveQuantity(quantity).times(line.unitPrice),
    taxCategory: line.taxCategory,
    direction: line.direction,
  };
}
export function actualDate(ctx: Context, date: string, sourceDate: string) {
  if (date < sourceDate || date > todayLocal(ctx.now()))
    throw new StateError('日付が元文書より前、または未来です。', '元文書以降・本日以前の日付にしてください。');
}
function assertAfterCancellations(
  date: string,
  rows: {
    cancelledDate: string | null;
  }[],
) {
  if (rows.some((row) => row.cancelledDate && row.cancelledDate > date))
    throw new StateError('先行取消日より前には再計上できません。', '同じ元文書の取消有効日以降を指定してください。');
}
function unique(ids: string[]) {
  if (new Set(ids).size !== ids.length)
    throw new StateError('同じ明細が重複しています。', '明細は1回ずつ指定してください。');
}
export async function convertQuotation(ctx: Context, input: z.infer<typeof convertInput>) {
  const quote = await repo(ctx, TradeQuotation).lock(input.quotationId);
  assertVersion(quote, input.expectedVersion);
  if (
    quote.docstatus !== DOCSTATUS.submitted ||
    (quote.validUntil && input.date > quote.validUntil) ||
    input.date < quote.date
  )
    throw new StateError('有効な確定見積のみ受注へ変換できます。', '見積の状態と有効期限を確認してください。');
  const existing = await repo(ctx, TradeOrder).list({
    where: { quotationId: quote.id, docstatus: { $ne: DOCSTATUS.cancelled } },
    limit: 1,
  });
  if (existing.items.length) throw new StateError('この見積には受注が存在します。', '既存の受注を開いてください。');
  return writeTrade(ctx, async (inner) => {
    const order = await repo(inner, TradeOrder).create({
      direction: 'sales',
      partnerId: quote.partnerId,
      quotationId: quote.id,
      date: input.date,
      requiredDate: input.requiredDate ?? null,
      note: quote.note,
    });
    const lines = await all(inner, TradeQuotationLine, {
      where: { quotationId: quote.id },
      orderBy: [{ field: 'seq', dir: 'asc' }],
    });
    await saveLines(inner, TradeOrder, order.id, {
      [TradeOrderLine.name]: lines.map((l) => ({
        productId: l.productId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxCategory: l.taxCategory,
      })),
    });
    return result(await repo(inner, TradeOrder).get(order.id), TradeOrder);
  });
}
export async function fulfillOrder(ctx: Context, input: z.infer<typeof fulfillInput>) {
  return withLock(ctx, 'trade.fulfill.' + input.requestId, async () => {
    const order = await repo(ctx, TradeOrder).lock(input.orderId);
    assertDirection(ctx, order.direction);
    const { expectedVersion: _version, ...payload } = input;
    const hash = contentHash(JSON.stringify(payload));
    const existing = (await repo(ctx, TradeFulfillment).list({ where: { requestId: input.requestId }, limit: 1 }))
      .items[0];
    if (existing) {
      if (existing.requestHash !== hash || existing.docstatus !== DOCSTATUS.submitted)
        throw new StateError(
          '再送識別子は別内容または取消済みです。',
          '新しい操作には新しい識別子を使用してください。',
        );
      return result(existing, TradeFulfillment);
    }
    assertVersion(order, input.expectedVersion);
    actualDate(ctx, input.date, order.date);
    if (order.docstatus !== DOCSTATUS.submitted || order.closed)
      throw new StateError('未確定・取消・打切り済み注文から履行できません。', '有効な確定注文を選択してください。');
    unique(input.lines.map((l) => l.orderLineId));
    const q = await orderQuantities(ctx, order.id);
    assertAfterCancellations(input.date, q.fulfillments);
    const warehouse = await repo(ctx, Warehouse).get(input.warehouseId);
    const lines = input.lines.map((l) => {
      const original = q.lines.find((o) => o.id === l.orderLineId);
      if (!original || positiveQuantity(l.quantity).gt(original.quantity.minus(q.fulfilled.get(original.id) ?? '0')))
        throw new StateError('注文残数を超える、または別注文の明細です。', '最新の注文残数を確認してください。');
      return { ...copiedLine(original, l.quantity), orderLineId: original.id };
    });
    return writeTrade(ctx, async (inner) => {
      const head = await repo(inner, TradeFulfillment).create({
        direction: order.direction,
        partnerId: order.partnerId,
        partnerName: order.partnerName,
        orderId: order.id,
        date: input.date,
        warehouseId: warehouse.id,
        warehouseName: warehouse.code + ' ' + warehouse.name,
        requestId: input.requestId,
        requestHash: hash,
      });
      for (const [i, line] of lines.entries())
        await repo(inner, TradeFulfillmentLine).create({ ...line, fulfillmentId: head.id, seq: i + 1 });
      return result(await submitDocument(inner, TradeFulfillment, head.id), TradeFulfillment);
    });
  });
}
export async function billFulfillment(ctx: Context, input: z.infer<typeof billInput>) {
  return withLock(ctx, 'trade.bill.' + input.requestId, async () => {
    const fulfillment = await repo(ctx, TradeFulfillment).lock(input.fulfillmentId);
    assertDirection(ctx, fulfillment.direction);
    const { expectedVersion: _version, ...payload } = input;
    const hash = contentHash(JSON.stringify(payload));
    const existing = (await repo(ctx, TradeBilling).list({ where: { requestId: input.requestId }, limit: 1 })).items[0];
    if (existing) {
      if (existing.requestHash !== hash || existing.docstatus !== DOCSTATUS.submitted)
        throw new StateError(
          '再送識別子は別内容または取消済みです。',
          '新しい操作には新しい識別子を使用してください。',
        );
      return result(existing, TradeBilling);
    }
    assertVersion(fulfillment, input.expectedVersion);
    actualDate(ctx, input.date, fulfillment.date);
    if (fulfillment.docstatus !== DOCSTATUS.submitted || !fulfillment.stockEntryId)
      throw new StateError('有効な確定履行からのみ請求できます。', '入出庫の状態を確認してください。');
    unique(input.lines.map((l) => l.fulfillmentLineId));
    const q = await fulfillmentQuantities(ctx, fulfillment.id);
    assertAfterCancellations(input.date, q.billings);
    const lines = input.lines.map((l) => {
      const original = q.lines.find((o) => o.id === l.fulfillmentLineId);
      if (!original || positiveQuantity(l.quantity).gt(original.quantity.minus(q.billed.get(original.id) ?? '0')))
        throw new StateError('未請求数量を超える、または別履行の明細です。', '最新の未請求数量を確認してください。');
      return { ...copiedLine(original, l.quantity), fulfillmentLineId: original.id };
    });
    return writeTrade(ctx, async (inner) => {
      const head = await repo(inner, TradeBilling).create({
        direction: fulfillment.direction,
        partnerId: fulfillment.partnerId,
        partnerName: fulfillment.partnerName,
        fulfillmentId: fulfillment.id,
        date: input.date,
        dueDate: input.dueDate ?? null,
        supplierInvoiceNo: input.supplierInvoiceNo ?? null,
        requestId: input.requestId,
        requestHash: hash,
      });
      for (const [i, line] of lines.entries())
        await repo(inner, TradeBillingLine).create({ ...line, billingId: head.id, seq: i + 1 });
      return result(await submitDocument(inner, TradeBilling, head.id), TradeBilling);
    });
  });
}
