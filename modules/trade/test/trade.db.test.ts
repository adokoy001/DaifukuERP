import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { newId, registerCrudActions, repo, runAction, type Context } from '@daifuku/kernel';
import { Account, openFiscalYear } from '@daifuku/mod-accounting';
import { Product, seedUoms } from '@daifuku/mod-product';
import { Partner } from '@daifuku/mod-partner';
import { seedTaxRates } from '@daifuku/mod-tax';
import { StockBalance, StockEntry, StockLedger, Warehouse, seedWarehouses } from '@daifuku/mod-inventory';
import { SalesInvoice } from '@daifuku/mod-sales';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import { Payment } from '@daifuku/mod-payment';
import {
  TradeBilling,
  TradeFulfillment,
  TradeOrder,
  TradeOrderLine,
  type TradeCommand,
  type TradeOrderDetail,
} from '../src/index.ts';
let db: TestDb;
let partner: string;
let warehouse: string;
let bank: string;
const day = '2026-09-12';
const now = () => new Date('2026-09-13T03:00:00Z');
const run = <T>(work: (ctx: Context) => Promise<T>) => db.run({ now }, work);
const action = (name: string, input: unknown) => run((ctx) => runAction(ctx, name, input)) as Promise<TradeCommand>;
const detail = (orderId: string) =>
  run((ctx) => runAction(ctx, 'trade.order_detail', { orderId })) as Promise<TradeOrderDetail>;
