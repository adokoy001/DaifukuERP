import { getSetting, newId, setSetting } from '@daifuku/kernel';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INDUSTRY_PROFILES, WHOLESALE_RECEIPT_NOTE } from '../src/index.ts';
import {
  finish,
  must,
  seedModules,
  setup,
  type Doc,
  type List,
  type Row,
  type Scenario,
  type Table,
} from './fixture.ts';
let s: Scenario;
beforeAll(async () => {
  s = await setup();
  for (const profile of INDUSTRY_PROFILES) await s.act('pack.apply', { name: profile.job.name, sample: true });
});
afterAll(async () => {
  await s?.db.close();
});
async function copy(name: string, patch: Row = {}): Promise<Doc> {
  const row = await s.sample(name),
    profile = must(INDUSTRY_PROFILES.find((p) => p.job.name === name));
  return s.act(`${name}_job.create`, {
    title: '境界確認',
    partnerId: row.partnerId,
    productId: row.productId,
    date: '2026-09-12',
    orderedQuantity: profile.orderedQuantity,
    unitPrice: profile.unitPrice,
    taxCategory: 'standard',
    ...profile.sample('2026-09-12'),
    ...patch,
  });
}
const BAD: Record<string, Row> = {
  wholesale: { orderedQuantity: '0.5' },
  manufacturing: { rejectedQuantity: '0.5' },
  construction: { orderedQuantity: '2' },
  logistics: { deliveredPackages: 7 },
  hospitality: { departureDate: '2026-09-11' },
  clinic: { orderedQuantity: '0.5' },
  care_service: { orderedQuantity: '1.1' },
  education: { capacity: 2 },
  professional_service: { orderedQuantity: '0.01' },
  beauty_salon: { orderedQuantity: '2' },
};
describe('industry catalog foundation: scope, rollback, units and report coverage', () => {
  for (const name of Object.keys(BAD))
    it(`${name}: rejects an industry-specific invalid quantity / period`, async () => {
      await expect(copy(name, BAD[name])).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  it('keeps samples draft-only, preserves company settings, and refuses forged state / units', async () => {
    expect((await s.act<List>('sales_invoice.list', {})).total).toBe(0);
    expect((await s.act<List>('journal_entry.list', {})).total).toBe(0);
    expect((await s.act<List>('stock_ledger.list', {})).total).toBe(0);
    await s.run((ctx) => setSetting(ctx, 'beauty_salon.due_days', z.number().int().min(0).max(365), 7));
    await s.act('pack.apply', { name: 'beauty_salon', sample: true });
    expect(await s.run((ctx) => getSetting(ctx, 'beauty_salon.due_days', z.number(), 0))).toBe(7);
    const service = await s.sample('beauty_salon');
    await expect(copy('wholesale', { productId: service.productId })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(copy('professional_service', { productId: service.productId })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    for (const field of ['quotedAmount', 'completedAmount', 'unitCode', 'salesInvoiceId', 'cancelledDate', 'startedAt'])
      await expect(copy('beauty_salon', { [field]: field.endsWith('Id') ? newId() : '1' })).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    await expect(copy('beauty_salon', { completedDate: '2026-09-11' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('calculates omitted default quantity and preserves it on update; an unfulfilled draft can be withdrawn', async () => {
    const source = await s.sample('beauty_salon');
    const job = await s.act('beauty_salon_job.create', {
      title: '既定数量',
      partnerId: source.partnerId,
      productId: source.productId,
      date: '2026-09-12',
      unitPrice: '1200',
      taxCategory: 'standard',
      menu: 'cut',
      stylist: 'A',
    });
    expect(job).toMatchObject({
      orderedQuantity: '1',
      completedQuantity: '0',
      quotedAmount: '1200',
      completedAmount: '0',
    });
    expect(await s.act('beauty_salon_job.update', { id: job.id, patch: { unitPrice: '1500' } })).toMatchObject({
      orderedQuantity: '1',
      quotedAmount: '1500',
    });
    await s.act('beauty_salon.start_job', { jobId: job.id });
    await s.act('beauty_salon_job.delete', { id: job.id });
    await expect(s.act('beauty_salon_job.get', { id: job.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rolls back the invoice and all postings when wholesale stock is unavailable', async () => {
    const job = await copy('wholesale');
    await s.act('wholesale.start_job', { jobId: job.id });
    await finish(s, 'wholesale', job);
    await expect(s.act('wholesale.invoice_job', { jobId: job.id })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await s.act('wholesale_job.get', { id: job.id })).toMatchObject({ docstatus: 1, salesInvoiceId: null });
    expect((await s.act<List>('sales_invoice.list', {})).total).toBe(0);
    expect((await s.act<List>('journal_entry.list', {})).total).toBe(0);
    expect((await s.act<List>('stock_entry.list', { where: { note: WHOLESALE_RECEIPT_NOTE } })).total).toBe(1);
    expect((await s.act<List>('stock_ledger.list', {})).total).toBe(0);
  });
  it('rejects generic submit without completion proof and stale versions; preserves forced samples after completion', async () => {
    const job = await s.sample('clinic');
    await s.act('clinic.start_job', { jobId: job.id });
    await expect(s.act('clinic.start_job', { jobId: job.id, expectedVersion: job.version })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(s.act('clinic_job.submit', { id: job.id })).rejects.toMatchObject({ code: 'VALIDATION' });
    const completed = await finish(s, 'clinic', job);
    await s.act('pack.apply', { name: 'clinic', force: true, sample: true });
    expect(await s.sample('clinic')).toMatchObject({
      id: job.id,
      version: completed.version,
      docstatus: 1,
      status: 'completed',
      completedQuantity: '9',
    });
    await expect(
      s.act('clinic_job.update', { id: job.id, patch: { administrationConfirmation: '改ざん' } }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('blocks independent generated-invoice cancellation and amendment drops generated identity', async () => {
    const job = await copy('beauty_salon');
    await s.act('beauty_salon.start_job', { jobId: job.id });
    await finish(s, 'beauty_salon', job);
    const invoice = await s.act('beauty_salon.invoice_job', { jobId: job.id });
    await expect(s.act('sales_invoice.cancel', { id: invoice.id, correctionDate: '2026-09-16' })).rejects.toMatchObject(
      { code: 'HAS_DEPENDENTS' },
    );
    await expect(s.act('beauty_salon_job.cancel', { id: job.id, correctionDate: '2026-09-13' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await s.act('beauty_salon_job.cancel', { id: job.id, correctionDate: '2026-09-16' });
    const amended = await s.act('beauty_salon_job.amend', { id: job.id });
    expect(amended).toMatchObject({
      docstatus: 0,
      status: 'queued',
      salesInvoiceId: null,
      cancelledDate: null,
      startedAt: null,
    });
  });
  it('isolates every industry by company and rejects cross-company references, viewers and employee/store scopes', async () => {
    const companyId = newId();
    await s.db.owner
      .sql`insert into companies(id, tenant_id, code, name) values (${companyId}, ${s.db.tenantId}, 'IND-B', 'Catalog B')`;
    await seedModules(s.db, companyId);
    for (const profile of INDUSTRY_PROFILES) {
      const name = profile.job.name,
        job = await s.sample(name);
      await s.act('pack.apply', { name }, { companyId });
      expect((await s.act<List>(`${name}_job.list`, {}, { companyId })).total).toBe(0);
      await expect(s.act(`${name}_job.get`, { id: job.id }, { companyId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(s.act(`${name}.start_job`, { jobId: job.id }, { roles: ['viewer'] })).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
      await expect(
        s.act(
          `${name}.job_summary`,
          { from: '2026-09-01', to: '2026-09-14', asOf: '2026-09-14' },
          { accessScope: 'stores', storeIds: [newId()], roles: ['chain_manager'] },
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(s.act(`${name}_job.list`, {}, { roles: ['employee'] })).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    }
    const job = await s.sample('clinic');
    await expect(
      s.act(
        'clinic_job.create',
        {
          title: '別会社参照',
          partnerId: job.partnerId,
          productId: job.productId,
          date: '2026-09-12',
          orderedQuantity: '1',
          unitPrice: '1',
          taxCategory: 'standard',
        },
        { companyId },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('reads all 501 history rows and rejects a period later than the cancellation cutoff', async () => {
    const job = await s.sample('beauty_salon');
    // Bulk fixture only: complete source records, no generated accounting documents or rows changed outside this test DB.
    await s.db.owner
      .sql`insert into beauty_salon_job (id, tenant_id, company_id, title, partner_id, product_id, date, unit_price, ordered_quantity, completed_quantity, completed_amount, quoted_amount, unit_code, tax_category, status, docstatus, completed_date, completion_note, menu, stylist, service_confirmation)
      select gen_random_uuid(), ${s.db.tenantId}, ${s.db.companyId}, '集計行', ${job.partnerId}, ${job.productId}, '2026-09-21', 1000, 1, 1, 1000, 1000, 'IO-JOB', 'standard', 'completed', 1, '2026-09-21', '確認済み', 'cut', 'A', 'confirmed' from generate_series(1,501)`;
    const report = await s.act<Table>('beauty_salon.job_summary', {
      from: '2026-09-21',
      to: '2026-09-21',
      asOf: '2026-09-21',
    });
    expect(report.rows).toHaveLength(501);
    expect(report.totals).toEqual({ quantity: '501', amount: '501000' });
    await expect(
      s.act('beauty_salon.job_summary', { from: '2026-09-01', to: '2026-09-22', asOf: '2026-09-21' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
