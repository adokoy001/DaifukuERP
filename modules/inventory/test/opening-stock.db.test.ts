// Postgres tests for docs/specs/opening-balances.md — opening stock (AC-6, AC-7, AC-23, AC-24, AC-26, D-14..D-16).
// Fixture: fiscal year 2026-01-01 (opening date 2025-12-31), products A/B/C/F/S, warehouses MAIN (default) and SUB.
import {
  companies,
  defineWriteCapability,
  newId,
  PermissionDenied,
  repo,
  runAction,
  setSetting,
  submitDocument,
  withWriteCapability,
  type ContextParams,
} from '@daifuku/kernel';
import { openingImportResult, type OpeningImportResult } from '@daifuku/mod-accounting';
import { Product, seedUoms } from '@daifuku/mod-product';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeInventoryThrough,
  DEFAULT_WAREHOUSE_KEY,
  StockBalance,
  StockEntry,
  StockEntryLine,
  warehouseCodeSchema,
  Warehouse,
} from '../src/index.ts';
import { asRole, caught, setupFixture, type Fixture, type Table } from './fixture.ts';

let f: Fixture;
let fyId: string;
const OPENING = '2025-12-31';

type Row = Partial<Record<'warehouseCode' | 'productCode' | 'quantity' | 'unitCost', string | null>>;
const importStock = async (
  rows: Row[],
  mode: 'dry-run' | 'execute' = 'execute',
  params: Partial<ContextParams> = {},
): Promise<OpeningImportResult> =>
  openingImportResult.parse(await f.act(params, 'inventory.import_opening_stock', { fiscalYearId: fyId, mode, rows }));
const codesOf = (r: OpeningImportResult) => r.rows.map((row) => row.messages?.[0]?.code ?? row.status);
const openingEntries = () =>
  f.run({}, (ctx) =>
    repo(ctx, StockEntry).list({
      where: { sourceEntity: 'fiscal_year', sourceId: fyId },
      orderBy: [{ field: 'createdAt', dir: 'asc' }],
      limit: 500,
    }),
  );

beforeAll(async () => {
  f = await setupFixture();
  fyId = await f.run({}, async (ctx) => {
    const { FiscalYear } = await import('@daifuku/mod-accounting');
    return ((await repo(ctx, FiscalYear).list({ limit: 1 })).items[0] as { id: string }).id;
  });
});
afterAll(async () => {
  await f?.db.close();
});

