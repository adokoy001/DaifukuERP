import { expect, type Page } from '@playwright/test';

/** Exercise the visible menu, then search the complete authorized catalog before choosing an original URL. */
export async function findScreen(page: Page, query: string) {
  await page
    .getByRole('navigation', { name: 'メニュー' })
    .getByRole('link', { name: 'すべての画面を探す', exact: true })
    .click();
  await expect(page).toHaveURL(/\/workspaces(?:\?|$)/);
  await page.getByRole('searchbox', { name: '画面名を検索', exact: true }).fill(query);
}
export async function openScreen(page: Page, href: string) {
  await findScreen(page, href);
  const link = page.locator(`main a[data-screen-href="${href}"]`);
  await expect(link).toHaveCount(1);
  await link.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(href);
}
