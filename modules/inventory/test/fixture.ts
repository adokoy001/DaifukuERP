// Shared Postgres fixture for the inventory DB tests (daifuku_test_inventory via TEST_DATABASE_URL*). Importing
// ../src/index.ts registers inventory and its dependencies (partner, product, tax, accounting, sales, purchase); freshDb
// builds the schema from the registry. Seeds: fiscal year 2026, the sales/purchase posting accounts, tax rates (rows
// through the kernel registry: mod-tax is not a dependency of this package), units, products, partners, warehouses.
import {
  newId,
  registerCrudActions,
  registry,
  repo,
  runAction,
  type Context,
  type ContextParams,
  type EntityDef,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account, openFiscalYear } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { Product, seedUoms } from '@daifuku/mod-product';
import { InventoryModule, Warehouse, seedWarehouses } from '../src/index.ts';

/** 2026-09-10 12:00 JST. */
export const FIXED_NOW = new Date('2026-09-10T03:00:00Z');

export type Row = Record<string, unknown>;
export type Table = {
  title: { ja: string; en: string };
  columns: { key: string; kind: string; ref?: string }[];
  rows: Row[];
  totals?: Record<string, string>;
  meta?: Row;
};
export type EntryLineJson = Row & {
  id: string;
  seq: number;
  productId: string;
  quantity: string;
  sign: string | null;
  unitCost: string | null;
  amount: string;
};
export type EntryJson = Row & {
  id: string;
  number: string | null;
  docstatus: number;
  type: string;
  date: string;
  warehouseId: string;
  toWarehouseId: string | null;
  sourceEntity: string | null;
  sourceId: string | null;
  amendedFrom: string | null;
};
export type EntryWithLines = EntryJson & { lines: { stock_entry_line: EntryLineJson[] } };

export const asRole = (roles: string[]): Partial<ContextParams> => ({
  roles,
  actor: { type: 'user' as const, id: newId() },
});
export const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
export const issuesOf = (e: unknown) =>
  ((e as { details?: { issues?: { path: string; message: string }[] } }).details?.issues ?? []).map((i) => i.path);

export interface Fixture {
  db: TestDb;
  run<T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>): Promise<T>;
  /** runAction with the given roles/context params (admin by default). */
  act<T>(params: Partial<ContextParams>, name: string, input: unknown): Promise<T>;
  acc: Record<'1300' | '4000' | '2200' | '5000' | '2100' | '1500' | '6400', string>;
  product: { a: string; b: string; c: string; food: string; svc: string };
  partner: { customer: string; supplier: string };
  wh: { main: string; sub: string };
}

async function seedAccounts(run: Fixture['run']): Promise<Fixture['acc']> {
  const account = (code: string, name: string, type: 'asset' | 'liability' | 'revenue' | 'expense', extra: Row = {}) =>
    run({}, async (ctx) => (await repo(ctx, Account).create({ code, name, type, ...extra })).id);
  return {
    '1300': await account('1300', '売掛金', 'asset', { subtype: '売掛金', partnerRequired: true }),
    '4000': await account('4000', '売上高', 'revenue', { subtype: '売上' }),
    '2200': await account('2200', '仮受消費税', 'liability', { subtype: '仮受消費税' }),
    '5000': await account('5000', '仕入高', 'expense', { subtype: '仕入' }),
    '2100': await account('2100', '買掛金', 'liability', { subtype: '買掛金', partnerRequired: true }),
    '1500': await account('1500', '仮払消費税', 'asset', { subtype: '仮払消費税' }),
    '6400': await account('6400', '消耗品費', 'expense', { subtype: '販管費', taxCategoryDefault: 'standard' }),
  };
}

export async function setupFixture(): Promise<Fixture> {
  registerCrudActions();
  const db = await freshDb();
  const run: Fixture['run'] = (params, fn) => db.run({ now: () => FIXED_NOW, ...params }, fn);
  const act: Fixture['act'] = (params, name, input) => run(params, (ctx) => runAction(ctx, name, input)) as never;
  await run({}, (ctx) => openFiscalYear(ctx, { startDate: '2026-01-01' }));
  const acc = await seedAccounts(run);
  const taxRate = registry.entity('tax_rate') as EntityDef;
  await run({}, async (ctx) => {
    await repo(ctx, taxRate).create({
      code: 'STD10',
      category: 'standard',
      rate: '0.10',
      validFrom: '2019-10-01',
      label: '標準10%',
    } as never);
    await repo(ctx, taxRate).create({
      code: 'RED8',
      category: 'reduced',
      rate: '0.08',
      validFrom: '2019-10-01',
      label: '軽減8%',
    } as never);
    await seedUoms(ctx);
    await seedWarehouses(ctx);
    await seedWarehouses(ctx); // idempotent
  });
  const productOf = (code: string, name: string, extra: Row = {}) =>
    run(
      {},
      async (ctx) =>
        (
          await repo(ctx, Product).create({
            code,
            name,
            taxCategory: 'standard',
            salePrice: '200',
            purchasePrice: '100',
            ...extra,
          })
        ).id,
    );
  const product = {
    a: await productOf('A', '商品A'),
    b: await productOf('B', '商品B'),
    c: await productOf('C', '商品C'),
    food: await productOf('F', '食品F', { taxCategory: 'reduced' }),
    svc: await productOf('S', '設置作業', { kind: 'service' }),
  };
  const partner = {
    customer: (await run({}, (ctx) => repo(ctx, Partner).create({ name: '得意先A', isCustomer: true }))).id,
    supplier: (await run({}, (ctx) => repo(ctx, Partner).create({ name: '仕入先S', isSupplier: true }))).id,
  };
  const main = await run(
    {},
    async (ctx) => (await repo(ctx, Warehouse).list({ where: { code: 'MAIN' }, limit: 1 })).items[0]?.id ?? '',
  );
  const sub = (await run({}, (ctx) => repo(ctx, Warehouse).create({ code: 'sub', name: '第二倉庫' }))).id;
  if (InventoryModule.name !== 'inventory' || !main)
    throw new TypeError('inventory fixture: module or MAIN warehouse missing');
  return { db, run, act, acc, product, partner, wh: { main, sub } };
}
