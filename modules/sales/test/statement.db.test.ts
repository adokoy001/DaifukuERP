// docs/specs/print-templates.md AC-7, AC-15, AC-19, AC-22: sales.render_statement_html against Postgres — the
// closing-period boundaries (day after the previous closing date, the closing date, month end, February), what is
// excluded (drafts, cancelled, other partners, other periods, another company), sums of stored values, the default
// closing date, refusals and the print declaration in /meta. Test DB: TEST_DATABASE_URL*.
import {
  appMeta,
  companies,
  newId,
  NotFound,
  PermissionDenied,
  registerCrudActions,
  repo,
  runAction,
  systemParams,
  withContext,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Account } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { formatMoney, sumDecimals } from '@daifuku/mod-print-layout';
import { seedUoms } from '@daifuku/mod-product';
import { TaxModule } from '@daifuku/mod-tax';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesInvoice } from '../src/index.ts';

type Inv = { id: string; number: string; date: string; subtotal: string; taxTotal: string; total: string };
/** 2026-10-30 12:00 JST */
const NOW = new Date('2026-10-30T03:00:00Z');
let db: TestDb;
let customer20: string;
let customerEom: string;
let otherCustomer: string;
let supplierOnly: string;
let emptyCustomer: string;
const inv: Record<string, Inv> = {};

