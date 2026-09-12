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
import { FarmPack } from '../src/index.ts';
export type Row = Record<string, unknown>;
export type Doc = Row & { id: string; docstatus: number; stockEntryId?: string };
export type List = { items: Doc[]; total: number };
export type Table = { rows: Row[]; totals: Record<string, string>; meta: Row };
export const NOW = new Date('2026-11-30T03:00:00Z');
export interface Scenario {
  db: TestDb;
  run<T>(fn: (ctx: Context) => Promise<T>, params?: Partial<ContextParams>): Promise<T>;
  act<T = Doc>(name: string, input: unknown, params?: Partial<ContextParams>): Promise<T>;
  id(entity: string, field: string, value: string): Promise<string>;
  submit(entity: string, input: Row): Promise<Doc>;
}
export async function setup(sample = true): Promise<Scenario> {
  registerCrudActions(); registerPackActions();
  const db = await freshDb();
  const run: Scenario['run'] = (fn, params = {}) => db.run({ now: () => NOW, ...params }, fn);
  const act: Scenario['act'] = (name, input, params) => run((ctx) => runAction(ctx, name, input), params) as never;
  for (const module of [PartnerModule, ProductModule, TaxModule, AccountingModule, SalesModule, PurchaseModule, PaymentModule, InventoryModule, JapanModule]) {
    await withContext(db.owner, systemParams(db.tenantId, db.companyId, { now: () => NOW }), async (ctx) => module.seed?.(ctx));
  }
  await act('pack.apply', { name: FarmPack.name, sample });
  return {
    db, run, act,
    id: async (entity, field, value) => {
      const row = (await act<List>(`${entity}.list`, { where: { [field]: value }, limit: 1 })).items[0];
      if (!row) throw new Error(`Missing fixture ${entity}.${field}=${value}`);
      return row.id;
    },
    submit: async (entity, input) => { const draft = await act(`${entity}.create`, input); return act(`${entity}.submit`, { id: draft.id }); },
  };
}
export async function sampleIds(s: Scenario) {
  return {
    seasonId: await s.id('farm_season', 'sampleKey', 'farm.demo.2026.tomato'),
    workId: await s.id('farm_work', 'sampleKey', 'farm.demo.2026.work'),
    harvestId: await s.id('farm_harvest', 'sampleKey', 'farm.demo.2026.harvest'),
    warehouseId: await s.id('warehouse', 'code', 'FARM'),
    tomatoId: await s.id('product', 'code', 'FARM-DEMO-TOMATO'),
    materialId: await s.id('product', 'code', 'FARM-DEMO-MATERIAL'),
    customerId: await s.id('partner', 'code', 'FARM-DEMO-BUYER'),
    supplierId: await s.id('partner', 'code', 'FARM-DEMO-SUPPLIER'),
  };
}