async function product(stock = false) {
  const p = await run((ctx) =>
    repo(ctx, Product).create({
      code: 'P' + newId().slice(-12),
      name: '商流部品',
      salePrice: '1000',
      purchasePrice: '600',
    }),
  );
  if (stock) {
    const entry = await action('stock_entry.create', {
      type: 'receipt',
      date: day,
      warehouseId: warehouse,
      lines: { stock_entry_line: [{ productId: p.id, quantity: '100', unitCost: '600' }] },
    });
    await action('stock_entry.submit', { id: entry.id });
  }
  return p;
}
async function order(direction: 'sales' | 'purchase' = 'purchase', quantity = '10') {
  const p = await product(direction === 'sales');
  const draft = await action('trade_order.create', {
    direction,
    partnerId: partner,
    date: day,
    lines: {
      trade_order_line: [
        {
          productId: p.id,
          quantity,
          unitPrice: direction === 'sales' ? '1000' : '600',
          description: '合意済み品名',
          taxCategory: 'standard',
        },
      ],
    },
  });
  const submitted = await action('trade_order.submit', { id: draft.id });
  return { order: submitted, product: p, detail: await detail(draft.id) };
}
async function fulfill(o: Awaited<ReturnType<typeof order>>, quantity: string, requestId = newId()) {
  return action('trade.fulfill_order', {
    orderId: o.order.id,
    expectedVersion: o.order.version,
    date: day,
    warehouseId: warehouse,
    requestId,
    lines: [{ orderLineId: required(o.detail.lines[0]).id, quantity }],
  });
}
async function bill(orderId: string, fulfillmentId: string, quantity: string, requestId = newId()) {
  const f = required((await detail(orderId)).fulfillments.find((v) => v.id === fulfillmentId));
  return action('trade.bill_fulfillment', {
    fulfillmentId,
    expectedVersion: f.version,
    date: day,
    requestId,
    lines: [{ fulfillmentLineId: required(f.lines[0]).id, quantity }],
  });
}
function required<T>(value: T | undefined | null): T {
  if (value === null || value === undefined) throw new Error('missing fixture row');
  return value;
}
async function balance(productId: string) {
  return run(async (ctx) =>
    required(
      (await repo(ctx, StockBalance).list({ where: { productId, warehouseId: warehouse } })).items[0],
    ).qty.toString(),
  );
}
beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await run(async (ctx) => {
    await seedUoms(ctx);
    await seedWarehouses(ctx);
    await seedTaxRates(ctx);
    await openFiscalYear(ctx, { startDate: '2026-01-01' });
    warehouse = required((await repo(ctx, Warehouse).list({ limit: 1 })).items[0]).id;
    partner = (await repo(ctx, Partner).create({ name: '商流共通取引先', isCustomer: true, isSupplier: true })).id;
    for (const a of [
      { code: '2400', name: '前受金', type: 'liability' },
      { code: '1900', name: '前払金', type: 'asset' },
      { code: '1100', name: '預金', type: 'asset' },
      { code: '1300', name: '売掛金', type: 'asset', partnerRequired: true },
      { code: '2100', name: '買掛金', type: 'liability', partnerRequired: true },
      { code: '4000', name: '売上', type: 'revenue' },
      { code: '5000', name: '仕入', type: 'expense' },
      { code: '2200', name: '仮受税', type: 'liability', taxRole: 'output_tax' },
      { code: '1500', name: '仮払税', type: 'asset', taxRole: 'input_tax' },
    ] as const) {
      const arow = await repo(ctx, Account).create(a);
      if (a.code === '1100') bank = arow.id;
    }
  });
});
afterAll(async () => db.close());
describe('trade fulfillment quantity and immutable sources', () => {
  it('runs purchase partial receipts and split invoices with exactly one inventory movement per receipt', async () => {
    const o = await order();
    const f = await fulfill(o, '6');
    const b1 = await bill(o.order.id, f.id, '4');
    const b2 = await bill(o.order.id, f.id, '2');
    let d = await detail(o.order.id);
    expect(d.lines[0]).toMatchObject({
      quantity: '10',
      fulfilledQuantity: '6',
      billedQuantity: '6',
      remainingQuantity: '4',
      unbilledQuantity: '0',
      description: '合意済み品名',
    });
    expect(await balance(o.product.id)).toBe('6');
    const billing = await run((ctx) => repo(ctx, TradeBilling).get(b1.id));
    expect(
      (await run((ctx) => repo(ctx, PurchaseInvoice).get(required(billing.purchaseInvoiceId)))).total.toString(),
    ).toBe('2640');
    expect((await run((ctx) => repo(ctx, TradeBilling).get(b2.id))).total.toString()).toBe('1320');
    await fulfill(o, '4');
    d = await detail(o.order.id);
    expect(d.order.status).toBe('fulfilled');
    expect(d.lines[0]?.unbilledQuantity).toBe('4');
    expect(await balance(o.product.id)).toBe('10');
  });
  it('runs quotation to sales order, ships once, preserves agreement snapshots and invoices partial quantities', async () => {
    const p = await product(true);
    const quote = await action('trade_quotation.create', {
      partnerId: partner,
      date: day,
      validUntil: '2026-09-30',
      lines: {
        trade_quotation_line: [
          { productId: p.id, description: '当初合意', quantity: '10', unitPrice: '1000', taxCategory: 'standard' },
        ],
      },
    });
    const q = await action('trade_quotation.submit', { id: quote.id });
    const converted = await action('trade.convert_quotation', {
      quotationId: q.id,
      expectedVersion: q.version,
      date: day,
    });
    await action('trade_order.update', { id: converted.id, patch: { note: '希望納期確認' } });
    const ord = await action('trade_order.submit', { id: converted.id });
    await run((ctx) => repo(ctx, Product).update(p.id, { name: '後日名称', salePrice: '2000' }));
    const o = { order: ord, product: p, detail: await detail(ord.id) };
    const f = await fulfill(o, '6');
    await bill(ord.id, f.id, '4');
    const d = await detail(ord.id);
    expect(d.lines[0]).toMatchObject({
      description: '当初合意',
      unitPrice: '1000',
      remainingQuantity: '4',
      unbilledQuantity: '2',
    });
    expect(await balance(p.id)).toBe('94');
    await expect(action('trade_quotation.cancel', { id: quote.id })).rejects.toMatchObject({ code: 'HAS_DEPENDENTS' });
    await expect(
      action('trade.convert_quotation', { quotationId: q.id, expectedVersion: q.version, date: day }),
    ).rejects.toThrow('存在');
  });
  it('replays identical requests and serializes concurrent over-fulfillment and over-billing', async () => {
    const o = await order();
    const requestId = newId();
    const replay = await Promise.all([fulfill(o, '6', requestId), fulfill(o, '6', requestId)]);
    expect(replay[0]?.id).toBe(replay[1]?.id);
    await expect(fulfill(o, '5', requestId)).rejects.toThrow('再送');
    const more = await Promise.allSettled([fulfill(o, '3'), fulfill(o, '3')]);
    expect(more.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    const f = required(replay[0]);
    const bills = await Promise.allSettled([bill(o.order.id, f.id, '4'), bill(o.order.id, f.id, '4')]);
    expect(bills.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(o.product.id)).toBe('9');
  });
  it('cancels billing before physical receipt, restores unbilled quantities and enforces effective-date order', async () => {
    const o = await order();
    const f = await fulfill(o, '6');
    const b = await bill(o.order.id, f.id, '4');
    await expect(
      action('trade.cancel_fulfillment', {
        fulfillmentId: f.id,
        expectedVersion: required((await detail(o.order.id)).fulfillments[0]).version,
        correctionDate: day,
        reason: '先行取消不可',
      }),
    ).rejects.toMatchObject({ code: 'HAS_DEPENDENTS' });
    await action('trade.cancel_billing', {
      billingId: b.id,
      expectedVersion: b.version,
      correctionDate: '2026-09-13',
      reason: '請求訂正',
    });
    expect((await detail(o.order.id)).lines[0]?.unbilledQuantity).toBe('6');
    expect(await balance(o.product.id)).toBe('6');
    const live = await run((ctx) => repo(ctx, TradeFulfillment).get(f.id));
    await expect(
      action('trade.cancel_fulfillment', {
        fulfillmentId: f.id,
        expectedVersion: live.version,
        correctionDate: day,
        reason: '日付先行不可',
      }),
    ).rejects.toThrow('後続');
    await action('trade.cancel_fulfillment', {
      fulfillmentId: f.id,
      expectedVersion: live.version,
      correctionDate: '2026-09-13',
      reason: '入荷訂正',
    });
    expect(await balance(o.product.id)).toBe('0');
    expect((await detail(o.order.id)).lines[0]?.remainingQuantity).toBe('10');
    await expect(action('trade_order.cancel', { id: o.order.id, correctionDate: day })).rejects.toThrow('後続');
    await action('trade_order.cancel', { id: o.order.id, correctionDate: '2026-09-13' });
  });
  it('rolls back source cancellation when external payment remains, then permits cancellation after payment reversal', async () => {
    const o = await order('sales');
    const f = await fulfill(o, '4');
    const b = await bill(o.order.id, f.id, '4');
    const source = await run((ctx) => repo(ctx, TradeBilling).get(b.id));
    const p = await action('payment.create', {
      direction: 'receive',
      partnerId: partner,
      date: day,
      amount: '1000',
      accountId: bank,
      method: 'bank_transfer',
      lines: {
        payment_allocation: [{ invoiceEntity: SalesInvoice.name, invoiceId: source.salesInvoiceId, amount: '1000' }],
      },
    });
    await action('payment.submit', { id: p.id });
    await expect(
      action('trade.cancel_billing', {
        billingId: b.id,
        expectedVersion: b.version,
        correctionDate: '2026-09-13',
        reason: '支払残存',
      }),
    ).rejects.toThrow();
    expect((await run((ctx) => repo(ctx, TradeBilling).get(b.id))).docstatus).toBe(1);
    expect(
      (await run((ctx) => repo(ctx, SalesInvoice).get(required(source.salesInvoiceId)))).paidAmount.toString(),
    ).toBe('1000');
    await action('payment.cancel', { id: p.id, correctionDate: '2026-09-13' });
    await action('trade.cancel_billing', {
      billingId: b.id,
      expectedVersion: b.version,
      correctionDate: '2026-09-13',
      reason: '入金取消後訂正',
    });
    expect((await run((ctx) => repo(ctx, Payment).get(p.id))).docstatus).toBe(2);
    expect(await balance(o.product.id)).toBe('96');
  });
  it('rejects source forgery, direct linked cancellation, frozen lines, foreign order lines and invalid quantities', async () => {
    const o = await order();
    const other = await order();
    const f = await fulfill(o, '6');
    const b = await bill(o.order.id, f.id, '4');
    await expect(
      run((ctx) =>
        repo(ctx, TradeOrder).create({ direction: 'sales', partnerId: partner, date: day, quotationId: newId() }),
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      run((ctx) => repo(ctx, TradeOrderLine).update(required(o.detail.lines[0]).id, { quantity: '100' })),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(
      action('trade.fulfill_order', {
        orderId: o.order.id,
        expectedVersion: o.order.version,
        warehouseId: warehouse,
        date: day,
        requestId: newId(),
        lines: [{ orderLineId: required(other.detail.lines[0]).id, quantity: '1' }],
      }),
    ).rejects.toThrow('別注文');
    await expect(fulfill(o, '0.0000001')).rejects.toMatchObject({ code: 'VALIDATION' });
    const billing = await run((ctx) => repo(ctx, TradeBilling).get(b.id));
    await expect(action('purchase_invoice.cancel', { id: billing.purchaseInvoiceId })).rejects.toMatchObject({
      code: 'HAS_DEPENDENTS',
    });
    const fulfillment = await run((ctx) => repo(ctx, TradeFulfillment).get(f.id));
    await expect(action('stock_entry.cancel', { id: fulfillment.stockEntryId })).rejects.toMatchObject({
      code: 'HAS_DEPENDENTS',
    });
    await expect(action('trade_fulfillment.cancel', { id: f.id })).rejects.toThrow();
  });
  it('closes the remaining order without changing delivered history and preserves legacy invoice-driven stock', async () => {
    const o = await order();
    const f = await fulfill(o, '6');
    await action('trade.close_order', { orderId: o.order.id, expectedVersion: o.order.version, reason: '残り4個不要' });
    await expect(fulfill(o, '1')).rejects.toThrow();
    const visible = (await run((ctx) => runAction(ctx, 'trade.board', { direction: 'purchase', status: 'open' }))) as {
      rows: { id: string; unbilledLineCount: number }[];
    };
    expect(visible.rows.find((v) => v.id === o.order.id)?.unbilledLineCount).toBe(1);
    await bill(o.order.id, f.id, '6');
    const d = await detail(o.order.id);
    expect(d.order).toMatchObject({ status: 'closed', closedReason: '残り4個不要' });
    expect(d.lines[0]?.remainingQuantity).toBe('4');
    const p = await product();
    const invoice = await action('purchase_invoice.create', {
      partnerId: partner,
      date: day,
      priceIncludesTax: false,
      lines: {
        purchase_invoice_line: [
          { productId: p.id, quantity: '3', unitPrice: '600', description: '従来請求', taxCategory: 'standard' },
        ],
      },
    });
    await action('purchase_invoice.submit', { id: invoice.id });
    expect(await balance(p.id)).toBe('3');
    expect(
      (
        await run((ctx) =>
          repo(ctx, StockEntry).list({ where: { sourceEntity: PurchaseInvoice.name, sourceId: invoice.id } }),
        )
      ).total,
    ).toBe(1);
  });
  it('isolates companies and role directions in source documents, line CRUD and board reads', async () => {
    const o = await order();
    const sales = await order('sales');
    const otherCompany = newId();
    await db.owner
      .sql`insert into companies(id,tenant_id,code,name) values(${otherCompany},${db.tenantId},'TRADE-OTHER','Other')`;
    await expect(
      db.run({ companyId: otherCompany }, (ctx) => repo(ctx, TradeOrder).get(o.order.id)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(db.run({ roles: ['sales'] }, (ctx) => repo(ctx, TradeOrder).get(o.order.id))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      db.run({ roles: ['purchasing'] }, (ctx) => repo(ctx, TradeOrderLine).get(required(sales.detail.lines[0]).id)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      db.run({ roles: ['sales'], now }, (ctx) =>
        runAction(ctx, 'trade_order.create', { direction: 'purchase', partnerId: partner, date: day }),
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const board = (await db.run({ roles: ['sales'] }, (ctx) =>
      runAction(ctx, 'trade.board', { direction: 'purchase', status: 'all' }),
    )) as {
      rows: unknown[];
    };
    expect(board.rows).toHaveLength(0);
  });
  it('refuses future fulfillment and failed receipt cancellation without partial reverse ledger writes', async () => {
    const o = await order();
    await expect(
      action('trade.fulfill_order', {
        orderId: o.order.id,
        expectedVersion: o.order.version,
        date: '2026-09-14',
        warehouseId: warehouse,
        requestId: newId(),
        lines: [{ orderLineId: required(o.detail.lines[0]).id, quantity: '6' }],
      }),
    ).rejects.toThrow('未来');
    const f = await fulfill(o, '6');
    const issue = await action('stock_entry.create', {
      type: 'issue',
      date: day,
      warehouseId: warehouse,
      lines: { stock_entry_line: [{ productId: o.product.id, quantity: '5' }] },
    });
    await action('stock_entry.submit', { id: issue.id });
    const before = await run((ctx) => repo(ctx, StockLedger).count({ productId: o.product.id }));
    await expect(
      action('trade.cancel_fulfillment', {
        fulfillmentId: f.id,
        expectedVersion: f.version,
        correctionDate: day,
        reason: '在庫不足',
      }),
    ).rejects.toThrow();
    expect(await run((ctx) => repo(ctx, StockLedger).count({ productId: o.product.id }))).toBe(before);
    expect((await run((ctx) => repo(ctx, TradeFulfillment).get(f.id))).docstatus).toBe(1);
    expect(await balance(o.product.id)).toBe('1');
  });
  it('requires re-billing dates after cancellation and blocks detached amendments of generated invoices', async () => {
    const o = await order();
    const f = await fulfill(o, '4');
    const b = await bill(o.order.id, f.id, '4');
    const original = await run((ctx) => repo(ctx, TradeBilling).get(b.id));
    await action('trade.cancel_billing', {
      billingId: b.id,
      expectedVersion: b.version,
      correctionDate: '2026-09-13',
      reason: '日付訂正',
    });
    await expect(bill(o.order.id, f.id, '4')).rejects.toThrow('先行取消日');
    const amended = await action('purchase_invoice.amend', { id: original.purchaseInvoiceId });
    await expect(action('purchase_invoice.submit', { id: amended.id })).rejects.toThrow('単独改訂');
    const current = required((await detail(o.order.id)).fulfillments[0]);
    const payload = {
      fulfillmentId: f.id,
      expectedVersion: current.version,
      date: '2026-09-13',
      requestId: newId(),
      lines: [{ fulfillmentLineId: required(current.lines[0]).id, quantity: '4' }],
    };
    const [one, two] = await Promise.all([
      action('trade.bill_fulfillment', payload),
      action('trade.bill_fulfillment', payload),
    ]);
    expect(one.id).toBe(two.id);
    expect(one.id).not.toBe(b.id);
    expect(await balance(o.product.id)).toBe('4');
  });
  it('does not cancel a quotation while an unsubmitted converted order still references it', async () => {
    const p = await product();
    const quote = await action('trade_quotation.create', {
      partnerId: partner,
      date: day,
      lines: {
        trade_quotation_line: [
          { productId: p.id, description: p.name, quantity: '1', unitPrice: '1000', taxCategory: 'standard' },
        ],
      },
    });
    const submitted = await action('trade_quotation.submit', { id: quote.id });
    await action('trade.convert_quotation', { quotationId: quote.id, expectedVersion: submitted.version, date: day });
    await expect(action('trade_quotation.cancel', { id: quote.id })).rejects.toThrow('受注が残って');
  });
  it('completes both directions using their ordinary roles, including fractional quantities', async () => {
    for (const direction of ['sales', 'purchase'] as const) {
      const o = await order(direction, '1.5');
      const roles = [direction === 'sales' ? 'sales' : 'purchasing'];
      const f = (await db.run({ roles, now }, (ctx) =>
        runAction(ctx, 'trade.fulfill_order', {
          orderId: o.order.id,
          expectedVersion: o.order.version,
          date: day,
          warehouseId: warehouse,
          requestId: newId(),
          lines: [{ orderLineId: required(o.detail.lines[0]).id, quantity: '0.5' }],
        }),
      )) as TradeCommand;
      const fd = required((await detail(o.order.id)).fulfillments[0]);
      await db.run({ roles, now }, (ctx) =>
        runAction(ctx, 'trade.bill_fulfillment', {
          fulfillmentId: f.id,
          expectedVersion: fd.version,
          date: day,
          requestId: newId(),
          lines: [{ fulfillmentLineId: required(fd.lines[0]).id, quantity: '0.25' }],
        }),
      );
      expect((await detail(o.order.id)).lines[0]).toMatchObject({
        quantity: '1.5',
        remainingQuantity: '1',
        unbilledQuantity: '0.25',
      });
    }
  });
  it('keeps quotation ownership across a generic order amendment and refuses a competing conversion', async () => {
    const p = await product();
    const quote = await action('trade_quotation.create', {
      partnerId: partner,
      date: day,
      lines: {
        trade_quotation_line: [
          { productId: p.id, description: p.name, quantity: '1', unitPrice: '1000', taxCategory: 'standard' },
        ],
      },
    });
    const submitted = await action('trade_quotation.submit', { id: quote.id });
    const converted = await action('trade.convert_quotation', {
      quotationId: quote.id,
      expectedVersion: submitted.version,
      date: day,
    });
    await action('trade_order.submit', { id: converted.id });
    await action('trade_order.cancel', { id: converted.id, correctionDate: day });
    const amended = await action('trade_order.amend', { id: converted.id });
    await action('trade_order.submit', { id: amended.id });
    expect((await run((ctx) => repo(ctx, TradeOrder).get(amended.id))).quotationId).toBe(quote.id);
    await expect(
      action('trade.convert_quotation', { quotationId: quote.id, expectedVersion: submitted.version, date: day }),
    ).rejects.toThrow('存在');
  });
});
