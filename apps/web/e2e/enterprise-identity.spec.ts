// Run only against identity-e2e-server.ts and the synthetic loopback OIDC/TLS SMTP fixtures.
import { createHmac, randomBytes } from 'node:crypto';
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
const initialPassword = 'identity-test-password';
let recovery: string[] = [];
function authenticator(secret: string) {
  let bits = 0,
    value = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest(),
    offset = (digest[19] ?? 0) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function passwordLogin(page: Page, email = 'admin@example.com', password = initialPassword) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.locator('#password')).not.toBeVisible();
}
async function verify(page: Page, password = initialPassword, code?: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('現在のパスワード', { exact: true }).fill(password);
  if (code) await dialog.getByLabel('認証コード・回復コード').fill(code);
  await dialog.getByRole('button', { name: '本人確認して続ける' }).click();
}
async function loginMfa(page: Page, code: string) {
  await page.getByLabel('認証コード・回復コード').fill(code);
  await page.getByRole('button', { name: '確認してログイン' }).click();
}
async function latestMail(request: APIRequestContext, recipient: string, purpose: string) {
  let mail = '';
  await expect
    .poll(async () => {
      const result = await request.get('http://127.0.0.1:3110/fixture/inbox');
      const messages = (await result.json()) as { messages: string[] };
      mail = messages.messages.filter((item) => item.includes(recipient) && item.includes(purpose)).at(-1) ?? '';
      return Boolean(mail);
    })
    .toBe(true);
  const link = mail.match(/http:\/\/localhost:5189\/[^\s]+#token=[A-Za-z0-9_-]+/);
  expect(link).not.toBeNull();
  return link?.[0] ?? '';
}
async function setMailPassword(page: Page, link: string, password: string, invitation: boolean) {
  await page.goto(link);
  await page.locator('#mail-password').fill(password);
  await page.locator('#mail-confirm').fill(password);
  expect(new URL(page.url()).hash).toBe('');
  await page
    .getByRole('button', { name: invitation ? '登録して利用を始める' : 'パスワードを再設定', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText(
    invitation ? 'アカウントを有効にしました' : 'パスワードを再設定しました',
  );
}
test.describe.serial('enterprise identity with synthetic OIDC and verified TLS SMTP', () => {
  test('explicit browser SSO linking, TOTP setup and single-use recovery login', async ({ page }) => {
    await passwordLogin(page);
    await page.goto('/account');
    await page.getByRole('button', { name: '組織アカウントを紐付け', exact: true }).click();
    await verify(page);
    await expect(page.getByRole('status')).toContainText('組織アカウントを紐付けました');
    expect(new URL(page.url()).search).toBe('');
    await page.getByRole('link', { name: 'ログインへ', exact: true }).click();
    await page.getByRole('button', { name: '合成組織SSO' }).click();
    await expect(page).not.toHaveURL(/auth\/oidc|login/);
    await page.goto('/account');
    await page.getByRole('button', { name: '認証アプリを登録' }).click();
    await verify(page);
    const secret = await page.getByTestId('mfa-setup-secret').innerText();
    await page.getByLabel('アプリの6桁コード').fill(authenticator(secret.replace(/\s/g, '')));
    await page.getByRole('button', { name: '登録して回復コードを表示' }).click();
    await expect(page).toHaveURL(/auth\/recovery-codes/);
    recovery = await page.locator('.identity-recovery li').allTextContents();
    expect(recovery).toHaveLength(10);
    await page.getByLabel('安全な場所に保存しました').check();
    await page.getByRole('link', { name: '保存してログインへ' }).click();
    await passwordLogin(page);
    await loginMfa(page, recovery[0] ?? '');
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/account');
    await expect(page.getByText('回復コード 残り9件')).toBeVisible();
    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/login');
    await page.getByRole('button', { name: '合成組織SSO' }).click();
    await expect(page.getByRole('heading', { name: 'もう一度、本人確認' })).toBeVisible();
    await loginMfa(page, recovery[0] ?? '');
    await expect(page.getByRole('alert')).toContainText('コードを確認');
    await loginMfa(page, recovery[1] ?? '');
    await expect(page).not.toHaveURL(/login/);
  });
  test('admin invitation and email password reset preserve no-company account access on mobile', async ({
    page,
    request,
  }, testInfo) => {
    await passwordLogin(page);
    await loginMfa(page, recovery[2] ?? '');
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: /メールで招待/ }).click();
    await page.getByLabel('招待する方の氏名').fill('合成 招待利用者');
    await page.getByLabel('招待先メールアドレス').fill('invited@example.test');
    await verify(page, initialPassword, recovery[3]);
    await expect(page.getByRole('status')).toContainText('配送待ち');
    const inviteLink = await latestMail(request, 'invited@example.test', 'accept-invitation');
    await page.setViewportSize({ width: 390, height: 844 });
    await setMailPassword(page, inviteLink, 'invited-test-password', true);
    await passwordLogin(page, 'invited@example.test', 'invited-test-password');
    await page.goto('/account');
    await expect(page.getByRole('button', { name: '認証アプリを登録' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('identity-account-mobile.png'), fullPage: true });
    await page.goto('/forgot-password');
    await page.locator('#reset-email').fill('invited@example.test');
    await page.getByRole('button', { name: '再設定メールを依頼' }).click();
    await expect(page.getByRole('status')).toContainText('入力された情報で再設定できる場合');
    const resetLink = await latestMail(request, 'invited@example.test', 'reset-password');
    await setMailPassword(page, resetLink, 'changed-invited-password', false);
    await passwordLogin(page, 'invited@example.test', 'changed-invited-password');
    await page.goto('/account');
    await expect(page.getByRole('button', { name: '認証アプリを登録' })).toBeVisible();
    await page.goto(resetLink);
    await page.locator('#mail-password').fill('another-invited-password');
    await page.locator('#mail-confirm').fill('another-invited-password');
    await page.getByRole('button', { name: 'パスワードを再設定', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('使用済み・期限切れ');
  });
  test('MFA-protected relay pairing is transient and revocation blocks the machine credential', async ({
    page,
    request,
  }) => {
    await passwordLogin(page);
    const signedIn = page.waitForResponse((response) => response.url().endsWith('/auth/mfa/verify'));
    await loginMfa(page, recovery[4] ?? '');
    const session = await (await signedIn).json();
    const headers = { authorization: 'Bearer ' + session.token };
    const siteReply = await request.post('http://localhost:3109/api/workforce_site', {
      headers,
      data: { code: 'PAIRING', name: '接続確認拠点' },
    });
    expect(siteReply.ok()).toBe(true);
    const site = await siteReply.json();
    const gatewayReply = await request.post('http://localhost:3109/actions/edge.create_gateway', {
      headers,
      data: { siteId: site.id, code: 'PAIRING', name: '本人確認する中継' },
    });
    expect(gatewayReply.ok()).toBe(true);
    await page.goto('/operations/devices');
    await page.getByRole('button', { name: '接続コード', exact: true }).click();
    await verify(page, 'wrong-password', recovery[5]);
    await expect(page.getByRole('alert')).toBeVisible();
    await verify(page, initialPassword, recovery[5]);
    const dialog = page.getByRole('dialog'),
      code = dialog.getByLabel('接続コード', { exact: true });
    await expect(code).toHaveValue(/^[A-Za-z0-9_-]{43}$/);
    const pairingToken = await code.inputValue();
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(pairingToken);
    expect(page.url()).not.toContain(pairingToken);
    await dialog.getByRole('button', { name: '閉じる', exact: true }).last().click();
    await expect(page.getByLabel('接続コード', { exact: true })).toHaveCount(0);
    const credentialSecret = randomBytes(32).toString('base64url');
    const pair = await request.post('http://localhost:3109/relay/pair', {
      data: { pairingToken, credentialSecret, protocolVersion: 1, agentVersion: 'ui-test' },
    });
    expect(pair.ok()).toBe(true);
    await page.getByRole('button', { name: '最新の状況を取得', exact: true }).click();
    await page.getByRole('button', { name: '接続資格を失効', exact: true }).click();
    await page.getByLabel('失効理由', { exact: true }).fill('機器入替の本人確認を検証');
    await verify(page, initialPassword, recovery[6]);
    await expect(page.getByRole('status')).toContainText('接続資格を失効しました');
    const denied = await request.get('http://localhost:3109/relay/session', {
      headers: { authorization: 'Bearer ' + credentialSecret },
    });
    expect(denied.status()).toBe(401);
  });
});
