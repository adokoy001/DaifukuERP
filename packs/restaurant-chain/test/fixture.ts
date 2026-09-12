import { registerCrudActions, registerPackActions, runAction, systemParams, withContext, type Context, type ContextParams } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { JapanModule } from '@daifuku/l10n-jp';
import { AccountingModule } from '@daifuku/mod-accounting';
import { InventoryModule } from '@daifuku/mod-inventory';
import { PartnerModule } from '@daifuku/mod-partner';
import { PaymentModule } from '@daifuku/mod-payment';
import { ProductModule } from '@daifuku/mod-product';
import { PurchaseModule } from '@daifuku/mod-purchase';
import { SalesModule } from '@daifuku/mod-sales';
import { TaxModule } from '@daifuku/mod-tax';
import { RestaurantChainPack } from '../src/index.ts';

export type Row = Record<string, unknown> & { id: string };
export type Page = { items: Row[]; total: number };
export interface Fixture {
  db: TestDb;
  run<T>(fn: (ctx: Context) => Promise<T>, params?: Partial<ContextParams>): Promise<T>;
  act<T = Row>(name: string, input: unknown, params?: Partial<ContextParams>): Promise<T>;
  ids: Record<string, string>;
}
const now = () => new Date('2026-09-30T03:00:00Z');
export async function setup(): Promise<Fixture> {
  if (RestaurantChainPack.name !== 'restaurant_chain') throw new TypeError('Pack not registered');
  registerCrudActions(); registerPackActions();
  const db = await freshDb();
  const run: Fixture['run'] = (fn, params = {}) => db.run({ now, ...params }, fn);
  const act: Fixture['act'] = (name, input, params = {}) => run((ctx) => runAction(ctx, name, input), params) as never;
  const s: Fixture = { db, run, act, ids: {} };
  await act('accounting.open_fiscal_year', { startDate: '2026-01-01' });
  for (const m of [PartnerModule, ProductModule, TaxModule, AccountingModule, SalesModule, PurchaseModule, PaymentModule, InventoryModule, JapanModule]) {
    if (m.seed) await withContext(db.owner, systemParams(db.tenantId, db.companyId, { now }), async (ctx) => m.seed?.(ctx));
  }
  // Exactly the normal template UI route: sample true, no force, all module defaults already stored.
  await act('pack.apply', { name: 'restaurant_chain', sample: true });
  for (const entity of ['product', 'restaurant_chain_store', 'restaurant_chain_recipe', 'account']) {
    const page = await act<Page>(`${entity}.list`, { limit: 500 });
    for (const row of page.items) s.ids[String(row.code)] = row.id;
  }
  return s;
}
export async function stock(s: Fixture, code: string, rice = '10', chicken = '5'): Promise<Row> {
  const store = await s.act('restaurant_chain_store.get', { id: s.ids[code] });
  const entry = await s.act('stock_entry.create', { type: 'receipt', warehouseId: store.warehouseId, date: '2026-09-01', lines: { stock_entry_line: [
    { productId: s.ids['RC-RICE'], quantity: rice, unitCost: '500' },
    { productId: s.ids['RC-CHICKEN'], quantity: chicken, unitCost: '1000' },
  ] } });
  return s.act('stock_entry.submit', { id: entry.id });
}
export async function closing(s: Fixture, code = 'RC-A', patch: Record<string, unknown> = {}): Promise<Row> {
  return s.act('restaurant_chain_closing.create', { storeId: s.ids[code], date: '2026-09-12', cashAmount: '10000', cardAmount: '5000', qrAmount: '1400', lines: {
    restaurant_chain_closing_line: [
      { recipeId: s.ids['RC-CURRY-V1'], serviceMode: 'dine_in', quantity: '10' },
      { recipeId: s.ids['RC-CURRY-V1'], serviceMode: 'takeaway', quantity: '5', unitPrice: '1080' },
    ],
    restaurant_chain_waste_line: [{ productId: s.ids['RC-RICE'], quantity: '0.1', reason: 'spoilage' }],
  }, ...patch });
}
export const submit = (s: Fixture, row: Row) => s.act('restaurant_chain_closing.submit', { id: row.id, expectedVersion: row.version });