describe('opening stock: rows and permissions', () => {
  it('AC-23: quantities, unit costs, codes, services and duplicates are classified per row', async () => {
    const result = await importStock(
      [
        { productCode: 'A', quantity: 'x', unitCost: '1' },
        { productCode: 'A', quantity: '0', unitCost: '1' },
        { productCode: 'A', quantity: '-2', unitCost: '1' },
        { productCode: 'A', quantity: '1.0000001', unitCost: '1' },
        { productCode: 'A', quantity: '1', unitCost: '' },
        { productCode: 'A', quantity: '1', unitCost: '-1' },
        { productCode: 'A', quantity: '1', unitCost: '0.1234567' },
        { productCode: '$ctx.companyId', quantity: '1', unitCost: '1' },
        { warehouseCode: '$ctx.userId', productCode: 'A', quantity: '1', unitCost: '1' },
        { productCode: 'NOPE', quantity: '1', unitCost: '1' },
        { warehouseCode: 'NOWHERE', productCode: 'A', quantity: '1', unitCost: '1' },
        { productCode: 'S', quantity: '1', unitCost: '1' },
        { productCode: '商品B', quantity: '2', unitCost: '0' },
        { warehouseCode: 'main', productCode: 'B', quantity: '2', unitCost: '5' },
      ],
      'dry-run',
    );
    expect(codesOf(result)).toEqual([
      'invalid_value',
      'non_positive_quantity',
      'non_positive_quantity',
      'scale_exceeded',
      'invalid_value',
      'negative_amount',
      'scale_exceeded',
      'invalid_value',
      'invalid_value',
      'ref_not_found',
      'ref_not_found',
      'service_product',
      'ok',
      'duplicate',
    ]);
    expect(result.rows[0]?.messages?.[0]).toMatchObject({ field: 'quantity', column: 'quantity' });
    expect(result.committed).toBe(false);
    expect((await openingEntries()).total).toBe(0);
  });

  it('AC-6: accounting alone and accounting + sales get 403; accounting + inventory + viewer and accounting + purchasing pass', async () => {
    const rows = [{ productCode: 'A', quantity: '1', unitCost: '1' }];
    for (const roles of [['accounting'], ['accounting', 'sales'], ['inventory', 'viewer']])
      expect(await caught(importStock(rows, 'dry-run', asRole(roles)))).toBeInstanceOf(PermissionDenied);
    const denied = (await caught(importStock(rows, 'dry-run', asRole(['accounting', 'sales'])))) as PermissionDenied;
    expect(String(denied.details?.op)).toContain('stock_entry:receipt');
    for (const roles of [
      ['accounting', 'inventory', 'viewer'],
      ['accounting', 'purchasing'],
    ])
      expect((await importStock(rows, 'dry-run', asRole(roles))).summary.errors).toBe(0);
  });

  it('D-16: blank warehouse codes without a default warehouse refuse the request', async () => {
    const main = f.wh.main;
    await f.run({}, (ctx) => repo(ctx, Warehouse).update(main, { isDefault: false }));
    await f.run({}, (ctx) => setSetting(ctx, DEFAULT_WAREHOUSE_KEY, warehouseCodeSchema, 'NONE'));
    expect(await caught(importStock([{ productCode: 'A', quantity: '1', unitCost: '1' }], 'dry-run'))).toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(
      (await importStock([{ warehouseCode: 'MAIN', productCode: 'A', quantity: '1', unitCost: '1' }], 'dry-run'))
        .summary.errors,
    ).toBe(0);
    await f.run({}, (ctx) => setSetting(ctx, DEFAULT_WAREHOUSE_KEY, warehouseCodeSchema, 'MAIN'));
    await f.run({}, (ctx) => repo(ctx, Warehouse).update(main, { isDefault: true }));
  });

  it('AC-23 Q-5: more than 2,000 rows are a VALIDATION of the whole request', async () => {
    const rows = Array.from({ length: 2001 }, () => ({ productCode: 'A', quantity: '1', unitCost: '1' }));
    expect(await caught(importStock(rows, 'dry-run'))).toMatchObject({ code: 'VALIDATION' });
  });

  it('AC-7: a product code of another company is ref_not_found', async () => {
    const otherCompanyId = newId();
    await f.db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: f.db.tenantId, code: 'STX', name: '別会社' });
    await f.run({ companyId: otherCompanyId }, async (ctx) => {
      await seedUoms(ctx);
      await repo(ctx, Product).create({ code: 'XP', name: '他社品' });
    });
    expect(codesOf(await importStock([{ productCode: 'XP', quantity: '1', unitCost: '1' }], 'dry-run'))).toEqual([
      'ref_not_found',
    ]);
  });
});

