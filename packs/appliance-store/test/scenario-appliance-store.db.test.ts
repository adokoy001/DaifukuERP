import { appMeta, getLines, repo, type TableResult } from '@daifuku/kernel';
import { JournalEntry } from '@daifuku/mod-accounting';
import { StockBalance } from '@daifuku/mod-inventory';
import { Product } from '@daifuku/mod-product';
import { SalesInvoice } from '@daifuku/mod-sales';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApplianceDevice, ApplianceService, ApplianceServiceLine } from '../src/index.ts';
import { DATE, setup, type Fixture, type Row } from './fixture.ts';

let s: Fixture;
beforeEach(async () => {
  s = await setup();
});
afterEach(async () => {
  await s?.db.close();
});

describe('appliance store executable scenario', () => {
  it('AC-1/6/7 applies scoped metadata and idempotent masters, samples and settings', async () => {
    const before = await s.run(async (ctx) => ({
      product: await repo(ctx, Product).list({ where: { code: { $like: 'APP-%' } } }),
      devices: await repo(ctx, ApplianceDevice).list(),
      jobs: await repo(ctx, ApplianceService).list(),
    }));
    expect(before.product.total).toBe(4);
    expect(before.devices.total).toBe(2);
    expect(before.jobs.total).toBe(2);
    expect(await s.act('pack.apply', { name: 'appliance_store', sample: true })).toMatchObject({
      alreadyApplied: true,
    });
    await s.act('pack.apply', { name: 'appliance_store', sample: true, force: true });
    const after = await s.run(async (ctx) => ({
      product: await repo(ctx, Product).list({ where: { code: { $like: 'APP-%' } } }),
      devices: await repo(ctx, ApplianceDevice).list(),
      jobs: await repo(ctx, ApplianceService).list(),
    }));
    expect(after).toEqual(before);
    const meta = await s.run((ctx) => Promise.resolve(appMeta(ctx, { appliedPacks: ['appliance_store'] })));
    expect(JSON.stringify(meta)).toContain('applianceWarrantyMonths');
    expect(JSON.stringify(meta.modules)).toContain('/a/appliance_store.complete_service');
    const report = await s.act<TableResult>('appliance_store.open_services', { asOf: '2026-12-11' });
    expect(report.rows).toHaveLength(2);
    expect(report.rows.every((row) => row.overdue === true)).toBe(true);
  });

  it('AC-2/3/4 runs repair through completion and bills exactly once under concurrent retries', async () => {
    const completed = await s.complete();
    expect(completed).toMatchObject({ docstatus: 1, status: 'completed', completedDate: DATE });
    const pending = await s.act<TableResult>('appliance_store.open_services', {});
    expect(pending.rows.find((row) => row.serviceId === completed.id)?.status).toBe('請求待ち');
    const invoices = await Promise.all([
      s.act('appliance_store.invoice_service', { serviceId: completed.id }),
      s.act('appliance_store.invoice_service', { serviceId: completed.id }),
    ]);
    expect(invoices[0]?.id).toBe(invoices[1]?.id);
    expect(invoices[0]).toMatchObject({
      docstatus: 1,
      subtotal: '8000',
      taxTotal: '800',
      total: '8800',
      balance: '8800',
    });
    expect(await s.run((ctx) => repo(ctx, SalesInvoice).count())).toBe(1);
    expect(await s.run((ctx) => repo(ctx, JournalEntry).count({ sourceEntity: 'sales_invoice' }))).toBe(1);
    expect((await s.act<TableResult>('appliance_store.open_services', {})).rows).toHaveLength(1);
    const line = (await s.run((ctx) => getLines(ctx, ApplianceService, completed.id)))[ApplianceServiceLine.name]?.[0];
    await expect(
      s.act(`${ApplianceServiceLine.name}.update`, { id: line?.id, patch: { unitPrice: '1' } }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(s.act('sales_invoice.cancel', { id: invoices[0]?.id })).rejects.toMatchObject({
      code: 'HAS_DEPENDENTS',
    });
    await s.act(`${ApplianceService.name}.cancel`, { id: completed.id, correctionDate: '2026-12-11' });
    expect(await s.act('sales_invoice.get', { id: invoices[0]?.id })).toMatchObject({
      docstatus: 2,
      cancelledDate: '2026-12-11',
    });
    const amended = await s.act(`${ApplianceService.name}.amend`, { id: completed.id });
    expect(amended).toMatchObject({ docstatus: 0, status: 'queued', salesInvoiceId: null, amendedFrom: completed.id });
  });

  it('AC-5 prevents cancelling paid installation work, then reverses invoice after receipt cancellation', async () => {
    const completed = await s.complete('installation');
    const invoice = await s.act('appliance_store.invoice_service', { serviceId: completed.id });
    expect(invoice).toMatchObject({ total: '16500' });
    const payment = await s.act('payment.create', {
      direction: 'receive',
      partnerId: invoice.partnerId,
      date: DATE,
      amount: '16500',
      method: 'bank_transfer',
      lines: { payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId: invoice.id, amount: '16500' }] },
    });
    await s.act('payment.submit', { id: payment.id });
    await expect(s.act(`${ApplianceService.name}.cancel`, { id: completed.id })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(await s.act(`${ApplianceService.name}.get`, { id: completed.id })).toMatchObject({
      docstatus: 1,
      status: 'completed',
    });
    await s.act('payment.cancel', { id: payment.id, correctionDate: '2026-12-11' });
    await s.act(`${ApplianceService.name}.cancel`, { id: completed.id, correctionDate: '2026-12-11' });
    expect(await s.act('sales_invoice.get', { id: invoice.id })).toMatchObject({ docstatus: 2, paidAmount: '0' });
  });

  it('AC-3/4 completes no-charge work without creating a receivable', async () => {
    const sample = await s.sample();
    const job = await s.act(`${ApplianceService.name}.create`, {
      title: '保証点検',
      partnerId: sample.partnerId,
      deviceId: sample.deviceId,
      date: DATE,
      request: '保証内容を確認のうえ点検',
      billing: 'no_charge',
    });
    await s.act('appliance_store.start_service', { serviceId: job.id });
    const done = await s.act('appliance_store.complete_service', {
      serviceId: job.id,
      completedDate: DATE,
      workReport: '無料の点検を完了',
    });
    expect(done).toMatchObject({ docstatus: 1, status: 'completed', salesInvoiceId: null });
    await expect(s.act('appliance_store.invoice_service', { serviceId: job.id })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(await s.run((ctx) => repo(ctx, SalesInvoice).count())).toBe(0);
    expect(
      (await s.act<TableResult>('appliance_store.open_services', {})).rows.some((row) => row.serviceId === job.id),
    ).toBe(false);
  });

  it('AC-4 reuses purchasing and stock movement for a sale with installation', async () => {
    // Explicitly opt in to the pack defaults; ordinary apply preserves existing inventory settings.
    await s.act('pack.apply', { name: 'appliance_store', force: true });
    const product = (await s.run((ctx) => repo(ctx, Product).list({ where: { code: 'APP-AIR' }, limit: 1 }))).items[0];
    const supplier = await s.act<{ items: Row[] }>('partner.list', { where: { code: 'APP-S001' }, limit: 1 });
    const purchase = await s.act('purchase_invoice.create', {
      partnerId: supplier.items[0]?.id,
      date: DATE,
      priceIncludesTax: false,
      lines: {
        purchase_invoice_line: [
          {
            productId: product?.id,
            description: 'エアコン2台',
            quantity: '2',
            unitPrice: '60000',
            taxCategory: 'standard',
          },
        ],
      },
    });
    expect(await s.act('purchase_invoice.submit', { id: purchase.id })).toMatchObject({ total: '132000' });
    const installation = await s.sample('installation');
    await s.act(`${ApplianceServiceLine.name}.create`, {
      serviceId: installation.id,
      productId: product?.id,
      description: 'エアコン本体',
      quantity: '1',
      unitPrice: '90000',
      taxCategory: 'standard',
      seq: 2,
    });
    const completed = await s.complete('installation');
    expect(await s.act('appliance_store.invoice_service', { serviceId: completed.id })).toMatchObject({
      subtotal: '105000',
      taxTotal: '10500',
      total: '115500',
    });
    const balance = (
      await s.run((ctx) => repo(ctx, StockBalance).list({ where: { productId: product?.id }, limit: 1 }))
    ).items[0];
    expect(balance?.qty.toString()).toBe('1');
    expect(balance?.value.toString()).toBe('60000');
    await s.act(`${ApplianceService.name}.cancel`, { id: completed.id, correctionDate: '2026-12-11' });
    expect((await s.run((ctx) => repo(ctx, StockBalance).get(balance?.id ?? ''))).qty.toString()).toBe('2');
  });
});
