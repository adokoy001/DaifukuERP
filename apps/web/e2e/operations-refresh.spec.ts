// Regression for a report kept open while another API client posts/reverses a receipt.
// Every operational record belongs to a new test store; existing stores and their documents are untouched.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  DAY,
  adminHeaders,
  api,
  login,
  newStore,
  openOperations,
  restaurant,
  type Headers,
  type Row,
} from './operations-helpers.ts';

type Evidence = { rows: Record<string, unknown>[]; totals: { sales: string; settled: string; balance: string } };
async function prepareReceivable(request: APIRequestContext, headers: Headers) {
  const store = await newStore(request, headers, '再集計専用店舗 ' + Date.now());
  const products = await api<{ items: Row[] }>(request, headers, '/api/product?limit=500');
  const rice = products.items.find((row) => row.code === 'RC-RICE');
  const chicken = products.items.find((row) => row.code === 'RC-CHICKEN');
  const recipes = await api<{ items: Row[] }>(request, headers, '/api/restaurant_chain_recipe?limit=500');
  const recipe = recipes.items.find((row) => row.code === 'RC-CURRY-V1' && row.docstatus === 1);
  expect(rice).toBeDefined();
  expect(chicken).toBeDefined();
  expect(recipe).toBeDefined();
  const stock = await api(request, headers, '/api/stock_entry', {
    type: 'receipt',
    date: DAY,
    warehouseId: store.warehouseId,
    lines: {
      stock_entry_line: [
        { productId: rice?.id, quantity: '1', unitCost: '500' },
        { productId: chicken?.id, quantity: '1', unitCost: '1000' },
      ],
    },
  });
  await api(request, headers, `/api/stock_entry/${stock.id}/submit`, {});
  const draft = await api(request, headers, '/api/restaurant_chain_closing', {
    storeId: store.id,
    date: DAY,
    cashAmount: '0',
    cardAmount: '1100',
    qrAmount: '0',
    cashSalesCounted: '0',
    lines: {
      restaurant_chain_closing_line: [
        { recipeId: recipe?.id, serviceMode: 'dine_in', quantity: '1', unitPrice: '1100' },
      ],
    },
  });
  const closing = await api(request, headers, `/api/restaurant_chain_closing/${draft.id}/submit`, {
    expectedVersion: draft.version,
  });
  expect(closing).toMatchObject({ docstatus: 1, total: '1100', cashAmount: '0', paymentId: null });
  const invoice = await api(request, headers, '/api/sales_invoice/' + String(closing.salesInvoiceId));
  expect(invoice).toMatchObject({ total: '1100', paidAmount: '0', balance: '1100' });
  return { store, closing, invoice };
}
async function refreshBoth(page: Page, input: Record<string, string>): Promise<Evidence> {
  const snapshot = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().endsWith('/actions/restaurant_chain.operations_snapshot'),
  );
  const settlements = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().endsWith('/actions/restaurant_chain.settlement_evidence'),
  );
  await page.getByRole('button', { name: '集計する', exact: true }).click();
  const [snapshotResponse, settlementResponse] = await Promise.all([snapshot, settlements]);
  for (const response of [snapshotResponse, settlementResponse]) {
    expect(response.ok(), await response.text()).toBe(true);
    expect(response.request().postDataJSON()).toEqual(input);
  }
  expect(await snapshotResponse.json()).toMatchObject({ overview: { grossSales: '1100' } });
  return settlementResponse.json() as Promise<Evidence>;
}

test('同条件の再集計で、開いたままの入金残高を外部入金・取消後の実値へ更新する', async ({ page, request }) => {
  test.setTimeout(180_000);
  await login(page);
  const companyId = await restaurant(page);
  const headers = await adminHeaders(request, companyId);
  const { store, closing, invoice } = await prepareReceivable(request, headers);
  const accounts = await api<{ items: Row[] }>(request, headers, '/api/account?limit=500');
  const bank = accounts.items.find((row) => row.code === '1100');
  expect(bank).toBeDefined();
  const input = { from: DAY, to: DAY, asOf: DAY, storeId: store.id };
  await openOperations(page, store.id);
  const evidence = page
    .locator('.control-panel')
    .filter({ has: page.getByRole('heading', { name: '売上伝票と消込の確認', exact: true }) });
  await expect(evidence.locator('[data-total="balance"]')).toHaveText('1,100');
  await expect(evidence.getByTestId('report-row')).toHaveCount(1);
  await expect(evidence).toContainText(String(closing.number));
  const originalUrl = page.url();

  // This request context has no access to the browser's React Query cache or invalidation hooks.
  const receipt = await api(request, headers, '/api/payment', {
    direction: 'receive',
    partnerId: invoice.partnerId,
    date: DAY,
    method: 'bank_transfer',
    amount: '400',
    accountId: bank?.id,
    note: 'operations-refresh E2E isolated receipt',
    lines: { payment_allocation: [{ invoiceEntity: 'sales_invoice', invoiceId: invoice.id, amount: '400' }] },
  });
  const paid = await api(request, headers, `/api/payment/${receipt.id}/submit`, { expectedVersion: receipt.version });
  expect(await api(request, headers, '/api/sales_invoice/' + invoice.id)).toMatchObject({
    paidAmount: '400',
    balance: '700',
  });
  // Keep the browser on the same route and criteria; refresh must include both server reports.
  expect(page.url()).toBe(originalUrl);
  expect((await refreshBoth(page, input)).totals).toMatchObject({ sales: '1100', settled: '400', balance: '700' });
  await expect(evidence.locator('[data-total="balance"]')).toHaveText('700');
  await expect(evidence.locator('[data-total="settled"]')).toHaveText('400');
  await expect(evidence.locator('[data-total="sales"]')).toHaveText('1,100');

  await api(request, headers, `/api/payment/${paid.id}/cancel`, { expectedVersion: paid.version, correctionDate: DAY });
  expect(await api(request, headers, '/api/sales_invoice/' + invoice.id)).toMatchObject({
    paidAmount: '0',
    balance: '1100',
  });
  expect((await refreshBoth(page, input)).totals).toMatchObject({ sales: '1100', settled: '0', balance: '1100' });
  await expect(evidence.locator('[data-total="balance"]')).toHaveText('1,100');
  await expect(evidence.locator('[data-total="settled"]')).toHaveText('0');
  expect(page.url()).toBe(originalUrl);
});
