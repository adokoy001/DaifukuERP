// docs/specs/print-templates.md AC-7, AC-8, AC-10〜AC-12, AC-17, AC-19〜AC-21: the trade print actions against
// Postgres — content from the stored estimate and lines, direction refusals, draft / cancelled banners, the sales /
// purchasing row rules, roles without read, another company, store-limited contexts, stored amounts surviving a later
// rounding change and the company date style. Test DB: TEST_DATABASE_URL*.
import {
  companies,
  newId,
  NotFound,
  PermissionDenied,
  registerCrudActions,
  registry,
  repo,
  runAction,
  setSetting,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account, openFiscalYear } from '@daifuku/mod-accounting';
import { Warehouse, seedWarehouses } from '@daifuku/mod-inventory';
import { Partner } from '@daifuku/mod-partner';
import {
  PRINT_DATE_STYLE_KEY,
  PRINT_ERA_DATE_OVERRIDE,
  printDateStyleSchema,
  type EraDateFn,
} from '@daifuku/mod-print-layout';
import { Product, seedUoms } from '@daifuku/mod-product';
import { seedTaxRates, TAX_ROUNDING_KEY, taxRoundingSchema } from '@daifuku/mod-tax';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TradeOrder, type TradeCommand, type TradeOrderDetail } from '../src/index.ts';

let db: TestDb;
let partner: string;
let warehouse: string;
const day = '2026-09-12';
const NOW = new Date('2026-09-13T03:00:00Z');
const run = <T>(params: Partial<ContextParams>, work: (ctx: Context) => Promise<T>) =>
  db.run({ now: () => NOW, ...params }, work);
const action = (name: string, input: unknown) =>
  run({}, (ctx) => runAction(ctx, name, input)) as Promise<TradeCommand & { version: number }>;
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const render = (params: Partial<ContextParams>, name: string, id: string) =>
  run(params, async (ctx) => ((await runAction(ctx, name, { id })) as { html: string }).html);
const QUOTE = 'trade.render_quotation_html';
const ORDER = 'trade.render_order_html';
const DELIVERY = 'trade.render_delivery_note_html';

function required<T>(value: T | undefined | null): T {
  if (value === null || value === undefined) throw new Error('missing fixture row');
  return value;
}
async function product(stock: boolean, taxCategory = 'standard') {
  const p = await run({}, (ctx) =>
    repo(ctx, Product).create({
      code: 'PP' + newId().slice(-12),
      name: '帳票部品',
      salePrice: '1000',
      purchasePrice: '333',
      taxCategory,
    }),
  );
  if (stock) {
    const entry = await action('stock_entry.create', {
      type: 'receipt',
      date: day,
      warehouseId: warehouse,
      lines: { stock_entry_line: [{ productId: p.id, quantity: '100', unitCost: '333' }] },
    });
    await action('stock_entry.submit', { id: entry.id });
  }
  return p;
}
async function quotation(submit: boolean) {
  const p = await product(false);
  const q = await action('trade_quotation.create', {
    partnerId: partner,
    date: day,
    validUntil: '2026-09-30',
    note: '見積の備考',
    lines: {
      trade_quotation_line: [
        { productId: p.id, description: '見積品A', quantity: '3', unitPrice: '1000', taxCategory: 'standard' },
      ],
    },
  });
  return submit ? action('trade_quotation.submit', { id: q.id }) : q;
}
async function order(direction: 'sales' | 'purchase', submit = true) {
  const p = await product(direction === 'sales');
  const draft = await action('trade_order.create', {
    direction,
    partnerId: partner,
    date: day,
    requiredDate: '2026-09-25',
    lines: {
      trade_order_line: [
        { productId: p.id, quantity: '7', unitPrice: '333', description: '注文品B', taxCategory: 'standard' },
      ],
    },
  });
  return submit ? action('trade_order.submit', { id: draft.id }) : draft;
}
async function ship(direction: 'sales' | 'purchase') {
  const o = await order(direction);
  const d = (await run({}, (ctx) => runAction(ctx, 'trade.order_detail', { orderId: o.id }))) as TradeOrderDetail;
  const f = await action('trade.fulfill_order', {
    orderId: o.id,
    expectedVersion: o.version,
    date: day,
    warehouseId: warehouse,
    requestId: newId(),
    lines: [{ orderLineId: required(d.lines[0]).id, quantity: '5' }],
  });
  return { order: o, fulfillment: f };
}

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await run({}, async (ctx) => {
    await seedUoms(ctx);
    await seedWarehouses(ctx);
    await seedTaxRates(ctx);
    await openFiscalYear(ctx, { startDate: '2026-01-01' });
    warehouse = required((await repo(ctx, Warehouse).list({ limit: 1 })).items[0]).id;
    partner = (
      await repo(ctx, Partner).create({
        name: '帳票取引先',
        isCustomer: true,
        isSupplier: true,
        postalCode: '530-0001',
        prefecture: '大阪府',
        address1: '大阪市北区3-3',
      })
    ).id;
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
    ] as const)
      await repo(ctx, Account).create(a);
  });
});
afterAll(async () => db?.close());

