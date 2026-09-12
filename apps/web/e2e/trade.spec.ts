import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { TradeCommand, TradeOrderDetail } from '@daifuku/mod-trade/contract';
import { financeAction, financeFixture, financeOrder, type FinanceFixture } from './finance-helpers.ts';
import { api, PASSWORD, type Row } from './operations-helpers.ts';
import { assertNoOverflow, signInQuality } from './quality-helpers.ts';
import { BUSINESS_DATE } from './environment.ts';

test.setTimeout(180_000);

async function stockQuantity(request: APIRequestContext, fixture: FinanceFixture) {
  const query = new URLSearchParams({ where: JSON.stringify({ productId: fixture.product.id, warehouseId: fixture.warehouse.id }) });
  const balances = await api<{ items: (Row & { qty: string })[] }>(request, fixture.headers, '/api/stock_balance?' + query);
  expect(balances.items).toHaveLength(1);
  return balances.items[0]?.qty;
}
async function orderDetail(request: APIRequestContext, fixture: FinanceFixture, orderId: string) {
  return api<TradeOrderDetail>(request, fixture.headers, '/actions/trade.order_detail', { orderId });
}
async function selectWarehouse(page: Page) {
  const input = page.getByRole('dialog').getByRole('combobox', { name: '倉庫', exact: true });
  await input.fill('商流検証倉庫');
  await expect(page.getByRole('dialog').getByRole('option').filter({ hasText: '商流検証倉庫' })).toBeVisible();
  await input.press('ArrowDown'); await input.press('Enter');
  await expect(input).toHaveValue(/商流検証倉庫/);
}
async function submitOrderFromRecord(page: Page, id: string) {
  await page.goto('/e/trade_order/' + id);
  await expect(page.getByTestId('record-form')).toBeVisible();
  const grid = page.getByTestId('lines-trade_order_line');
  await expect(grid.getByRole('textbox', { name: '品名', exact: true })).toHaveValue('商流検証部品');
  await expect(grid.getByRole('textbox', { name: '数量', exact: true })).toHaveAttribute('data-raw', '10');
  await expect(grid.getByRole('textbox', { name: '税抜単価', exact: true })).toHaveAttribute('data-raw', '1000');
  await page.getByRole('button', { name: '確定', exact: true }).click();
  const pending = page.waitForResponse((response) => response.url().endsWith(`/api/trade_order/${id}/submit`) && response.request().method() === 'POST');
  await page.getByRole('dialog').getByRole('button', { name: '確定', exact: true }).click();
  const response = await pending; expect(response.ok(), await response.text()).toBe(true);
  await expect(page.getByTestId('docstatus')).toHaveAttribute('data-docstatus', '1');
  return response.json() as Promise<Row>;
}
async function invoiceQuantity(page: Page, quantity: string) {
  await page.getByRole('button', { name: '請求数量を入力', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('請求日', { exact: true }).fill(BUSINESS_DATE);
  await dialog.getByRole('textbox', { name: '商流検証部品 今回の数量', exact: true }).fill(quantity);
  const made = await financeAction<TradeCommand>(page, 'trade.bill_fulfillment', () => dialog.getByRole('button', { name: '数量を確認して請求を確定', exact: true }).click());
  await expect(dialog).toHaveCount(0); return made;
}

test('quotation conversion → generic order submission → partial shipment and invoice keep stock singular in Japanese and English', async ({ page, request }) => {
  const fixture = await financeFixture(request), quotation = await financeOrder(request, fixture, 'sales', true);
  await signInQuality(page, fixture.email, PASSWORD); await page.goto('/commerce/trade');
  await expect(page.getByRole('heading', { name: '商流・受発注', exact: true })).toBeVisible();
  const quoteCard = page.locator('.commerce-list-item').filter({ hasText: String(quotation.number) });
  await quoteCard.getByRole('button', { name: '受注へ引き継ぐ', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('受注日', { exact: true }).fill(BUSINESS_DATE);
  const converted = await financeAction<TradeCommand>(page, 'trade.convert_quotation', () => dialog.getByRole('button', { name: '見積内容を引き継いで受注作成', exact: true }).click());
  await expect(dialog).toHaveCount(0);
  const submitted = await submitOrderFromRecord(page, converted.id);
  await page.goto('/commerce/trade'); await page.getByRole('button', { name: String(submitted.number), exact: true }).click();
  await page.getByRole('button', { name: '出荷数量を入力', exact: true }).click();
  await dialog.getByLabel('入出庫日', { exact: true }).fill(BUSINESS_DATE); await selectWarehouse(page);
  const quantity = dialog.getByRole('textbox', { name: '商流検証部品 今回の数量', exact: true }); await quantity.fill('11');
  await dialog.getByRole('button', { name: '数量を確認して入出庫', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('数量は残数以下の正数');
  expect(await stockQuantity(request, fixture)).toBe('100');
  await quantity.fill('6');
  const fulfillment = await financeAction<TradeCommand>(page, 'trade.fulfill_order', () => dialog.getByRole('button', { name: '数量を確認して入出庫', exact: true }).click());
  await expect(dialog).toHaveCount(0); expect(await stockQuantity(request, fixture)).toBe('94');
  await invoiceQuantity(page, '4');
  const detail = await orderDetail(request, fixture, converted.id);
  expect(detail.lines[0]).toMatchObject({ quantity: '10', fulfilledQuantity: '6', remainingQuantity: '4', billedQuantity: '4', unbilledQuantity: '2' });
  expect(detail.fulfillments[0]?.id).toBe(fulfillment.id); expect(detail.fulfillments[0]?.billings[0]?.total).toBe('4400');
  expect(await stockQuantity(request, fixture)).toBe('94');
  await expect(page.getByRole('link', { name: String(detail.fulfillments[0]?.billings[0]?.invoiceNumber), exact: true })).toBeVisible();
  await assertNoOverflow(page); await page.screenshot({ path: test.info().outputPath('trade-sales-desktop-ja.png'), fullPage: true });
  await page.getByRole('button', { name: '言語: en', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trade and orders', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Open / unbilled lines', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter shipment', exact: true })).toBeEnabled();
  await expect(page.getByRole('columnheader', { name: 'Billed / unbilled', exact: true })).toBeVisible();
  await assertNoOverflow(page); await page.screenshot({ path: test.info().outputPath('trade-sales-desktop-en.png'), fullPage: true });
});

test('purchasing partial receipt and invoice work at 390px and closing retains visible unbilled goods', async ({ page, request }) => {
  const fixture = await financeFixture(request), order = await financeOrder(request, fixture, 'purchase');
  await page.setViewportSize({ width: 390, height: 844 }); await signInQuality(page, fixture.email, PASSWORD); await page.goto('/commerce/trade');
  await page.getByRole('button', { name: '仕入', exact: true }).click(); await page.getByRole('button', { name: String(order.number), exact: true }).click();
  await page.getByRole('button', { name: '入荷数量を入力', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('入出庫日', { exact: true }).fill(BUSINESS_DATE); await selectWarehouse(page);
  await dialog.getByRole('textbox', { name: '商流検証部品 今回の数量', exact: true }).fill('6');
  await assertNoOverflow(page); await page.screenshot({ path: test.info().outputPath('trade-receipt-dialog-mobile-390.png'), fullPage: true });
  await financeAction(page, 'trade.fulfill_order', () => dialog.getByRole('button', { name: '数量を確認して入出庫', exact: true }).click());
  await expect(dialog).toHaveCount(0); expect(await stockQuantity(request, fixture)).toBe('106');
  await invoiceQuantity(page, '4');
  let detail = await orderDetail(request, fixture, order.id);
  expect(detail.lines[0]).toMatchObject({ remainingQuantity: '4', unbilledQuantity: '2' }); expect(detail.fulfillments[0]?.billings[0]?.total).toBe('2640'); expect(await stockQuantity(request, fixture)).toBe('106');
  await page.getByRole('button', { name: '残数を終了', exact: true }).click(); await dialog.getByLabel('理由', { exact: true }).fill('残り4個の発注を打切り、既入荷2個は別便で請求');
  await financeAction(page, 'trade.close_order', () => dialog.getByRole('button', { name: '理由を記録して実行', exact: true }).click()); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: String(order.number), exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '入荷数量を入力', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '請求数量を入力', exact: true })).toBeEnabled();
  await assertNoOverflow(page); await page.screenshot({ path: test.info().outputPath('trade-purchase-closed-mobile-390.png'), fullPage: true });
  await invoiceQuantity(page, '2'); detail = await orderDetail(request, fixture, order.id);
  expect(detail.order.status).toBe('closed'); expect(detail.lines[0]).toMatchObject({ remainingQuantity: '4', unbilledQuantity: '0', billedQuantity: '6' });
  expect(detail.fulfillments[0]?.billings.map((billing) => billing.total)).toEqual(['2640', '1320']); expect(await stockQuantity(request, fixture)).toBe('106');
});
