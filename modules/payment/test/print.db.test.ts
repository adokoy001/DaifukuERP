// docs/specs/print-templates.md AC-9, AC-13, AC-14, AC-19〜AC-21: payment.render_receipt_html and
// payment.render_payment_notice_html against Postgres — content from stored values, direction and draft refusals,
// row rules (sales: receipts only, purchasing: disbursements only), roles without read, store-limited contexts, another
// company, the issuer resolution and a related record the caller cannot read. Test DB: TEST_DATABASE_URL*.
import {
  appMeta,
  companies,
  COMPANY_PROFILE_KEY,
  companyProfileSchema,
  ensureCompanyProfileSetting,
  newId,
  NotFound,
  PermissionDenied,
  registerCrudActions,
  repo,
  runAction,
  setSetting,
  StateError,
  type Context,
  type ContextParams,
  type Op,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account, openFiscalYear } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { SALES_ISSUER_KEY, salesIssuerSchema } from '@daifuku/mod-sales';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Payment, PaymentAllocation, PaymentModule } from '../src/index.ts';

type Row = Record<string, unknown> & { id: string; number?: string | null };
const NOW = new Date('2026-09-10T03:00:00Z'); // 2026-09-10 12:00 JST
let db: TestDb;
let expenseAccount: string;
let customer: string;
let supplier: string;
let salesInvoice: Row;
let purchaseInvoice: Row;
let receipt: Row;
let disbursement: Row;
let advanceOnly: Row;
let draftReceipt: Row;