describe('trade print actions (docs/specs/print-templates.md)', () => {
  it('AC-10 the quotation prints the stored estimate, lines, validity, partner snapshot and note', async () => {
    const q = await quotation(true);
    const html = await render(asRole(['sales']), QUOTE, q.id);
    for (const s of [
      '>見積書<',
      String(q.number),
      '有効期限',
      '帳票取引先 御中',
      '〒530-0001 大阪府 大阪市北区3-3',
      '>見積品A<',
      '>3,000<',
      '>課税（標準） 10%<',
      '3,300円',
      '見積の備考',
      'テスト株式会社',
    ])
      expect(html).toContain(s);
    expect(html).not.toContain('role="status"');
  });

  it('AC-17 draft quotations and purchase orders carry the draft banner; cancelled ones the cancelled banner', async () => {
    const draft = await quotation(false);
    expect(await render({}, QUOTE, draft.id)).toContain('下書き（未確定） / DRAFT');
    const draftOrder = await order('purchase', false);
    expect(await render({}, ORDER, draftOrder.id)).toContain('下書き（未確定） / DRAFT');
    const q = await quotation(true);
    await action('trade_quotation.cancel', { id: q.id });
    const cancelled = await render({}, QUOTE, q.id);
    expect(cancelled).toContain('取消済み / CANCELLED');
    expect(cancelled.indexOf('<p role="status"')).toBe(cancelled.indexOf('<body>') + '<body>'.length);
  });

  it('AC-11 the purchase order: required date, supplier, no buyer registration number; sales orders are refused', async () => {
    const po = await order('purchase');
    const html = await render(asRole(['purchasing']), ORDER, po.id);
    expect(html).toContain('>注文書<');
    expect(html).toContain('希望納期');
    expect(html).toContain('>2,331<');
    expect(html).toContain('2,564円'); // 2,331 + tax 233 (rounded down at submit)
    const so = await order('sales');
    await expect(render({}, ORDER, so.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('AC-12 the delivery note: order number, lines without rates, category totals and the invoice note; receipts of goods refused', async () => {
    const { order: so, fulfillment } = await ship('sales');
    const html = await render(asRole(['sales']), DELIVERY, fulfillment.id);
    for (const s of [
      '>納品書<',
      String(so.number),
      '>注文品B<',
      '>1,665<',
      '>課税（標準）<',
      '消費税額は請求書に記載します',
    ])
      expect(html).toContain(s);
    expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(/\d+%/);
    const { fulfillment: receiving } = await ship('purchase');
    await expect(render({}, DELIVERY, receiving.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const live = await run({}, (ctx) => runAction(ctx, 'trade.order_detail', { orderId: so.id }));
    const version = required((live as TradeOrderDetail).fulfillments[0]).version;
    await action('trade.cancel_fulfillment', {
      fulfillmentId: fulfillment.id,
      expectedVersion: version,
      correctionDate: '2026-09-13',
      reason: '帳票の試験',
    });
    expect(await render({}, DELIVERY, fulfillment.id)).toContain('取消済み / CANCELLED');
  });

  it('AC-7 printed amounts are the stored ones: a later rounding change does not alter them', async () => {
    const po = await order('purchase');
    const before = await render({}, ORDER, po.id);
    await run({}, (ctx) => setSetting(ctx, TAX_ROUNDING_KEY, taxRoundingSchema, { mode: 'up', unit: 'invoice' }));
    try {
      const after = await render({}, ORDER, po.id);
      expect(after).toBe(before);
      expect(after).toContain('>233<');
      expect(after).not.toContain('>234<');
    } finally {
      await run({}, (ctx) => setSetting(ctx, TAX_ROUNDING_KEY, taxRoundingSchema, { mode: 'down', unit: 'invoice' }));
    }
  });

  it('AC-8 the company date style changes the dates (era through the print_layout.era_date override)', async () => {
    const q = await quotation(true);
    const era: EraDateFn = (d) =>
      `令和${Number(d.slice(0, 4)) - 2018}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
    registry.registerOverride(PRINT_ERA_DATE_OVERRIDE, era);
    try {
      expect(await render({}, QUOTE, q.id)).toContain('2026年9月12日（令和8年9月12日）'); // default: both
      await run({}, (ctx) => setSetting(ctx, PRINT_DATE_STYLE_KEY, printDateStyleSchema, 'japanese_era'));
      const eraOnly = await render({}, QUOTE, q.id);
      expect(eraOnly).toContain('令和8年9月12日');
      expect(eraOnly).not.toContain('2026年9月12日');
      await run({}, (ctx) => setSetting(ctx, PRINT_DATE_STYLE_KEY, printDateStyleSchema, 'western'));
      const western = await render({ locale: 'en' }, QUOTE, q.id);
      expect(western).toContain('2026-09-12');
      expect(western).not.toContain('令和');
    } finally {
      registry.registerOverride(PRINT_ERA_DATE_OVERRIDE, () => '');
      await run({}, (ctx) => setSetting(ctx, PRINT_DATE_STYLE_KEY, printDateStyleSchema, 'both'));
    }
  });

  it('AC-20 roles: purchasing has no read on quotations; row rules hide the other direction (NOT_FOUND)', async () => {
    const q = await quotation(true);
    await expect(render(asRole(['purchasing']), QUOTE, q.id)).rejects.toBeInstanceOf(PermissionDenied);
    const po = await order('purchase');
    await expect(render(asRole(['sales']), ORDER, po.id)).rejects.toBeInstanceOf(NotFound);
    const { fulfillment } = await ship('sales');
    await expect(render(asRole(['purchasing']), DELIVERY, fulfillment.id)).rejects.toBeInstanceOf(NotFound);
    expect(await render(asRole(['viewer']), DELIVERY, fulfillment.id)).toContain('>納品書<');
    expect(await render(asRole(['accounting']), ORDER, po.id)).toContain('>注文書<');
  });

  it('AC-19 AC-21 another company, an unknown id and a store-limited context are refused', async () => {
    const po = await order('purchase');
    const otherCompanyId = newId();
    await db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: db.tenantId, code: 'OTHER-T', name: '別会社' });
    await expect(render({ companyId: otherCompanyId }, ORDER, po.id)).rejects.toBeInstanceOf(NotFound);
    await expect(render({}, ORDER, newId())).rejects.toBeInstanceOf(NotFound);
    const storeScoped = { ...asRole(['purchasing']), accessScope: 'stores' as const, storeIds: [newId()] };
    await expect(render(storeScoped, ORDER, po.id)).rejects.toBeInstanceOf(PermissionDenied);
    expect((await run({}, (ctx) => repo(ctx, TradeOrder).get(po.id))).direction).toBe('purchase');
  });
});