describe('opening stock: receipts and valuation', () => {
  it('AC-24: one receipt per warehouse on the opening date, linked to the year; the unit cost starts the average', async () => {
    const result = await importStock([
      { warehouseCode: 'MAIN', productCode: 'A', quantity: '10', unitCost: '100.5' },
      { warehouseCode: 'sub', productCode: 'B', quantity: '3', unitCost: '0.333333' },
      { productCode: 'C', quantity: '2.5', unitCost: '40' },
    ]);
    expect(result).toMatchObject({ committed: true, issues: [] });
    expect(result.totals).toEqual({ quantity: '15.5', value: '1105.999999' });
    expect(result.documents).toHaveLength(2);
    const entries = (await openingEntries()).items;
    expect(entries.map((e) => [e.type, e.date, e.docstatus, e.warehouseId, e.note])).toEqual([
      ['receipt', OPENING, 1, f.wh.main, '期首在庫 FY2026'],
      ['receipt', OPENING, 1, f.wh.sub, '期首在庫 FY2026'],
    ]);
    expect(entries[0]?.number).toMatch(/^STK-2025-/);
    const balances = await f.run({}, (ctx) => repo(ctx, StockBalance).list({ limit: 50 }));
    const avg = Object.fromEntries(
      balances.items.map((b) => [`${b.productId}:${b.warehouseId}`, b.avgCost.toString()]),
    );
    expect(avg[`${f.product.a}:${f.wh.main}`]).toBe('100.5');
    expect(avg[`${f.product.b}:${f.wh.sub}`]).toBe('0.333333');
    expect(avg[`${f.product.c}:${f.wh.main}`]).toBe('40');
    const valuation = await f.act<Table>({}, 'inventory.valuation', { asOf: OPENING });
    expect(valuation.rows.map((r) => [r.productCode, r.qty, r.value])).toEqual([
      ['A', '10', '1005'],
      ['B', '3', '0.999999'],
      ['C', '2.5', '100'],
    ]);
    // an ordinary issue afterwards is costed at the opening average
    const issue = await f.run({}, async (ctx) => {
      const e = await repo(ctx, StockEntry).create({ type: 'issue', date: '2026-01-15', warehouseId: f.wh.main });
      await repo(ctx, StockEntryLine).create({ entryId: e.id, seq: 1, productId: f.product.a, quantity: '4' });
      await submitDocument(ctx, StockEntry, e.id);
      return (await repo(ctx, StockEntryLine).list({ where: { entryId: e.id } })).items[0];
    });
    expect(issue?.unitCost?.toString()).toBe('100.5');
  });

  it('AC-23: a product × warehouse with stock or later movements is stock_exists; another pair is accepted', async () => {
    const result = await importStock(
      [
        { warehouseCode: 'MAIN', productCode: 'A', quantity: '1', unitCost: '1' },
        { warehouseCode: 'SUB', productCode: 'A', quantity: '1', unitCost: '1' },
      ],
      'dry-run',
    );
    expect(codesOf(result)).toEqual(['stock_exists', 'ok']);
  });

  it('AC-23: a pair with zero balance but a ledger row after the opening date is stock_exists', async () => {
    const late = (
      await f.run({}, (ctx) =>
        repo(ctx, Product).create({ code: 'LATE', name: '期中に動いた品目', taxCategory: 'standard' }),
      )
    ).id;
    // received and fully issued in the year: the balance is 0 / 0, but later movements exist
    await f.run({}, async (ctx) => {
      for (const [type, quantity] of [
        ['receipt', '2'],
        ['issue', '2'],
      ] as const) {
        const e = await repo(ctx, StockEntry).create({ type, date: '2026-02-01', warehouseId: f.wh.main });
        await repo(ctx, StockEntryLine).create({
          entryId: e.id,
          seq: 1,
          productId: late,
          quantity,
          ...(type === 'receipt' ? { unitCost: '10' } : {}),
        });
        await submitDocument(ctx, StockEntry, e.id);
      }
    });
    const balance = await f.run({}, (ctx) =>
      repo(ctx, StockBalance).list({ where: { productId: late, warehouseId: f.wh.main } }),
    );
    expect(balance.items.map((b) => [b.qty.toString(), b.value.toString()])).toEqual([['0', '0']]);
    const result = await importStock(
      [
        { warehouseCode: 'MAIN', productCode: 'LATE', quantity: '1', unitCost: '1' },
        { warehouseCode: 'SUB', productCode: 'LATE', quantity: '1', unitCost: '1' },
      ],
      'dry-run',
    );
    expect(codesOf(result)).toEqual(['stock_exists', 'ok']);
  });

  it('AC-24: cancelling an opening receipt on the opening date allows the pair to be imported again', async () => {
    const sub = (await openingEntries()).items.find((e) => e.warehouseId === f.wh.sub) as { id: string };
    await f.act({}, 'stock_entry.cancel', { id: sub.id });
    const again = await importStock([{ warehouseCode: 'SUB', productCode: 'B', quantity: '4', unitCost: '2' }]);
    expect(again.committed).toBe(true);
  });

  it('AC-24: a fiscal_year source cannot be forged through the generic path, nor on a non-opening date', async () => {
    const created = await f.act<{ id: string; sourceEntity: string | null }>({}, 'stock_entry.create', {
      type: 'receipt',
      date: OPENING,
      sourceEntity: 'fiscal_year',
      sourceId: fyId,
    });
    expect(created.sourceEntity).toBeNull();
    // test-only capabilities stand in for the module's private ones to build a mis-dated linked receipt
    const ledger = defineWriteCapability({ name: 'test.ledger', entity: 'stock_ledger', operations: ['create'] });
    const link = defineWriteCapability({
      name: 'test.link',
      entity: 'stock_entry',
      fields: ['sourceEntity', 'sourceId'],
      operations: ['create'],
    });
    const err = await caught(
      f.run({}, async (ctx) => {
        const id = await withWriteCapability(ctx, ledger, (a) =>
          withWriteCapability(a, link, async (b) => {
            const e = await repo(b, StockEntry).create({
              type: 'receipt',
              date: '2026-02-01',
              warehouseId: f.wh.main,
              sourceEntity: 'fiscal_year',
              sourceId: fyId,
            });
            await repo(b, StockEntryLine).create({
              entryId: e.id,
              seq: 1,
              productId: f.product.c,
              quantity: '1',
              unitCost: '1',
            });
            return e.id;
          }),
        );
        return submitDocument(ctx, StockEntry, id);
      }),
    );
    expect(err).toMatchObject({ code: 'INVALID_STATE' });
    expect((err as Error).message).toContain('fiscal_year source');
  });
});