const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) =>
  db.run({ now: () => NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const render = (params: Partial<ContextParams>, action: string, id: string) =>
  run(params, async (ctx) => ((await runAction(ctx, action, { id })) as { html: string }).html);
const RECEIPT = 'payment.render_receipt_html';
const NOTICE = 'payment.render_payment_notice_html';

async function invoice(
  entity: 'sales_invoice' | 'purchase_invoice',
  extra: Record<string, unknown> = {},
): Promise<Row> {
  return run({}, async (ctx) => {
    const created = (await runAction(ctx, `${entity}.create`, {
      partnerId: entity === 'sales_invoice' ? customer : supplier,
      date: '2026-08-01',
      dueDate: '2026-09-30',
      ...extra,
      lines: {
        [`${entity}_line`]: [
          {
            ...(entity === 'purchase_invoice' ? { accountId: expenseAccount } : {}),
            description: '帳票の試験',
            unitPrice: '30000',
            taxCategory: 'exempt',
          },
        ],
      },
    })) as Row;
    return (await runAction(ctx, `${entity}.submit`, { id: created.id })) as Row;
  });
}
async function payment(
  direction: 'receive' | 'pay',
  amount: string,
  allocations: { invoiceId: string; amount: string }[],
  submit = true,
  extra: Record<string, unknown> = {},
): Promise<Row> {
  return run({}, async (ctx) => {
    const created = (await runAction(ctx, 'payment.create', {
      direction,
      partnerId: direction === 'receive' ? customer : supplier,
      amount,
      date: '2026-09-05',
      ...extra,
      lines: {
        payment_allocation: allocations.map((a) => ({
          ...a,
          invoiceEntity: direction === 'receive' ? 'sales_invoice' : 'purchase_invoice',
        })),
      },
    })) as Row;
    return submit ? ((await runAction(ctx, 'payment.submit', { id: created.id })) as Row) : created;
  });
}

beforeAll(async () => {
  if (PaymentModule.name !== 'payment') throw new Error('Payment module not registered');
  registerCrudActions();
  ensureCompanyProfileSetting();
  db = await freshDb();
  await run({}, (ctx) => openFiscalYear(ctx, { startDate: '2026-01-01' }));
  const account = (code: string, name: string, type: 'asset' | 'liability' | 'revenue' | 'expense', extra = {}) =>
    run({}, async (ctx) => (await repo(ctx, Account).create({ code, name, type, ...extra })).id);
  await account('1000', '現金', 'asset', { subtype: '現金預金' });
  await account('1100', '普通預金', 'asset', { subtype: '現金預金' });
  await account('1300', '売掛金', 'asset', { subtype: '売掛金', partnerRequired: true });
  await account('2100', '買掛金', 'liability', { subtype: '買掛金', partnerRequired: true });
  await account('2400', '前受金', 'liability', { subtype: 'その他流動負債' });
  await account('1900', '前払金', 'asset', { subtype: 'その他流動資産' });
  await account('4000', '売上高', 'revenue', { subtype: '売上' });
  await account('2200', '仮受消費税', 'liability', { subtype: '仮受消費税' });
  expenseAccount = await account('5000', '仕入高', 'expense', { subtype: '仕入' });
  await account('1500', '仮払消費税', 'asset', { subtype: '仮払消費税' });
  customer = (
    await run({}, (ctx) =>
      repo(ctx, Partner).create({
        name: '得意先P',
        isCustomer: true,
        postalCode: '150-0001',
        prefecture: '東京都',
        address1: '渋谷区2-2',
      }),
    )
  ).id;
  supplier = (await run({}, (ctx) => repo(ctx, Partner).create({ name: '仕入先P', isSupplier: true }))).id;
  salesInvoice = await invoice('sales_invoice');
  purchaseInvoice = await invoice('purchase_invoice', { supplierInvoiceNo: 'SUP-778' });
  receipt = await payment('receive', '40000', [{ invoiceId: salesInvoice.id, amount: '30000' }], true, {
    method: 'cash',
    note: '9月分',
  });
  disbursement = await payment('pay', '30000', [{ invoiceId: purchaseInvoice.id, amount: '30000' }]);
  advanceOnly = await payment('receive', '5000', []);
  draftReceipt = await payment('receive', '1000', [], false);
});
afterAll(async () => {
  await db?.close();
});

describe('payment print actions (docs/specs/print-templates.md)', () => {
  it('AC-13 the receipt: stored amount, method, allocation with invoice number and date, advance, partner', async () => {
    const html = await render(asRole(['accounting']), RECEIPT, receipt.id);
    for (const s of [
      '>領収書<',
      String(receipt.number),
      '40,000円',
      '>現金<',
      '得意先P 御中',
      '〒150-0001 東京都 渋谷区2-2',
      `>${String(salesInvoice.number)}<`,
      '2026年8月1日',
      '>30,000<',
      '前受金（未消込）',
      '>10,000<',
      '9月分',
      'テスト株式会社',
    ])
      expect(html).toContain(s);
  });

  it('AC-14 the payment notice: supplier invoice number, purchase invoice, no advance row', async () => {
    const html = await render(asRole(['purchasing']), NOTICE, disbursement.id);
    expect(html).toContain('>支払通知書<');
    expect(html).toContain('>SUP-778<');
    expect(html).toContain(`>${String(purchaseInvoice.number)}<`);
    expect(html).toContain('仕入先P 御中');
    expect(html).not.toContain('前払金');
  });

  it('AC-13 AC-14 the wrong direction and drafts are INVALID_STATE', async () => {
    await expect(render({}, RECEIPT, disbursement.id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      hint: expect.stringContaining('payment.render_payment_notice_html'),
    });
    await expect(render({}, NOTICE, receipt.id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      hint: expect.stringContaining('payment.render_receipt_html'),
    });
    await expect(render({}, RECEIPT, draftReceipt.id)).rejects.toBeInstanceOf(StateError);
  });

  it('AC-9 issuer: the company name, then company.profile, then sales.issuer as a whole; registration no. on receipts only', async () => {
    await run({}, (ctx) =>
      setSetting(ctx, COMPANY_PROFILE_KEY, companyProfileSchema, {
        legalName: '株式会社テスト本社',
        invoiceRegistrationNo: 'T9999999999999',
        address: '東京都港区9-9',
      }),
    );
    const fromProfile = await render({}, RECEIPT, receipt.id);
    expect(fromProfile).toContain('株式会社テスト本社');
    expect(fromProfile).toContain('登録番号: T9999999999999');
    await run({}, (ctx) =>
      setSetting(ctx, SALES_ISSUER_KEY, salesIssuerSchema, {
        name: '大福商事株式会社',
        invoiceRegistrationNo: 'T1234567890123',
        bankInfo: 'テスト銀行 本店 普通 1234567',
      }),
    );
    const fromIssuer = await render({}, RECEIPT, receipt.id);
    expect(fromIssuer).toContain('大福商事株式会社');
    expect(fromIssuer).toContain('登録番号: T1234567890123');
    expect(fromIssuer).not.toContain('株式会社テスト本社');
    expect(fromIssuer).not.toContain('テスト銀行'); // bank details only on invoices and statements
    const notice = await render({}, NOTICE, disbursement.id);
    expect(notice).toContain('大福商事株式会社');
    expect(notice).not.toContain('T1234567890123'); // D-3: not on documents the company sends as the buyer
  });

  it('AC-20 row rules: sales cannot print disbursements, purchasing cannot print receipts (NOT_FOUND)', async () => {
    expect(await render(asRole(['sales']), RECEIPT, receipt.id)).toContain('>領収書<');
    await expect(render(asRole(['sales']), NOTICE, disbursement.id)).rejects.toBeInstanceOf(NotFound);
    await expect(render(asRole(['purchasing']), RECEIPT, receipt.id)).rejects.toBeInstanceOf(NotFound);
    expect(await render(asRole(['viewer']), NOTICE, disbursement.id)).toContain('>支払通知書<');
  });

  it('AC-20 a role without read is refused and does not see the actions or their print declarations in /meta', async () => {
    for (const roles of [[], ['workforce_employee']]) {
      await expect(render(asRole(roles), RECEIPT, receipt.id)).rejects.toBeInstanceOf(PermissionDenied);
      const names = await run(asRole(roles), async (ctx) => appMeta(ctx).actions.map((a) => a.name));
      expect(names).not.toContain(RECEIPT);
      expect(names).not.toContain(NOTICE);
    }
    const meta = await run(asRole(['sales']), async (ctx) => appMeta(ctx).actions);
    expect(meta.find((a) => a.name === RECEIPT)?.print).toEqual({
      entity: 'payment',
      label: { ja: '領収書を表示', en: 'View receipt' },
      idInput: 'id',
      when: { direction: 'receive' },
    });
  });

  it('AC-21 a store-limited context is refused (no storeAccess on transaction documents)', async () => {
    const storeScoped = { ...asRole(['accounting']), accessScope: 'stores' as const, storeIds: [newId()] };
    await expect(render(storeScoped, RECEIPT, receipt.id)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-19 another company and an unknown id are NOT_FOUND', async () => {
    const otherCompanyId = newId();
    await db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: db.tenantId, code: 'OTHER-P', name: '別会社' });
    await expect(render({ companyId: otherCompanyId }, RECEIPT, receipt.id)).rejects.toBeInstanceOf(NotFound);
    await expect(render({}, RECEIPT, newId())).rejects.toBeInstanceOf(NotFound);
  });

  it('AC-19 a related record the caller cannot read fails the render with the repository error (no partial HTML)', async () => {
    // A role defined only in this test: it may read payments and their lines, but not partners.
    const roles = [Payment, PaymentAllocation].map(
      (e) => e.config.permissions.roles as Record<string, readonly Op[] | undefined>,
    );
    for (const r of roles) r.print_probe = ['read'];
    try {
      await expect(render(asRole(['print_probe']), RECEIPT, advanceOnly.id)).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
      // with allocations, the allocated sales invoice is the unreadable record
      await expect(render(asRole(['print_probe']), RECEIPT, receipt.id)).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    } finally {
      for (const r of roles) delete r.print_probe;
    }
  });
});
