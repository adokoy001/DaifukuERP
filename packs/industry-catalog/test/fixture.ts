import {
  registerCrudActions,
  registerPackActions,
  runAction,
  systemParams,
  withContext,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { JapanModule } from '@daifuku/l10n-jp';
import { AccountingModule } from '@daifuku/mod-accounting';
import { IndustryOperationsModule } from '@daifuku/mod-industry-operations';
import { InventoryModule } from '@daifuku/mod-inventory';
import { PartnerModule } from '@daifuku/mod-partner';
import { PaymentModule } from '@daifuku/mod-payment';
import { ProductModule } from '@daifuku/mod-product';
import { SalesModule } from '@daifuku/mod-sales';
import { TaxModule } from '@daifuku/mod-tax';
import { INDUSTRY_PACK_NAMES, loadIndustryPack, sampleReference } from '../src/index.ts';
for (const name of INDUSTRY_PACK_NAMES) loadIndustryPack(name);
export type Row = Record<string, unknown>;
export type Doc = Row & {
  id: string;
  version: number;
  docstatus: number;
  salesInvoiceId?: string;
  total: string;
  date: string;
  partnerId: string;
  productId: string;
};
export type List = { items: Doc[]; total: number };
export type Table = { rows: Row[]; totals: Record<string, string>; meta: Row };
export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required test fixture missing');
  return value;
}
export const NOW = new Date('2026-09-12T03:00:00Z');
export interface Scenario {
  db: TestDb;
  run<T>(fn: (ctx: Context) => Promise<T>, params?: Partial<ContextParams>): Promise<T>;
  act<T = Doc>(name: string, input: unknown, params?: Partial<ContextParams>): Promise<T>;
  sample(name: string): Promise<Doc>;
}
export async function seedModules(db: TestDb, companyId = db.companyId): Promise<void> {
  for (const module of [
    PartnerModule,
    ProductModule,
    TaxModule,
    AccountingModule,
    SalesModule,
    PaymentModule,
    InventoryModule,
    JapanModule,
    IndustryOperationsModule,
  ])
    await withContext(db.owner, systemParams(db.tenantId, companyId, { now: () => NOW }), async (ctx) =>
      module.seed?.(ctx),
    );
}
export async function setup(): Promise<Scenario> {
  registerCrudActions();
  registerPackActions();
  const db = await freshDb();
  const run: Scenario['run'] = (fn, params = {}) => db.run({ now: () => NOW, ...params }, fn);
  const act: Scenario['act'] = (name, input, params) => run((ctx) => runAction(ctx, name, input), params) as never;
  await seedModules(db);
  return {
    db,
    run,
    act,
    sample: async (name) => {
      const row = (await act<List>(`${name}_job.list`, { where: { reference: sampleReference(name) } })).items[0];
      if (!row) throw new Error(`Missing sample ${name}`);
      return row;
    },
  };
}
export const COMPLETION: Record<string, { quantity: string; patch: Row }> = {
  wholesale: { quantity: '10', patch: { deliveryProof: 'POD-001' } },
  manufacturing: { quantity: '8', patch: { rejectedQuantity: '2', inspectionReference: 'INSPECT-001' } },
  construction: { quantity: '1', patch: { completionPercent: 100, inspectionReference: 'ACCEPT-001' } },
  logistics: { quantity: '1', patch: { deliveredPackages: 6, deliveryProof: 'POD-002' } },
  hospitality: { quantity: '2', patch: { checkoutConfirmation: 'CHECKOUT-001' } },
  clinic: { quantity: '9', patch: { administrationConfirmation: 'ADMIN-001' } },
  care_service: { quantity: '1.75', patch: { completionSigner: '家族確認記録-001（架空）' } },
  education: { quantity: '11', patch: { attendanceConfirmation: 'CLASS-001' } },
  professional_service: { quantity: '7.5', patch: { acceptanceReference: 'CLIENT-001' } },
  beauty_salon: { quantity: '1', patch: { serviceConfirmation: 'SALON-001' } },
};
export async function finish(s: Scenario, name: string, job: Doc): Promise<Doc> {
  const info = must(COMPLETION[name]);
  await s.act(`${name}_job.update`, { id: job.id, patch: info.patch });
  return s.act(`${name}.complete_job`, {
    jobId: job.id,
    completedDate: '2026-09-14',
    completedQuantity: info.quantity,
    completionNote: '契約どおりの履行と相手方確認を記録（サンプル）',
  });
}
