import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { commerceFixture } from './commerce-helpers.ts';
import { api, type Row } from './operations-helpers.ts';
import { BUSINESS_DATE } from './environment.ts';

export async function financeFixture(request: APIRequestContext) {
  const base = await commerceFixture(request);
  const headers = base.headers;
  const partner = await api(request, headers, '/api/partner', {
    code: 'FN-' + base.runId,
    name: '商流銀行取引先 ' + base.runId,
    nameKana: 'ﾄﾘﾋｷｻｷ',
    isCustomer: true,
    isSupplier: true,
  });
  const uom = await api(request, headers, '/api/uom', { code: 'EA', name: '個' });
  const warehouse = await api(request, headers, '/api/warehouse', {
    code: 'MAIN',
    name: '商流検証倉庫',
    isDefault: true,
  });
  await api(request, headers, '/api/tax_rate', {
    code: 'JP-10',
    category: 'standard',
    rate: '0.10',
    validFrom: '2019-10-01',
    label: '合成標準10%',
  });
  const product = await api(request, headers, '/api/product', {
    code: 'FIN-PART',
    name: '商流検証部品',
    uomId: uom.id,
    salePrice: '1000',
    purchasePrice: '600',
  });
  const stock = await api(request, headers, '/api/stock_entry', {
    type: 'receipt',
    date: BUSINESS_DATE,
    warehouseId: warehouse.id,
    lines: { stock_entry_line: [{ productId: product.id, quantity: '100', unitCost: '600' }] },
  });
  await submitFinance(request, headers, 'stock_entry', stock.id);
  return { ...base, partner, uom, warehouse, product };
}
export type FinanceFixture = Awaited<ReturnType<typeof financeFixture>>;
export async function submitFinance(
  request: APIRequestContext,
  headers: Record<string, string>,
  entity: string,
  id: string,
) {
  const current = await api(request, headers, `/api/${entity}/${id}`);
  return api(request, headers, `/actions/${entity}.submit`, { id, expectedVersion: current.version });
}
export async function financeInvoice(
  request: APIRequestContext,
  fixture: FinanceFixture,
  direction: 'sales' | 'purchase',
  quantity = '10',
) {
  const entity = direction === 'sales' ? 'sales_invoice' : 'purchase_invoice';
  const row = await api(request, fixture.headers, `/api/${entity}`, {
    partnerId: fixture.partner.id,
    date: BUSINESS_DATE,
    priceIncludesTax: false,
    lines: {
      [`${entity}_line`]: [
        {
          productId: fixture.product.id,
          description: '商流検証部品',
          quantity,
          unitPrice: direction === 'sales' ? '1000' : '600',
          taxCategory: 'standard',
        },
      ],
    },
  });
  await submitFinance(request, fixture.headers, entity, row.id);
  return api(request, fixture.headers, `/api/${entity}/${row.id}`);
}
export const financeBankIdentity = {
  bankCode: '0001',
  branchCode: '001',
  accountType: 'ordinary',
  accountNumber: '1234567',
  holderKana: 'ﾀﾞｲﾌｸ',
} as const;
export async function financeBank(request: APIRequestContext, fixture: FinanceFixture) {
  const account = await api(request, fixture.headers, '/actions/banking.save_account', {
    ...financeBankIdentity,
    code: 'MAIN',
    name: '営業用口座',
    ledgerAccountId: fixture.accounts['1100'],
    requesterCode: '1234567890',
    active: true,
  });
  const payee = await api(request, fixture.headers, '/actions/banking.save_payee', {
    ...financeBankIdentity,
    accountNumber: '7654321',
    holderKana: 'ﾄﾘﾋｷｻｷ',
    partnerId: fixture.partner.id,
    active: true,
  });
  return { account, payee };
}
export async function financeAction<T = Row>(page: Page, name: string, click: () => Promise<void>): Promise<T> {
  const pending = page.waitForResponse(
    (response) => response.url().endsWith('/actions/' + name) && response.request().method() === 'POST',
  );
  await click();
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}
export async function financeOrder(
  request: APIRequestContext,
  fixture: FinanceFixture,
  direction: 'sales' | 'purchase',
  quotation = false,
) {
  const entity = quotation ? 'trade_quotation' : 'trade_order';
  const row = await api(request, fixture.headers, `/api/${entity}`, {
    direction,
    partnerId: fixture.partner.id,
    date: BUSINESS_DATE,
    lines: {
      [`${entity}_line`]: [
        {
          productId: fixture.product.id,
          description: '商流検証部品',
          quantity: '10',
          unitPrice: direction === 'sales' ? '1000' : '600',
          taxCategory: 'standard',
        },
      ],
    },
  });
  return submitFinance(request, fixture.headers, entity, row.id);
}