const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) =>
  db.run({ now: () => NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const statement = (params: Partial<ContextParams>, input: Record<string, unknown>) =>
  run(params, async (ctx) => ((await runAction(ctx, 'sales.render_statement_html', input)) as { html: string }).html);

async function invoice(
  partnerId: string,
  date: string,
  opts: { submit?: boolean; cancel?: boolean; price?: string } = {},
) {
  return run({}, async (ctx) => {
    const created = (await runAction(ctx, 'sales_invoice.create', {
      partnerId,
      date,
      lines: {
        sales_invoice_line: [
          { description: '標準品', unitPrice: opts.price ?? '1001', taxCategory: 'standard' },
          { description: '軽減品', unitPrice: '333', taxCategory: 'reduced' },
        ],
      },
    })) as Inv;
    if (opts.submit === false) return (await runAction(ctx, 'sales_invoice.get', { id: created.id })) as Inv;
    await runAction(ctx, 'sales_invoice.submit', { id: created.id });
    if (opts.cancel) await runAction(ctx, 'sales_invoice.cancel', { id: created.id });
    return (await runAction(ctx, 'sales_invoice.get', { id: created.id })) as Inv;
  });
}

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await withContext(db.app, systemParams(db.tenantId, db.companyId, { now: () => NOW }), async (ctx) => {
    await seedUoms(ctx);
    await TaxModule.seed?.(ctx);
  });
  await run({}, (ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-01-01' }));
  for (const [code, name, type, extra] of [
    ['1300', '売掛金', 'asset', { subtype: '売掛金', partnerRequired: true }],
    ['4000', '売上高', 'revenue', { subtype: '売上' }],
    ['2200', '仮受消費税', 'liability', { subtype: '仮受消費税' }],
  ] as const)
    await run({}, (ctx) => repo(ctx, Account).create({ code, name, type, ...extra }));
  const partner = (values: Record<string, unknown>) =>
    run({}, async (ctx) => (await repo(ctx, Partner).create({ name: 'x', ...values } as never)).id);
  customer20 = await partner({
    name: '二十日締め商事',
    isCustomer: true,
    closingDay: 20,
    paymentMonthOffset: 1,
    paymentDay: 31,
    postalCode: '150-0001',
    prefecture: '東京都',
    address1: '渋谷区2-2',
  });
  customerEom = await partner({ name: '月末締め商事', isCustomer: true, closingDay: 31 });
  otherCustomer = await partner({ name: '別の得意先', isCustomer: true, closingDay: 20 });
  supplierOnly = await partner({ name: '仕入専業', isSupplier: true, closingDay: 20 });
  emptyCustomer = await partner({ name: '請求なし商事', isCustomer: true, closingDay: 20 });
  inv.prevClosing = await invoice(customer20, '2026-09-20');
  inv.firstDay = await invoice(customer20, '2026-09-21');
  inv.middle = await invoice(customer20, '2026-10-05', { price: '20000' });
  inv.closingDay = await invoice(customer20, '2026-10-20');
  inv.nextPeriod = await invoice(customer20, '2026-10-21');
  inv.draft = await invoice(customer20, '2026-10-10', { submit: false });
  inv.cancelled = await invoice(customer20, '2026-10-12', { cancel: true });
  inv.otherPartner = await invoice(otherCustomer, '2026-10-10');
  inv.janEnd = await invoice(customerEom, '2026-01-31');
  inv.febFirst = await invoice(customerEom, '2026-02-01');
  inv.febEnd = await invoice(customerEom, '2026-02-28');
  inv.marFirst = await invoice(customerEom, '2026-03-01');
});
afterAll(async () => {
  await db?.close();
});

const has = (html: string, i: Inv) => html.includes(`>${i.number}<`);

describe('sales.render_statement_html (docs/specs/print-templates.md)', () => {
  it('AC-15 AC-22 the period (2026-09-20, 2026-10-20]: only submitted invoices of the partner, by date then number', async () => {
    const html = await statement(asRole(['sales']), { partnerId: customer20, closingDate: '2026-10-20' });
    const included = [inv.firstDay, inv.middle, inv.closingDay].map((i) => i as Inv);
    for (const i of included) expect(has(html, i), i.date).toBe(true);
    for (const i of [inv.prevClosing, inv.nextPeriod, inv.draft, inv.cancelled, inv.otherPartner].map((i) => i as Inv))
      expect(has(html, i), i.date).toBe(false);
    const positions = included.map((i) => html.indexOf(`>${i.number}<`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('二十日締め商事 御中');
    expect(html).toContain('2026年9月21日 〜 2026年10月20日');
    expect(html).toContain('お支払期限'); // every listed invoice is due 2026-11-30
  });

  it('AC-7 AC-15 the totals are sums of the stored invoice values', async () => {
    const html = await statement({}, { partnerId: customer20, closingDate: '2026-10-20' });
    const included = [inv.firstDay, inv.middle, inv.closingDay].map((i) => i as Inv);
    const total = sumDecimals(included.map((i) => String(i.total)));
    const tax = sumDecimals(included.map((i) => String(i.taxTotal)));
    expect(html).toContain(`当期ご請求額合計（税込）</span> <strong style="margin-left:16px;">${formatMoney(total)}円`);
    expect(html).toContain(`>${formatMoney(tax)}<`);
    expect(html).toContain('入金済みの請求書を含みます');
  });

  it('AC-15 without closingDate: the latest closing date up to today (2026-10-30 -> 2026-10-20)', async () => {
    const explicit = await statement({}, { partnerId: customer20, closingDate: '2026-10-20' });
    expect(await statement({}, { partnerId: customer20 })).toBe(explicit);
  });

  it('AC-15 month-end closing in February: (2026-01-31, 2026-02-28]', async () => {
    const html = await statement({}, { partnerId: customerEom, closingDate: '2026-02-28' });
    expect(has(html, inv.febFirst as Inv)).toBe(true);
    expect(has(html, inv.febEnd as Inv)).toBe(true);
    expect(has(html, inv.janEnd as Inv)).toBe(false);
    expect(has(html, inv.marFirst as Inv)).toBe(false);
  });

  it('AC-15 a day that is not a closing date is VALIDATION on closingDate with the nearest closing dates', async () => {
    await expect(statement({}, { partnerId: customer20, closingDate: '2026-10-19' })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [expect.objectContaining({ path: 'closingDate' })] },
      hint: expect.stringMatching(/2026-09-20.*2026-10-20/),
    });
  });

  it('AC-15 a closing date after today prints the period so far with the 「締め前」 banner', async () => {
    const html = await statement({}, { partnerId: customer20, closingDate: '2026-11-20' });
    expect(html).toContain('締め前（期間途中） / Period not yet closed');
    expect(has(html, inv.nextPeriod as Inv)).toBe(true);
  });

  it('AC-15 zero invoices: the empty message and a zero total', async () => {
    const html = await statement({}, { partnerId: emptyCustomer, closingDate: '2026-10-20' });
    expect(html).toContain('この期間の確定済みの請求書はありません');
    expect(html).toContain('<strong style="margin-left:16px;">0円</strong>');
  });

  it('AC-15 a partner that is not a customer is INVALID_STATE', async () => {
    await expect(statement({}, { partnerId: supplierOnly })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('AC-22 another company: its partner id is NOT_FOUND, and its invoices never appear', async () => {
    const otherCompanyId = newId();
    await db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: db.tenantId, code: 'OTHER-S', name: '別会社' });
    await expect(statement({ companyId: otherCompanyId }, { partnerId: customer20 })).rejects.toBeInstanceOf(NotFound);
    await expect(statement({}, { partnerId: newId() })).rejects.toBeInstanceOf(NotFound);
    // An invoice of the other company cannot point at this partner at all: the company-scoped composite foreign key
    // (tenant_id, company_id, partner_id) refuses it even when written directly past the repository.
    const rows = (await db.owner.drizzle.select().from(SalesInvoice.table)) as Record<string, unknown>[];
    const source = rows.find((r) => r.id === (inv.middle as Inv).id) as Record<string, unknown>;
    await expect(
      db.owner.drizzle.insert(SalesInvoice.table).values({
        ...source,
        id: newId(),
        companyId: otherCompanyId,
        number: 'OTHER-COMPANY-INV',
        controlAccountId: null,
        journalEntryId: null,
      } as never),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23503' }) });
    const html = await statement({}, { partnerId: customer20, closingDate: '2026-10-20' });
    expect(html).not.toContain('OTHER-COMPANY-INV');
  });

  it('AC-19 AC-20 permission: sales_invoice read; purchasing is refused and has no print declaration in /meta', async () => {
    await expect(statement(asRole(['purchasing']), { partnerId: customer20 })).rejects.toBeInstanceOf(PermissionDenied);
    expect(await statement(asRole(['viewer']), { partnerId: customer20 })).toContain('>合計請求書<');
    const names = await run(asRole(['purchasing']), async (ctx) => appMeta(ctx).actions.map((a) => a.name));
    expect(names).not.toContain('sales.render_statement_html');
    const meta = await run(asRole(['sales']), async (ctx) => appMeta(ctx).actions);
    expect(meta.find((a) => a.name === 'sales.render_statement_html')?.print).toMatchObject({
      entity: 'partner',
      idInput: 'partnerId',
      when: { isCustomer: true },
      fields: { closingDate: { label: { ja: '締め日', en: 'Closing date' } } },
    });
    const storeScoped = { ...asRole(['sales']), accessScope: 'stores' as const, storeIds: [newId()] };
    await expect(statement(storeScoped, { partnerId: customer20 })).rejects.toBeInstanceOf(PermissionDenied);
  });
});