/** A new company of the test tenant with product OP, warehouse W1 and a first fiscal year starting 2027-01-01. */
async function stockCompany(): Promise<{ params: Partial<ContextParams>; fiscalYearId: string }> {
  const companyId = newId();
  await f.db.owner.drizzle
    .insert(companies)
    .values({ id: companyId, tenantId: f.db.tenantId, code: `I${companyId.slice(-8)}`, name: '在庫の会社' });
  const params = { companyId };
  await f.run(params, async (ctx) => {
    await seedUoms(ctx);
    await repo(ctx, Product).create({ code: 'OP', name: '期首品', taxCategory: 'standard' });
    await repo(ctx, Warehouse).create({ code: 'W1', name: '倉庫1' });
  });
  const year = await f.act<{ fiscalYear: { id: string } }>(params, 'accounting.open_fiscal_year', {
    startDate: '2027-01-01',
  });
  return { params, fiscalYearId: year.fiscalYear.id };
}

describe('opening stock: an earlier fiscal year (AC-4, D-19)', () => {
  it('AC-4: an earlier year cannot be opened over live opening stock receipts; after cancelling them it can', async () => {
    const { params, fiscalYearId } = await stockCompany();
    const imported = openingImportResult.parse(
      await f.act(params, 'inventory.import_opening_stock', {
        fiscalYearId,
        mode: 'execute',
        rows: [{ warehouseCode: 'W1', productCode: 'OP', quantity: '3', unitCost: '50' }],
      }),
    );
    expect(imported.committed).toBe(true);
    const receipt = imported.documents[0] as { id: string; number: string | null };
    for (const open of [
      () => f.act(params, 'accounting.open_fiscal_year', { startDate: '2026-01-01' }),
      () => f.act(params, 'fiscal_year.create', { code: 'FY2026G', startDate: '2026-01-01', endDate: '2026-12-31' }),
    ])
      expect(await caught(open())).toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'opening_stock_exists', receipts: [receipt.number] },
      });
    // D-19: cancel the opening receipt first (it is reversed on its own date, the opening date); then the year opens
    await f.act(params, 'stock_entry.cancel', { id: receipt.id });
    const earlier = await f.act<{ fiscalYear: { code: string } }>(params, 'accounting.open_fiscal_year', {
      startDate: '2026-01-01',
    });
    expect(earlier.fiscalYear.code).toBe('FY2026');
  });

  it('D-14 AC-4: an earlier year opened while opening stock is imported leaves no receipt behind', async () => {
    const { params, fiscalYearId } = await stockCompany();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markOpened!: () => void;
    const opened = new Promise<void>((resolve) => {
      markOpened = resolve;
    });
    // connection B opens FY2026 (it contains the opening date 2026-12-31) and stays uncommitted
    const earlier = f.run(params, async (ctx) => {
      await runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-01-01' });
      markOpened();
      await held;
    });
    await opened;
    // connection A imports opening stock of FY2027 meanwhile; B commits 1.5 s later
    const importing = f.act(params, 'inventory.import_opening_stock', {
      fiscalYearId,
      mode: 'execute',
      rows: [{ warehouseCode: 'W1', productCode: 'OP', quantity: '3', unitCost: '50' }],
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    release();
    await earlier;
    // A checks the year again under the period lock after its receipts, sees FY2026 and refuses the whole request
    expect(await caught(importing)).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'not_earliest' } });
    const receipts = await f.run(params, (ctx) => repo(ctx, StockEntry).count({ sourceEntity: 'fiscal_year' }));
    expect(receipts).toBe(0);
  });
});

