import {
  cancelDocument,
  DOCSTATUS,
  registry,
  repo,
  StateError,
  submitDocument,
  type Context,
  type HookArgs,
} from '@daifuku/kernel';
import {
  cancelSourceStockEntries,
  createSourceStockEntry,
  registerInvoiceStockOwner,
  registerStockDocumentSource,
  StockEntry,
} from '@daifuku/mod-inventory';
import { PurchaseInvoice, PurchaseInvoiceLine } from '@daifuku/mod-purchase';
import { SalesInvoice, SalesInvoiceLine } from '@daifuku/mod-sales';
import { TradeBilling, TradeBillingLine, TradeFulfillment, TradeFulfillmentLine } from './entities.ts';
import { all, assertInternal, writeTrade } from './internal.ts';
async function postFulfillment(ctx: Context, { row }: HookArgs) {
  assertInternal(ctx);
  const lines = await all(ctx, TradeFulfillmentLine, {
    where: { fulfillmentId: String(row.id) },
    orderBy: [{ field: 'seq', dir: 'asc' }],
  });
  const stock = await createSourceStockEntry(
    ctx,
    {
      type: row.direction === 'sales' ? 'issue' : 'receipt',
      date: row.date as never,
      warehouseId: String(row.warehouseId),
      partnerId: String(row.partnerId),
      sourceEntity: TradeFulfillment.name,
      sourceId: String(row.id),
      note: '商流 ' + String(row.number),
    },
    lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity.toString(),
      unitCost: row.direction === 'purchase' ? l.unitPrice.toString() : '0',
    })),
  );
  await repo(ctx, TradeFulfillment).update(String(row.id), { stockEntryId: stock.id });
}
async function postBilling(ctx: Context, { row }: HookArgs) {
  assertInternal(ctx);
  const sales = row.direction === 'sales',
    entity = sales ? SalesInvoice : PurchaseInvoice,
    lineEntity = sales ? SalesInvoiceLine : PurchaseInvoiceLine;
  const invoice = await repo(ctx, entity).create({
    partnerId: String(row.partnerId),
    date: String(row.date),
    dueDate: row.dueDate ? String(row.dueDate) : null,
    priceIncludesTax: false,
    ...(sales ? {} : { supplierInvoiceNo: row.supplierInvoiceNo }),
    note: '商流 ' + String(row.number),
  });
  await repo(ctx, TradeBilling).update(
    String(row.id),
    sales ? { salesInvoiceId: invoice.id } : { purchaseInvoiceId: invoice.id },
  );
  const lines = await all(ctx, TradeBillingLine, {
    where: { billingId: String(row.id) },
    orderBy: [{ field: 'seq', dir: 'asc' }],
  });
  for (const [i, l] of lines.entries())
    await repo(ctx, lineEntity).create({
      invoiceId: invoice.id,
      seq: i + 1,
      productId: l.productId,
      description: l.description,
      uomId: l.uomId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxCategory: l.taxCategory,
    });
  const submitted = await submitDocument(ctx, entity, invoice.id);
  await repo(ctx, TradeBilling).update(String(row.id), { total: submitted.total });
}
async function ownedInvoice(ctx: Context, entity: string, id: string) {
  return (
    await repo(ctx, TradeBilling).list({
      where: { [entity === SalesInvoice.name ? 'salesInvoiceId' : 'purchaseInvoiceId']: id },
      limit: 1,
    })
  ).items[0];
}
export function registerPostingHooks() {
  registerStockDocumentSource(TradeFulfillment.name);
  registerInvoiceStockOwner('trade', async (ctx, entity, row) => {
    const owner = await ownedInvoice(ctx, entity, String(row.id));
    if (!owner) return false;
    assertInternal(ctx);
    const fulfillment = await repo(ctx, TradeFulfillment).get(owner.fulfillmentId);
    if (
      owner.docstatus !== DOCSTATUS.submitted ||
      fulfillment.docstatus !== DOCSTATUS.submitted ||
      !fulfillment.stockEntryId ||
      owner.partnerId !== row.partnerId ||
      (owner.direction === 'sales') !== (entity === SalesInvoice.name)
    )
      throw new StateError('商流請求と履行が一致しません。', '元資料の関連を確認してください。');
    const stock = await repo(ctx, StockEntry).get(fulfillment.stockEntryId);
    if (
      stock.docstatus !== DOCSTATUS.submitted ||
      stock.sourceEntity !== TradeFulfillment.name ||
      stock.sourceId !== fulfillment.id
    )
      throw new StateError('商流在庫資料が確定していません。', '履行から入出庫を確認してください。');
    return true;
  });
  registry.registerHook(TradeFulfillment.name, 'after_submit', postFulfillment);
  registry.registerHook(TradeBilling.name, 'after_submit', postBilling);
  registry.registerHook(TradeFulfillment.name, 'after_cancel', (ctx, { row, correctionDate }) =>
    writeTrade(ctx, (inner) =>
      cancelSourceStockEntries(inner, TradeFulfillment.name, String(row.id), correctionDate),
    ).then(() => undefined),
  );
  registry.registerHook(TradeBilling.name, 'after_cancel', (ctx, { row, correctionDate }) =>
    writeTrade(ctx, async (inner) => {
      const entity = row.direction === 'sales' ? SalesInvoice : PurchaseInvoice,
        id = row.direction === 'sales' ? row.salesInvoiceId : row.purchaseInvoiceId;
      if (!id) throw new StateError('生成請求が不明です。', '商流請求の関連を確認してください。');
      await cancelDocument(inner, entity, String(id), { correctionDate });
    }),
  );
  for (const entity of [SalesInvoice, PurchaseInvoice]) {
    registry.registerHook(entity.name, 'before_cancel', async (ctx, { row }) => {
      if (await ownedInvoice(ctx, entity.name, String(row.id))) assertInternal(ctx);
    });
    registry.registerHook(entity.name, 'before_submit', async (ctx, { row }) => {
      if (await ownedInvoice(ctx, entity.name, String(row.id))) assertInternal(ctx);
      if (row.amendedFrom && (await ownedInvoice(ctx, entity.name, String(row.amendedFrom))))
        throw new StateError('商流の生成請求は単独改訂できません。', '元の出荷・入荷から再請求してください。');
    });
  }
  registry.registerHook(StockEntry.name, 'before_submit', async (ctx, { row }) => {
    if (
      row.amendedFrom &&
      (await repo(ctx, StockEntry).get(String(row.amendedFrom))).sourceEntity === TradeFulfillment.name
    )
      throw new StateError('商流の生成入出庫は単独改訂できません。', '元の受発注から再度履行してください。');
  });
  registry.registerHook(StockEntry.name, 'before_cancel', (ctx, { row }) => {
    if (row.sourceEntity === TradeFulfillment.name) assertInternal(ctx);
  });
}
