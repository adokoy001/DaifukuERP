import { bootstrapTenant, newId, repo, setSetting } from '@daifuku/kernel';
import { SALES_ACCOUNTS_DEFAULT, SALES_ACCOUNTS_KEY, salesAccountsSchema, SalesInvoice } from '@daifuku/mod-sales';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApplianceDevice, ApplianceService, ApplianceServiceLine } from '../src/index.ts';
import { DATE, setup, type Fixture } from './fixture.ts';

let s: Fixture;
beforeEach(async () => {
  s = await setup();
});
afterEach(async () => {
  await s?.db.close();
});

describe('appliance store foundation invariants', () => {
  it('AC-2/3/4 computes the omitted quantity default through public create, completion and invoice', async () => {
    const sample = await s.sample('installation');
    const productId = (await s.run((ctx) => repo(ctx, ApplianceServiceLine).list({ where: { serviceId: sample.id } })))
      .items[0]?.productId;
    const job = await s.act(`${ApplianceService.name}.create`, {
      title: '数量省略の設置',
      partnerId: sample.partnerId,
      deviceId: sample.deviceId,
      date: DATE,
      request: '標準数量1で設置',
      lines: { appliance_store_service_line: [{ productId, description: '設置作業', unitPrice: '15000' }] },
    });
    const lines = await s.act<{ items: Record<string, unknown>[] }>(`${ApplianceServiceLine.name}.list`, {
      where: { serviceId: job.id },
    });
    expect(lines.items).toEqual([expect.objectContaining({ quantity: '1', unitPrice: '15000', amount: '15000' })]);
    await s.act('appliance_store.start_service', { serviceId: job.id });
    expect(
      await s.act('appliance_store.complete_service', {
        serviceId: job.id,
        completedDate: DATE,
        workReport: '設置・試運転完了',
      }),
    ).toMatchObject({ docstatus: 1, status: 'completed' });
    expect(await s.act('appliance_store.invoice_service', { serviceId: job.id })).toMatchObject({
      docstatus: 1,
      subtotal: '15000',
      taxTotal: '1500',
      total: '16500',
    });
  });

  it('AC-2 keeps the existing quantity when a partial line update omits it', async () => {
    const sample = await s.sample();
    const productId = (await s.run((ctx) => repo(ctx, ApplianceServiceLine).list({ where: { serviceId: sample.id } })))
      .items[0]?.productId;
    const line = await s.act(`${ApplianceServiceLine.name}.create`, {
      serviceId: sample.id,
      productId,
      description: '追加作業',
      unitPrice: '1000',
    });
    expect(line).toMatchObject({ quantity: '1', amount: '1000' });
    expect(
      await s.act(`${ApplianceServiceLine.name}.update`, { id: line.id, patch: { quantity: '2.5' } }),
    ).toMatchObject({ quantity: '2.5', amount: '2500' });
    expect(
      await s.act(`${ApplianceServiceLine.name}.update`, { id: line.id, patch: { unitPrice: '1200' } }),
    ).toMatchObject({ quantity: '2.5', unitPrice: '1200', amount: '3000' });
    expect(
      await s.act(`${ApplianceServiceLine.name}.update`, { id: line.id, patch: { description: '説明だけ変更' } }),
    ).toMatchObject({ quantity: '2.5', unitPrice: '1200', amount: '3000' });
  });

  it('AC-1/2 rejects different customers, contract owners and foreign-company references', async () => {
    const sample = await s.sample();
    const customer = await s.act('partner.create', { name: '別のお客様', isCustomer: true });
    await expect(
      s.act(`${ApplianceService.name}.create`, {
        title: '不一致',
        partnerId: customer.id,
        deviceId: sample.deviceId,
        request: '別顧客機器',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const contract = await s.act('contract.create', {
      partnerId: customer.id,
      title: '別顧客の保守契約',
      startDate: DATE,
    });
    await expect(
      s.act(`${ApplianceDevice.name}.update`, { id: sample.deviceId, patch: { contractId: contract.id } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const other = await bootstrapTenant(s.db.owner, {
      tenantName: 'Foreign',
      companyCode: 'FOREIGN',
      companyName: 'Foreign company',
      adminEmail: 'admin@example.com',
      adminName: 'Other',
      adminPassword: 'password',
    });
    const foreign = await s.act(
      'partner.create',
      { name: 'Foreign customer', isCustomer: true },
      { tenantId: other.tenantId, companyId: other.companyId },
    );
    await expect(
      s.act(`${ApplianceDevice.name}.create`, { code: 'WRONG', name: 'Foreign', model: 'X', partnerId: foreign.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      s.act(
        'appliance_store.start_service',
        { serviceId: sample.id },
        { tenantId: other.tenantId, companyId: other.companyId },
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('AC-3/8 protects status, invoice link, derived amount, lifecycle order, date and expected version', async () => {
    const sample = await s.sample();
    for (const patch of [{ status: 'completed' }, { salesInvoiceId: newId() }])
      await expect(s.act(`${ApplianceService.name}.update`, { id: sample.id, patch })).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    const line = (await s.run((ctx) => repo(ctx, ApplianceServiceLine).list({ where: { serviceId: sample.id } })))
      .items[0];
    await expect(
      s.act(`${ApplianceServiceLine.name}.update`, { id: line?.id, patch: { amount: '1' } }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      s.act(`${ApplianceServiceLine.name}.update`, { id: line?.id, patch: { quantity: '0' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(s.act(`${ApplianceService.name}.submit`, { id: sample.id })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expect(
      s.act('appliance_store.start_service', { serviceId: sample.id }, { roles: ['viewer'] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await s.act(`${ApplianceService.name}.update`, { id: sample.id, patch: { assignee: '変更後の担当' } });
    await expect(
      s.act('appliance_store.start_service', { serviceId: sample.id, expectedVersion: sample.version }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const started = await s.act('appliance_store.start_service', { serviceId: sample.id });
    await expect(
      s.act('appliance_store.complete_service', {
        serviceId: sample.id,
        completedDate: '2026-12-09',
        workReport: '日付不正',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await s.act(`${ApplianceService.name}.get`, { id: sample.id })).toMatchObject({
      status: 'in_progress',
      version: started.version,
      completedDate: null,
    });
  });

  it('AC-4/8 rolls back all invoice work and keeps the job retryable when posting fails', async () => {
    const completed = await s.complete();
    await s.run((ctx) =>
      setSetting(ctx, SALES_ACCOUNTS_KEY, salesAccountsSchema, {
        ...SALES_ACCOUNTS_DEFAULT,
        revenue: 'MISSING-ACCOUNT',
      }),
    );
    await expect(s.act('appliance_store.invoice_service', { serviceId: completed.id })).rejects.toThrow();
    expect(await s.run((ctx) => repo(ctx, SalesInvoice).count())).toBe(0);
    expect(await s.act(`${ApplianceService.name}.get`, { id: completed.id })).toMatchObject({
      status: 'completed',
      salesInvoiceId: null,
      version: completed.version,
    });
    await s.run((ctx) => setSetting(ctx, SALES_ACCOUNTS_KEY, salesAccountsSchema, SALES_ACCOUNTS_DEFAULT));
    expect(
      await s.act('appliance_store.invoice_service', { serviceId: completed.id, expectedVersion: completed.version }),
    ).toMatchObject({ docstatus: 1, total: '8800' });
  });
});