describe('opening stock: chunks, concurrency, failures, closed valuation', () => {
  it('AC-24: more than 500 lines in one warehouse are split into receipts of 500', async () => {
    const codes = await f.run({}, async (ctx) => {
      const out: string[] = [];
      for (let i = 0; i < 501; i += 1) {
        const code = `BULK${String(i).padStart(3, '0')}`;
        await repo(ctx, Product).create({ code, name: `一括${i}`, taxCategory: 'standard' });
        out.push(code);
      }
      return out;
    });
    const before = (await openingEntries()).total;
    const result = await importStock(
      codes.map((c) => ({ warehouseCode: 'MAIN', productCode: c, quantity: '1', unitCost: '2' })),
    );
    expect(result.committed).toBe(true);
    expect(result.documents).toHaveLength(2);
    const lines = await f.run({}, async (ctx) =>
      Promise.all(result.documents.map((d) => repo(ctx, StockEntryLine).count({ entryId: d.id }))),
    );
    expect(lines).toEqual([500, 1]);
    expect((await openingEntries()).total).toBe(before + 2);
  });

  it('D-14 AC-23: two concurrent imports of the same pair receive it once; the other is stock_exists', async () => {
    const id = (
      await f.run({}, (ctx) => repo(ctx, Product).create({ code: 'RACE', name: '同時', taxCategory: 'standard' }))
    ).id;
    const rows = [{ warehouseCode: 'MAIN', productCode: 'RACE', quantity: '1', unitCost: '1' }];
    const settled = await Promise.allSettled([importStock(rows), importStock(rows)]);
    const values = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    expect(values.filter((v) => v.committed)).toHaveLength(1);
    expect(values.find((v) => !v.committed)?.rows[0]?.messages?.[0]?.code).toBe('stock_exists');
    const balance = await f.run({}, (ctx) => repo(ctx, StockBalance).list({ where: { productId: id } }));
    expect(balance.items.map((b) => b.qty.toString())).toEqual(['1']);
  });

  it('D-15: a receipt the database rejects is an issue submit_failed naming the warehouse', async () => {
    const result = await importStock([
      { warehouseCode: 'SUB', productCode: 'C', quantity: '999999999999999', unitCost: '1' },
    ]);
    expect(result.committed).toBe(false);
    expect(result.issues[0]).toMatchObject({ code: 'submit_failed' });
    expect(result.issues[0]?.message).toContain('SUB receipt 1');
  });

  it('AC-23: a valuation closed through the opening date refuses the whole request', async () => {
    await f.run({}, (ctx) => closeInventoryThrough(ctx, OPENING, { entity: 'test', id: newId() }));
    expect(
      await caught(importStock([{ warehouseCode: 'SUB', productCode: 'C', quantity: '1', unitCost: '1' }], 'dry-run')),
    ).toMatchObject({ code: 'INVALID_STATE' });
  });
});
