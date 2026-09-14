import { Decimal } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INDUSTRY_PROFILES, WHOLESALE_RECEIPT_NOTE } from '../src/index.ts';
import { COMPLETION, finish, must, setup, type Doc, type List, type Scenario, type Table } from './fixture.ts';
let s: Scenario;
beforeAll(async () => {
  s = await setup();
});
afterAll(async () => {
  await s?.db.close();
});
async function receiveStock(): Promise<void> {
  const stock = must((await s.act<List>('stock_entry.list', { where: { note: WHOLESALE_RECEIPT_NOTE } })).items[0]);
  expect(stock.docstatus).toBe(0);
  await s.act('stock_entry.submit', { id: stock.id });
}
async function pay(invoice: Doc): Promise<Doc> {
  const created = await s.act('payment.create', {
    direction: 'receive',
    partnerId: invoice.partnerId,
    date: '2026-09-16',
    amount: invoice.total,
    method: 'cash',
    lines: { payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId: invoice.id, amount: invoice.total }] },
  });
  return s.act('payment.submit', { id: created.id });
}
async function checkCancel(name: string, job: Doc, invoice: Doc): Promise<void> {
  const payment = await pay(invoice);
  await expect(s.act(`${name}_job.cancel`, { id: job.id, correctionDate: '2026-09-20' })).rejects.toMatchObject({
    code: 'INVALID_STATE',
  });
  expect(await s.act(`${name}_job.get`, { id: job.id })).toMatchObject({
    docstatus: 1,
    status: 'completed',
    cancelledDate: null,
  });
  expect(await s.act('sales_invoice.get', { id: invoice.id })).toMatchObject({
    docstatus: 1,
    paidAmount: invoice.total,
  });
  await s.act('payment.cancel', { id: payment.id, correctionDate: '2026-09-20' });
  await expect(s.act(`${name}_job.cancel`, { id: job.id, correctionDate: '2026-09-13' })).rejects.toMatchObject({
    code: 'VALIDATION',
  });
  await s.act(`${name}_job.cancel`, { id: job.id, correctionDate: '2026-09-20' });
  expect(await s.act('sales_invoice.get', { id: invoice.id })).toMatchObject({
    docstatus: 2,
    cancelledDate: '2026-09-20',
    paidAmount: '0',
  });
  const report = (asOf: string) => s.act<Table>(`${name}.job_summary`, { from: '2026-09-01', to: '2026-09-14', asOf });
  expect((await report('2026-09-19')).rows).toHaveLength(1);
  expect((await report('2026-09-20')).totals).toEqual({ quantity: '0', amount: '0' });
  await expect(s.act(`${name}.invoice_job`, { jobId: job.id })).rejects.toMatchObject({ code: 'INVALID_STATE' });
}
describe('15-industry catalog: ten distinct fulfillment -> invoice -> payment scenarios', () => {
  for (const profile of INDUSTRY_PROFILES)
    it(`${profile.job.name}: normal UI sample apply, completion conditions, posting and dated cancellation`, async () => {
      const name = profile.job.name;
      const entity = `${name}_job`;
      await expect(s.act<List>(`${entity}.list`, {})).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(s.act(`${name}.start_job`, { jobId: s.db.adminUserId })).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
      await s.act('pack.apply', { name, sample: true }); // no force; core seed settings already exist
      let job = await s.sample(name);
      expect(job).toMatchObject({
        docstatus: 0,
        status: 'queued',
        completedQuantity: '0',
        quotedAmount: Decimal.from(profile.orderedQuantity).times(profile.unitPrice).toString(),
      });
      await expect(s.act(`${entity}.submit`, { id: job.id })).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(s.act(`${name}.invoice_job`, { jobId: job.id })).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(s.act(`${entity}.update`, { id: job.id, patch: { status: 'completed' } })).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
      job = await s.act(`${name}.start_job`, { jobId: job.id });
      await expect(
        s.act(`${name}.complete_job`, {
          jobId: job.id,
          completedDate: '2026-09-14',
          completedQuantity: must(COMPLETION[name]).quantity,
          completionNote: '証跡未入力',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await s.act('pack.apply', { name, force: true, sample: true });
      expect(await s.sample(name)).toMatchObject({ id: job.id, status: 'in_progress', docstatus: 0 });
      expect((await s.act<List>(`${entity}.list`, {})).total).toBe(1);
      job = await finish(s, name, job);
      expect(job).toMatchObject({
        docstatus: 1,
        status: 'completed',
        completedQuantity: must(COMPLETION[name]).quantity,
      });
      await expect(s.act(`${entity}.update`, { id: job.id, patch: { unitPrice: '1' } })).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
      if (name === 'wholesale') await receiveStock();
      const invoices = await Promise.all([
        s.act(`${name}.invoice_job`, { jobId: job.id, date: '2026-09-15' }),
        s.act(`${name}.invoice_job`, { jobId: job.id, date: '2026-09-15' }),
      ]);
      const invoice = must(invoices[0]);
      expect(must(invoices[1]).id).toBe(invoice.id);
      const net = Decimal.from(must(COMPLETION[name]).quantity).times(profile.unitPrice);
      expect(invoice).toMatchObject({
        docstatus: 1,
        total: net.times('1.1').toString(),
        dueDate: name === 'wholesale' ? '2026-10-30' : profile.job.dueDays === 0 ? '2026-09-15' : '2026-10-15',
      });
      const report = await s.act<Table>(`${name}.job_summary`, {
        from: '2026-09-01',
        to: '2026-09-14',
        asOf: '2026-09-15',
      });
      expect(report.totals).toEqual({ quantity: must(COMPLETION[name]).quantity, amount: net.toString() });
      expect(report.meta.accountingRevenue).toBe(false);
      await checkCancel(name, job, invoice);
    });
});
