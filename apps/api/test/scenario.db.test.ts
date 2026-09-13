// End-to-end scenario test: runs the business script docs/domain/scenario-kojin.md (個人事業・デザイン事務所の 2026年10月)
// against the real modules, in script order, and asserts EVERY expected figure of that document. It is the Phase 2
// baseline (台本): the same script is later replayed on Odoo/ERPNext, so expectations here follow the script literally —
// a difference between the system and the script is reported (docs/log/2026-09-11-scenario.md), never papered over.
// Test DB: daifuku_test_scenario (TEST_DATABASE_URL_OWNER / TEST_DATABASE_URL). Modules are registered by importing
// ../src/modules.ts (which also runs registerCrudActions); seeds run in a system context in module order, like
// apps/api/src/db/reset.ts. INV1 is created through the HTTP API (fastify inject) to prove the REST path matches the
// in-process path; everything else goes through runAction. INV4 (phase15-cleanup) is the rounding case: 3 lines of 1,111 at
// the reduced 8% rate → 266 when rounded once per rate, 264 if (wrongly) rounded per line. Step 11 is the period tax report.
import { AUTO_ISSUE_ON_SALES_KEY, AUTO_RECEIPT_ON_PURCHASE_KEY, boolSettingSchema } from '@daifuku/mod-inventory';
import {
  Decimal,
  DOCSTATUS,
  configureStorage,
  getCompany,
  LocalStorage,
  repo,
  runAction,
  setSetting,
  systemParams,
  withContext,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { JournalLine } from '@daifuku/mod-accounting';
import { SALES_ISSUER_KEY, salesIssuerSchema } from '@daifuku/mod-sales';
import { TAX_PRICE_INCLUDES_TAX_KEY, TAX_ROUNDING_KEY } from '@daifuku/mod-tax';
import type { FastifyInstance } from 'fastify';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modules } from '../src/modules.ts';
import { buildServer } from '../src/server.ts';

type Row = Record<string, unknown>;
type ListJson = { items: Row[]; total: number };
type Table = {
  title: { ja: string; en: string };
  columns: { key: string; kind: string }[];
  rows: Row[];
  totals?: Record<string, string>;
  meta?: Row;
};
type DocJson = Row & {
  id: string;
  number: string | null;
  docstatus: number;
  status: string;
  journalEntryId: string | null;
};
type InvoiceJson = DocJson & {
  partnerId: string;
  date: string;
  dueDate: string | null;
  priceIncludesTax: boolean;
  subtotal: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  balance: string;
};
type BillJson = InvoiceJson & {
  deductibleTax: string;
  nonDeductibleTax: string;
  creditRatio: string;
  supplierTaxStatus: string;
};
type PaymentJson = DocJson & { accountId: string; amount: string; allocatedAmount: string; unallocatedAmount: string };
/** [account code, debit, credit] of one posted journal line. */
type LineTriple = [string, string, string];
interface JsonResponse {
  status: number;
  body: Row & { error?: { code: string; message: string; hint: string; details?: Row } };
}

const JWT_SECRET = 'test-secret';
/** 2026-10-31 12:00 JST — "today" for every default (the script's cut-off date). */
const FIXED_NOW = new Date('2026-10-31T03:00:00Z');
const ISSUER = { name: 'ヨコヤマデザイン事務所', invoiceRegistrationNo: 'T1234567890123' };

let db: TestDb;
let app: FastifyInstance;
let token: string;
/** account code -> id, id -> code (chart of accounts seeded by l10n/jp). */
let acc: Record<string, string> = {};
let codeOf = new Map<string, string>();
const partner: Record<string, string> = {};
const product: Record<string, string> = {};
const inv: Record<string, InvoiceJson> = {};
const bill: Record<string, BillJson> = {};
const pay: Record<string, PaymentJson> = {};

const run = <T>(fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = {}): Promise<T> =>
  db.run({ now: () => FIXED_NOW, ...params }, fn);
const act = <T = Row>(name: string, input: unknown): Promise<T> =>
  run((ctx) => runAction(ctx, name, input)) as Promise<T>;
const sum = (values: readonly string[]): string => Decimal.sum(values.map((v) => Decimal.from(v))).toString();

async function call(
  method: 'GET' | 'POST',
  url: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<JsonResponse> {
  const t = opts.token === undefined ? token : opts.token;
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.statusCode, body: res.json() as JsonResponse['body'] };
}

/** Posted lines of a journal entry as [code, debit, credit] in seq order. */
async function entryLines(entryId: string | null): Promise<LineTriple[]> {
  if (!entryId) return [];
  return run(async (ctx) => {
    const lines = await repo(ctx, JournalLine).list({
      where: { entryId },
      orderBy: [{ field: 'seq', dir: 'asc' }],
      limit: 100,
    });
    return lines.items.map((l): LineTriple => [
      codeOf.get(l.accountId) ?? l.accountId,
      l.debit.toString(),
      l.credit.toString(),
    ]);
  });
}
/** Partner ids carried by the lines of an entry, keyed by account code. */
async function entryPartners(entryId: string | null): Promise<Record<string, string | null>> {
  if (!entryId) return {};
  return run(async (ctx) => {
    const lines = await repo(ctx, JournalLine).list({
      where: { entryId },
      orderBy: [{ field: 'seq', dir: 'asc' }],
      limit: 100,
    });
    return Object.fromEntries(
      lines.items.filter((l) => l.partnerId !== null).map((l) => [codeOf.get(l.accountId) ?? l.accountId, l.partnerId]),
    );
  });
}
/** Σ over lines of one account code within the entry. */
const sumOf = (lines: LineTriple[], code: string, side: 1 | 2): string =>
  sum(lines.filter((l) => l[0] === code).map((l) => l[side]));

async function createSubmit<T extends DocJson>(entity: string, head: Row): Promise<T> {
  const created = (await act<T>(`${entity}.create`, head)).id;
  await act(`${entity}.submit`, { id: created });
  return act<T>(`${entity}.get`, { id: created });
}

beforeAll(async () => {
  configureStorage(new LocalStorage(await mkdtemp(join(tmpdir(), 'daifuku-scenario-'))));
  db = await freshDb();
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: JWT_SECRET });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe('台本: 個人事業（デザイン事務所）の 2026年10月 (docs/domain/scenario-kojin.md)', () => {
  it('1. 会計年度 2026（accounting.open_fiscal_year）・モジュール登録・全シード（system context, モジュール順）・会社設定（tax.rounding は l10n/jp 既定, sales.issuer）', async () => {
    // Common business modules are loaded for every deployment (packs/modules are process-wide, ADR-0015).
    expect(modules.map((m) => m.name)).toEqual([
      'partner',
      'product',
      'tax',
      'accounting',
      'attachment',
      'sales',
      'purchase',
      'payment',
      'inventory',
      'contract',
      'workforce',
      'workforce_evidence',
      'industry_operations',
      'pos_integration',
      'group_accounting',
      'franchise',
      'edge',
      'trade',
      'banking',
      'tax_filing',
      'l10n_jp',
    ]);
    // 会計年度 2026-01-01〜12-31 through the action, before the seeds: the accounting seed only opens a year when none exists
    const opened = await act<{ fiscalYear: Row; periods: Row[] }>('accounting.open_fiscal_year', {
      startDate: '2026-01-01',
    });
    expect(opened.fiscalYear).toMatchObject({
      code: 'FY2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      isClosed: false,
    });
    expect(opened.periods).toHaveLength(12);
    const seeded: string[] = [];
    for (const m of modules) {
      if (!m.seed) continue;
      await withContext(db.owner, systemParams(db.tenantId, db.companyId, { now: () => FIXED_NOW }), async (ctx) =>
        m.seed?.(ctx),
      );
      seeded.push(m.name);
    }
    expect(seeded).toEqual(['partner', 'product', 'tax', 'accounting', 'inventory', 'workforce', 'l10n_jp']);

    // chart of accounts (l10n/jp): every code the script posts to exists
    const accounts = await act<ListJson>('account.list', { limit: 500, orderBy: [{ field: 'code', dir: 'asc' }] });
    acc = Object.fromEntries(accounts.items.map((a) => [String(a.code), String(a.id)]));
    codeOf = new Map(Object.entries(acc).map(([code, id]) => [id, code]));
    for (const code of ['1100', '1300', '1500', '2100', '2200', '3000', '4000', '6200', '6960', '6970', '6980'])
      expect(acc[code], `account ${code} seeded`).toBeDefined();

    // company settings: 税率ごと切捨て・請求書単位・税抜入力 come from the l10n/jp seed; the issuer block is the script's
    const company = await run(getCompany);
    expect(company.settings[TAX_ROUNDING_KEY]).toEqual({ mode: 'down', unit: 'invoice' });
    expect(company.settings[TAX_PRICE_INCLUDES_TAX_KEY]).toBe(false);
    expect(await act('tax.get_settings', {})).toEqual({
      rounding: { mode: 'down', unit: 'invoice' },
      priceIncludesTax: false,
    });
    await run((ctx) => setSetting(ctx, SALES_ISSUER_KEY, salesIssuerSchema, ISSUER));
    expect((await run(getCompany)).settings[SALES_ISSUER_KEY]).toEqual(ISSUER);
    // 台本 §会社設定: a design office keeps no stock — the books it sells (P3) were never purchased in the script, so the
    // inventory module's automatic issue on sales (default on) would refuse INV2/INV3/INV4 as negative stock. Turn it off.
    await run((ctx) => setSetting(ctx, AUTO_ISSUE_ON_SALES_KEY, boolSettingSchema, false));
    await run((ctx) => setSetting(ctx, AUTO_RECEIPT_ON_PURCHASE_KEY, boolSettingSchema, false));

    // the seeds left the one fiscal year alone (the accounting seed is a no-op when a year exists)
    const years = await act<ListJson>('fiscal_year.list', {});
    expect(years.total).toBe(1);
    expect(years.items[0]).toMatchObject({
      code: 'FY2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      isClosed: false,
    });
    const periods = await act<ListJson>('fiscal_period.list', {
      limit: 100,
      orderBy: [{ field: 'startDate', dir: 'asc' }],
    });
    expect(periods.total).toBe(12);
    expect(periods.items[9]).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-31', isClosed: false });
  });

  it('2. 取引先 C1..S3（C2: 20日締め翌月10日払い、S2: 免税事業者）と品目 P1..P4（P4: 軽減税率 8%）', async () => {
    const partners: Row[] = [
      { code: 'C1', name: '株式会社アルファ', isCustomer: true, taxStatus: 'registered' },
      {
        code: 'C2',
        name: 'ベータ商店',
        isCustomer: true,
        taxStatus: 'registered',
        closingDay: 20,
        paymentMonthOffset: 1,
        paymentDay: 10,
      },
      { code: 'C3', name: 'ガンマ（個人）', isCustomer: true },
      { code: 'S1', name: 'デルタ印刷', isSupplier: true, taxStatus: 'registered' },
      { code: 'S2', name: 'イプシロン写真スタジオ', isSupplier: true, taxStatus: 'exempt' },
      { code: 'S3', name: 'ゼータ不動産', isSupplier: true, taxStatus: 'registered' },
    ];
    for (const p of partners) {
      const created = await act<Row & { id: string }>('partner.create', p);
      partner[String(p.code)] = created.id;
      expect(created).toMatchObject(p);
    }
    // defaults: 月末締め翌月末払い
    expect(await act('partner.get', { id: partner.C1 })).toMatchObject({
      closingDay: 31,
      paymentMonthOffset: 1,
      paymentDay: 31,
      taxStatus: 'registered',
    });
    expect(await act('partner.get', { id: partner.S2 })).toMatchObject({ taxStatus: 'exempt' });
    // ひっかけ 2: C2 の期日計算 (10-20 → 締め 10-20 → 翌月 10 日)
    expect(await act('partner.compute_due_date', { partnerId: partner.C2, invoiceDate: '2026-10-20' })).toEqual({
      partnerId: partner.C2,
      invoiceDate: '2026-10-20',
      closingDate: '2026-10-20',
      dueDate: '2026-11-10',
    });

    const products: Row[] = [
      { code: 'P1', name: 'Webデザイン制作', kind: 'service', taxCategory: 'standard', salePrice: '100000' },
      { code: 'P2', name: 'ロゴ制作', kind: 'service', taxCategory: 'standard', salePrice: '50000' },
      { code: 'P3', name: 'デザイン素材集（書籍）', kind: 'goods', taxCategory: 'standard', salePrice: '3000' },
      { code: 'P4', name: '食品サンプル撮影用の菓子', kind: 'goods', taxCategory: 'reduced', salePrice: '1111' },
    ];
    for (const p of products) {
      const created = await act<Row & { id: string; uomId: string | null }>('product.create', p);
      product[String(p.code)] = created.id;
      expect(created).toMatchObject(p);
      expect(created.uomId, `${String(p.code)} gets the default unit (個)`).toEqual(expect.any(String));
    }
  });

  it('3. 期首 JE0: 元入金 300,000 → Dr 1100 普通預金 / Cr 3000 元入金（journal_entry 2 行、submit）', async () => {
    const je0 = await createSubmit<DocJson & { date: string; totalDebit: string; totalCredit: string }>(
      'journal_entry',
      {
        date: '2026-10-01',
        description: 'JE0 元入金',
        lines: {
          journal_line: [
            { accountId: acc['1100'], debit: '300000' },
            { accountId: acc['3000'], credit: '300000' },
          ],
        },
      },
    );
    expect(je0).toMatchObject({
      docstatus: DOCSTATUS.submitted,
      number: 'JE-2026-000001',
      date: '2026-10-01',
      totalDebit: '300000',
      totalCredit: '300000',
    });
    expect(await entryLines(je0.id)).toEqual([
      ['1100', '300000', '0'],
      ['3000', '0', '300000'],
    ]);
  });

  it('4. 売上請求書 INV1..INV4（税抜入力、10% / INV4 は軽減 8% で税率ごとに 1 回丸め）: 金額・期日・転記 Dr 1300 / Cr 4000 / Cr 2200 — INV1 は REST 経由', async () => {
    // INV1 through the HTTP API: login → POST /api/sales_invoice (with lines) → submit → GET, then compare with the in-process read
    const login = await call('POST', '/auth/login', {
      body: { email: 'admin@example.com', password: 'password' },
      token: null,
    });
    expect(login.status).toBe(200);
    token = login.body.token as string;
    const created = await call('POST', '/api/sales_invoice', {
      body: {
        partnerId: partner.C1,
        date: '2026-10-05',
        lines: {
          sales_invoice_line: [
            { productId: product.P1, quantity: '1' },
            { productId: product.P2, quantity: '1' },
          ],
        },
      },
    });
    expect(created.status, JSON.stringify(created.body.error)).toBe(200);
    expect(created.body).toMatchObject({
      docstatus: DOCSTATUS.draft,
      status: 'draft',
      priceIncludesTax: false,
      subtotal: '150000',
      taxTotal: '15000',
      total: '165000',
      dueDate: '2026-11-30',
    });
    const restLines = (created.body.lines as { sales_invoice_line: Row[] }).sales_invoice_line;
    expect(restLines.map((l) => [l.description, l.quantity, l.unitPrice, l.amount, l.taxCategory])).toEqual([
      ['Webデザイン制作', '1', '100000', '100000', 'standard'],
      ['ロゴ制作', '1', '50000', '50000', 'standard'],
    ]);
    const submitted = await call('POST', `/api/sales_invoice/${created.body.id as string}/submit`);
    expect(submitted.status, JSON.stringify(submitted.body.error)).toBe(200);
    expect(submitted.body).toMatchObject({
      docstatus: DOCSTATUS.submitted,
      status: 'open',
      number: 'INV-2026-000001',
      balance: '165000',
      journalEntryId: expect.any(String),
    });
    const got = await call('GET', `/api/sales_invoice/${created.body.id as string}`);
    expect(got.status).toBe(200);
    const inProcess = await act<InvoiceJson>('sales_invoice.get', { id: created.body.id as string });
    expect(got.body).toEqual(inProcess);
    inv.INV1 = inProcess;

    inv.INV2 = await createSubmit<InvoiceJson>('sales_invoice', {
      partnerId: partner.C2,
      date: '2026-10-20',
      lines: { sales_invoice_line: [{ productId: product.P3, quantity: '10' }] },
    });
    inv.INV3 = await createSubmit<InvoiceJson>('sales_invoice', {
      partnerId: partner.C3,
      date: '2026-10-28',
      lines: {
        sales_invoice_line: [
          { productId: product.P2, quantity: '1' },
          { productId: product.P3, quantity: '3' },
        ],
      },
    });
    inv.INV4 = await createSubmit<InvoiceJson>('sales_invoice', {
      partnerId: partner.C1,
      date: '2026-10-30',
      lines: {
        sales_invoice_line: ['菓子A', '菓子B', '菓子C'].map((description) => ({
          productId: product.P4,
          quantity: '1',
          description,
        })),
      },
    });

    // the script's table
    const expected = [
      ['INV1', 'C1', '2026-10-05', '150000', '15000', '165000', '2026-11-30'],
      ['INV2', 'C2', '2026-10-20', '30000', '3000', '33000', '2026-11-10'],
      ['INV3', 'C3', '2026-10-28', '59000', '5900', '64900', '2026-11-30'],
      ['INV4', 'C1', '2026-10-30', '3333', '266', '3599', '2026-11-30'],
    ] as const;
    for (const [no, p, date, subtotal, taxTotal, total, dueDate] of expected) {
      const i = inv[no];
      expect(i).toBeDefined();
      if (!i) continue;
      expect(i).toMatchObject({
        docstatus: DOCSTATUS.submitted,
        status: 'open',
        partnerId: partner[p],
        date,
        priceIncludesTax: false,
        paidAmount: '0',
      });
      expect(i.number).toMatch(/^INV-2026-\d{6}$/);
      expect.soft(i.subtotal, `${no} 税抜`).toBe(subtotal);
      expect.soft(i.taxTotal, `${no} 消費税`).toBe(taxTotal);
      expect.soft(i.total, `${no} 税込`).toBe(total);
      expect.soft(i.balance, `${no} 残高`).toBe(total);
      expect.soft(i.dueDate, `${no} 支払期日`).toBe(dueDate);
      // 転記: Dr 1300 売掛金（税込）／ Cr 4000 売上高（税抜）／ Cr 2200 仮受消費税（税額）
      const lines = await entryLines(i.journalEntryId);
      expect.soft(sumOf(lines, '1300', 1), `${no} Dr 1300`).toBe(total);
      expect.soft(sumOf(lines, '4000', 2), `${no} Cr 4000`).toBe(subtotal);
      expect.soft(sumOf(lines, '2200', 2), `${no} Cr 2200`).toBe(taxTotal);
      expect(new Set(lines.map((l) => l[0])), `${no} posts to 1300 / 4000 / 2200 only`).toEqual(
        new Set(['1300', '4000', '2200']),
      );
      expect((await entryPartners(i.journalEntryId))['1300'], `${no} 売掛金 line carries the customer`).toBe(
        partner[p],
      );
    }
    expect(await entryLines(inv.INV1?.journalEntryId ?? null)).toEqual([
      ['1300', '165000', '0'],
      ['4000', '0', '100000'],
      ['4000', '0', '50000'],
      ['2200', '0', '15000'],
    ]);
    expect(await entryLines(inv.INV2?.journalEntryId ?? null)).toEqual([
      ['1300', '33000', '0'],
      ['4000', '0', '30000'],
      ['2200', '0', '3000'],
    ]);
    expect(await entryLines(inv.INV3?.journalEntryId ?? null)).toEqual([
      ['1300', '64900', '0'],
      ['4000', '0', '50000'],
      ['4000', '0', '9000'],
      ['2200', '0', '5900'],
    ]);
    // INV4 (ひっかけ 6): 3 lines × 1,111 at reduced 8%; revenue per line (税抜入力), ONE 仮受消費税 line for the rate
    expect(await entryLines(inv.INV4?.journalEntryId ?? null)).toEqual([
      ['1300', '3599', '0'],
      ['4000', '0', '1111'],
      ['4000', '0', '1111'],
      ['4000', '0', '1111'],
      ['2200', '0', '266'],
    ]);
    const inv4Lines = ((inv.INV4?.lines ?? {}) as { sales_invoice_line?: Row[] }).sales_invoice_line ?? [];
    expect(inv4Lines.map((l) => [l.description, l.quantity, l.unitPrice, l.amount, l.taxCategory])).toEqual([
      ['菓子A', '1', '1111', '1111', 'reduced'],
      ['菓子B', '1', '1111', '1111', 'reduced'],
      ['菓子C', '1', '1111', '1111', 'reduced'],
    ]);
    expect(inv.INV4?.taxSummary).toMatchObject([
      { category: 'reduced', rate: '0.08', taxable: '3333', tax: '266', gross: '3599', lineCount: 3 },
    ]);
    // 税率ごとに 1 回丸め: 3,333 × 0.08 = 266.64 → 266. Rounding each line (1,111 × 0.08 = 88.88 → 88, × 3) would give 264 —
    // the per-invoice-per-rate rule (docs/domain/japan-tax.md#rounding) forbids that, so the invoice must NOT show 264.
    const perLineRounded = sum(
      inv4Lines.map((l) => Decimal.from(String(l.amount)).times(Decimal.from('0.08')).round('down', 0).toString()),
    );
    expect(perLineRounded, '行ごとに丸めた場合の税額（誤り）').toBe('264');
    expect(inv.INV4?.taxTotal, 'INV4 消費税は行ごと丸めの 264 ではない').not.toBe('264');
    // 計
    const all = [inv.INV1, inv.INV2, inv.INV3, inv.INV4].filter((i): i is InvoiceJson => i !== undefined);
    expect(all).toHaveLength(4);
    expect.soft(sum(all.map((i) => i.subtotal)), '売上 税抜 計 239,000 + 3,333').toBe('242333');
    expect.soft(sum(all.map((i) => i.taxTotal)), '売上 消費税 計 23,900 + 266').toBe('24166');
    expect.soft(sum(all.map((i) => i.total)), '売上 税込 計 262,900 + 3,599').toBe('266499');
  });

  it('5. 仕入・経費請求書 BILL1..BILL4（税込入力）: 税抜・税額・控除率（S2 は l10n/jp の 70%）・控除対象外・転記', async () => {
    bill.BILL1 = await createSubmit<BillJson>('purchase_invoice', {
      partnerId: partner.S1,
      date: '2026-10-08',
      lines: { purchase_invoice_line: [{ accountId: acc['6960'], description: '名刺印刷', unitPrice: '22000' }] },
    });
    bill.BILL2 = await createSubmit<BillJson>('purchase_invoice', {
      partnerId: partner.S2,
      date: '2026-10-15',
      lines: { purchase_invoice_line: [{ accountId: acc['6980'], description: '撮影', unitPrice: '55000' }] },
    });
    bill.BILL3 = await createSubmit<BillJson>('purchase_invoice', {
      partnerId: partner.S3,
      date: '2026-10-25',
      lines: { purchase_invoice_line: [{ accountId: acc['6200'], description: '10月分家賃', unitPrice: '80000' }] },
    });
    bill.BILL4 = await createSubmit<BillJson>('purchase_invoice', {
      partnerId: partner.S1,
      date: '2026-10-30',
      lines: {
        purchase_invoice_line: [
          { accountId: acc['6970'], description: '会議用飲料', unitPrice: '5400', taxCategory: 'reduced' },
        ],
      },
    });

    const expected = [
      // no, partner, date, taxCategory of the line, 税込, 税抜, 消費税, 控除率, 控除対象, 控除対象外
      ['BILL1', 'S1', '2026-10-08', 'standard', '22000', '20000', '2000', '1', '2000', '0'],
      ['BILL2', 'S2', '2026-10-15', 'standard', '55000', '50000', '5000', '0.7', '3500', '1500'],
      ['BILL3', 'S3', '2026-10-25', 'non_taxable', '80000', '80000', '0', '1', '0', '0'],
      ['BILL4', 'S1', '2026-10-30', 'reduced', '5400', '5000', '400', '1', '400', '0'],
    ] as const;
    for (const [no, p, date, category, total, subtotal, taxTotal, ratio, deductible, nonDeductible] of expected) {
      const b = bill[no];
      expect(b).toBeDefined();
      if (!b) continue;
      expect(b).toMatchObject({
        docstatus: DOCSTATUS.submitted,
        status: 'open',
        partnerId: partner[p],
        date,
        priceIncludesTax: true,
        paidAmount: '0',
      });
      expect(b.number).toMatch(/^BILL-2026-\d{6}$/);
      const lines = (b.lines as { purchase_invoice_line: Row[] }).purchase_invoice_line;
      expect(
        lines.map((l) => l.taxCategory),
        `${no} 税区分（科目既定 or 明示）`,
      ).toEqual([category]);
      expect.soft(b.total, `${no} 税込`).toBe(total);
      expect.soft(b.subtotal, `${no} 税抜`).toBe(subtotal);
      expect.soft(b.taxTotal, `${no} 消費税`).toBe(taxTotal);
      expect.soft(b.creditRatio, `${no} 控除率`).toBe(ratio);
      expect.soft(b.deductibleTax, `${no} 控除対象`).toBe(deductible);
      expect.soft(b.nonDeductibleTax, `${no} 控除対象外`).toBe(nonDeductible);
      expect.soft(b.balance, `${no} 残高`).toBe(total);
      expect((await entryPartners(b.journalEntryId))['2100'], `${no} 買掛金 line carries the supplier`).toBe(
        partner[p],
      );
    }
    expect(bill.BILL2?.supplierTaxStatus).toBe('exempt');
    // 転記（例 BILL2）: Dr 6980 50,000 ／ Dr 1500 仮払消費税 3,500 ／ Dr 6980 1,500（控除対象外消費税）／ Cr 2100 買掛金 55,000
    expect(await entryLines(bill.BILL2?.journalEntryId ?? null)).toEqual([
      ['6980', '50000', '0'],
      ['1500', '3500', '0'],
      ['6980', '1500', '0'],
      ['2100', '0', '55000'],
    ]);
    const bill2Memos = await run(async (ctx) =>
      (
        await repo(ctx, JournalLine).list({
          where: { entryId: bill.BILL2?.journalEntryId ?? '' },
          orderBy: [{ field: 'seq', dir: 'asc' }],
          limit: 10,
        })
      ).items.map((l) => l.memo),
    );
    expect(bill2Memos[2], 'ひっかけ 5: 控除対象外消費税 1,500 は外注費（6980）に含める').toBe('控除対象外消費税');
    expect(await entryLines(bill.BILL1?.journalEntryId ?? null)).toEqual([
      ['6960', '20000', '0'],
      ['1500', '2000', '0'],
      ['2100', '0', '22000'],
    ]);
    expect(
      await entryLines(bill.BILL3?.journalEntryId ?? null),
      'ひっかけ 4: 非課税の家賃は仮払消費税を生まない',
    ).toEqual([
      ['6200', '80000', '0'],
      ['2100', '0', '80000'],
    ]);
    expect(await entryLines(bill.BILL4?.journalEntryId ?? null), 'ひっかけ 3: 軽減税率 8% の丸め').toEqual([
      ['6970', '5000', '0'],
      ['1500', '400', '0'],
      ['2100', '0', '5400'],
    ]);
    // 計
    const all = [bill.BILL1, bill.BILL2, bill.BILL3, bill.BILL4].filter((b): b is BillJson => b !== undefined);
    expect.soft(sum(all.map((b) => b.total)), '仕入 税込 計').toBe('162400');
    expect.soft(sum(all.map((b) => b.subtotal)), '仕入 税抜 計').toBe('155000');
    expect.soft(sum(all.map((b) => b.taxTotal)), '仕入 消費税 計').toBe('7400');
    expect.soft(sum(all.map((b) => b.deductibleTax)), '仕入 控除対象 計').toBe('5900');
    expect.soft(sum(all.map((b) => b.nonDeductibleTax)), '仕入 控除対象外 計').toBe('1500');
  });

  it('6. 入出金 PAY1..PAY3（2026-10-31、普通預金 1100）: 消込で INV2 / BILL1 / BILL3 が paid', async () => {
    const mk = (
      direction: 'receive' | 'pay',
      p: string,
      amount: string,
      entity: 'sales_invoice' | 'purchase_invoice',
      invoiceId: string,
    ) =>
      createSubmit<PaymentJson>('payment', {
        direction,
        partnerId: partner[p],
        date: '2026-10-31',
        amount,
        method: 'bank_transfer',
        lines: { payment_allocation: [{ invoiceEntity: entity, invoiceId, amount }] },
      });
    pay.PAY1 = await mk('receive', 'C2', '33000', 'sales_invoice', inv.INV2?.id ?? '');
    pay.PAY2 = await mk('pay', 'S1', '22000', 'purchase_invoice', bill.BILL1?.id ?? '');
    pay.PAY3 = await mk('pay', 'S3', '80000', 'purchase_invoice', bill.BILL3?.id ?? '');
    for (const [no, amount] of [
      ['PAY1', '33000'],
      ['PAY2', '22000'],
      ['PAY3', '80000'],
    ] as const) {
      const p = pay[no];
      expect(p).toBeDefined();
      if (!p) continue;
      expect(p).toMatchObject({
        docstatus: DOCSTATUS.submitted,
        accountId: acc['1100'],
        amount,
        allocatedAmount: amount,
        unallocatedAmount: '0',
      });
      expect(p.number).toMatch(/^PAY-2026-\d{6}$/);
    }
    expect(await entryLines(pay.PAY1?.journalEntryId ?? null)).toEqual([
      ['1100', '33000', '0'],
      ['1300', '0', '33000'],
    ]);
    expect(await entryLines(pay.PAY2?.journalEntryId ?? null)).toEqual([
      ['2100', '22000', '0'],
      ['1100', '0', '22000'],
    ]);
    expect(await entryLines(pay.PAY3?.journalEntryId ?? null)).toEqual([
      ['2100', '80000', '0'],
      ['1100', '0', '80000'],
    ]);
    // 消込結果
    const status = async (entity: string, id: string | undefined) =>
      act<InvoiceJson>(`${entity}.get`, { id: id ?? '' });
    expect(await status('sales_invoice', inv.INV2?.id)).toMatchObject({
      status: 'paid',
      paidAmount: '33000',
      balance: '0',
    });
    expect(await status('purchase_invoice', bill.BILL1?.id)).toMatchObject({
      status: 'paid',
      paidAmount: '22000',
      balance: '0',
    });
    expect(await status('purchase_invoice', bill.BILL3?.id)).toMatchObject({
      status: 'paid',
      paidAmount: '80000',
      balance: '0',
    });
    expect(await status('sales_invoice', inv.INV1?.id)).toMatchObject({ status: 'open', balance: '165000' });
    expect(await status('sales_invoice', inv.INV3?.id)).toMatchObject({ status: 'open', balance: '64900' });
    expect(await status('sales_invoice', inv.INV4?.id)).toMatchObject({ status: 'open', balance: '3599' });
    expect(await status('purchase_invoice', bill.BILL2?.id)).toMatchObject({ status: 'open', balance: '55000' });
    expect(await status('purchase_invoice', bill.BILL4?.id)).toMatchObject({ status: 'open', balance: '5400' });
  });

  it('7. 期待値（2026-10-31）: 試算表 10/01〜10/31 の全行と合計 863,899、売掛金 233,499・買掛金 60,400・普通預金 231,000、損益 85,833', async () => {
    const tb = await act<Table>('accounting.trial_balance', { from: '2026-10-01', to: '2026-10-31' });
    expect(tb.meta).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    const byCode = new Map(tb.rows.map((r) => [String(r.code), r]));
    const expected: Record<string, [string, string, string]> = {
      '1100': ['333000', '102000', '231000'],
      '1300': ['266499', '33000', '233499'],
      '1500': ['5900', '0', '5900'],
      '2100': ['102000', '162400', '-60400'],
      '2200': ['0', '24166', '-24166'],
      '3000': ['0', '300000', '-300000'],
      '4000': ['0', '242333', '-242333'],
      '6200': ['80000', '0', '80000'],
      '6960': ['20000', '0', '20000'],
      '6970': ['5000', '0', '5000'],
      '6980': ['51500', '0', '51500'],
    };
    for (const [code, [debit, credit, balance]] of Object.entries(expected)) {
      const row = byCode.get(code);
      expect(row, `試算表に ${code} の行がある`).toBeDefined();
      if (!row) continue;
      expect.soft(row.openingDebit, `${code} 期首借方（期首ゼロ）`).toBe('0');
      expect.soft(row.openingCredit, `${code} 期首貸方（期首ゼロ）`).toBe('0');
      expect.soft(row.periodDebit, `${code} 借方`).toBe(debit);
      expect.soft(row.periodCredit, `${code} 貸方`).toBe(credit);
      expect.soft(row.closingBalance, `${code} 残高`).toBe(balance);
    }
    // every other account is idle
    for (const r of tb.rows) {
      if (expected[String(r.code)]) continue;
      expect
        .soft([r.periodDebit, r.periodCredit, r.closingBalance], `${String(r.code)} ${String(r.name)} has no movement`)
        .toEqual(['0', '0', '0']);
    }
    // 860,300 before INV4; + 3,599 on each side (Dr 売掛 3,599 / Cr 売上 3,333 + 仮受 266)
    expect.soft(tb.totals?.periodDebit, '合計 借方').toBe('863899');
    expect.soft(tb.totals?.periodCredit, '合計 貸方').toBe('863899');
    expect.soft(tb.totals?.closingBalance, '合計 残高').toBe('0');
    // the same report over HTTP is byte-for-byte the in-process result
    const viaHttp = await call('POST', '/actions/accounting.trial_balance', {
      body: { from: '2026-10-01', to: '2026-10-31' },
    });
    expect(viaHttp.status).toBe(200);
    expect(viaHttp.body).toEqual(tb);

    // 残高: 売掛金 233,499（INV1 165,000 + INV3 64,900 + INV4 3,599）、買掛金 60,400（BILL2 55,000 + BILL4 5,400）、普通預金 231,000
    const openInvoices = await act<ListJson>('sales_invoice.list', {
      where: { docstatus: DOCSTATUS.submitted, status: 'open' },
      orderBy: [{ field: 'date', dir: 'asc' }],
    });
    expect(openInvoices.items.map((i) => [i.id, i.balance])).toEqual([
      [inv.INV1?.id, '165000'],
      [inv.INV3?.id, '64900'],
      [inv.INV4?.id, '3599'],
    ]);
    expect.soft(sum(openInvoices.items.map((i) => String(i.balance))), '売掛金残高（請求書）').toBe('233499');
    const openBills = await act<ListJson>('purchase_invoice.list', {
      where: { docstatus: DOCSTATUS.submitted, status: 'open' },
      orderBy: [{ field: 'date', dir: 'asc' }],
    });
    expect(openBills.items.map((b) => [b.id, b.balance])).toEqual([
      [bill.BILL2?.id, '55000'],
      [bill.BILL4?.id, '5400'],
    ]);
    expect.soft(sum(openBills.items.map((b) => String(b.balance))), '買掛金残高（請求書）').toBe('60400');
    const ar = await act<Table>('payment.outstanding', { direction: 'receive' });
    expect.soft(ar.totals?.balance, '売掛金残高（payment.outstanding）').toBe('233499');
    expect(ar.rows.map((r) => r.number)).toEqual([inv.INV1?.number, inv.INV3?.number, inv.INV4?.number]);
    const ap = await act<Table>('payment.outstanding', { direction: 'pay' });
    expect.soft(ap.totals?.balance, '買掛金残高（payment.outstanding）').toBe('60400');
    expect(ap.rows.map((r) => r.number)).toEqual([bill.BILL2?.number, bill.BILL4?.number]);
    // the ledger agrees with the sub-ledgers
    expect.soft(byCode.get('1300')?.closingBalance, '売掛金（元帳）').toBe('233499');
    expect.soft(byCode.get('2100')?.closingBalance, '買掛金（元帳、貸方−）').toBe('-60400');
    const bank = await act<Table>('accounting.general_ledger', {
      accountId: acc['1100'],
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect.soft(bank.meta?.closingBalance, '普通預金 300,000 + 33,000 − 102,000').toBe('231000');
    expect(bank.totals).toEqual({ debit: '333000', credit: '102000', balance: '231000' });

    // 損益（10月）: 売上 242,333 − 費用 156,500 = 85,833 (from the trial balance rows by account type)
    const revenue = sum(
      tb.rows.filter((r) => r.type === 'revenue').map((r) => Decimal.from(String(r.closingBalance)).neg().toString()),
    );
    const expense = sum(tb.rows.filter((r) => r.type === 'expense').map((r) => String(r.closingBalance)));
    expect.soft(revenue, '売上（収益科目）239,000 + 3,333').toBe('242333');
    expect.soft(expense, '費用 80,000 + 20,000 + 5,000 + 51,500').toBe('156500');
    expect.soft(Decimal.from(revenue).minus(expense).toString(), '損益（10月）').toBe('85833');
  });

  it('8. 消費税の集計（10月）: 売上税額 24,166（課税売上 239,000 @10% → 23,900、3,333 @8% → 266）、仕入控除税額 5,900、差引 18,266', async () => {
    // straight from the posted journal lines of 仮受消費税 (2200) / 仮払消費税 (1500) by tax category and rate (the report is step 11)
    const october = {
      posted: true,
      $and: [{ entryDate: { $gte: '2026-10-01' } }, { entryDate: { $lte: '2026-10-31' } }],
    };
    const byRate = (accountCode: string) =>
      run(async (ctx) => {
        const rows = await repo(ctx, JournalLine).aggregate({
          where: { ...october, accountId: acc[accountCode] },
          groupBy: ['taxCategory', 'taxRate'],
          metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } },
        });
        return rows
          .map((r) => ({
            category: r.taxCategory as string | null,
            rate: r.taxRate === null ? null : Decimal.from(String(r.taxRate)).toString(),
            debit: (r.debit as Decimal).toString(),
            credit: (r.credit as Decimal).toString(),
          }))
          .sort((a, b) => String(a.rate).localeCompare(String(b.rate)));
      });
    const outputTax = await byRate('2200');
    expect(outputTax).toEqual([
      { category: 'reduced', rate: '0.08', debit: '0', credit: '266' },
      { category: 'standard', rate: '0.1', debit: '0', credit: '23900' },
    ]);
    const outputTotal = sum(outputTax.map((g) => g.credit));
    expect.soft(outputTotal, '売上税額 23,900 + 266').toBe('24166');
    const inputTax = await byRate('1500');
    expect(inputTax).toEqual([
      { category: 'reduced', rate: '0.08', debit: '400', credit: '0' },
      { category: 'standard', rate: '0.1', debit: '5500', credit: '0' },
    ]);
    expect.soft(sum(inputTax.map((g) => g.debit)), '仕入控除税額').toBe('5900');
    expect
      .soft(
        Decimal.from(outputTotal)
          .minus(Decimal.from(sum(inputTax.map((g) => g.debit))))
          .toString(),
        '差引（納付見込）24,166 − 5,900',
      )
      .toBe('18266');
    // 課税売上 239,000 @10% と 3,333 @8%: the revenue lines carry the category/rate; non-taxable rent never reaches 1500/2200 (ひっかけ 4)
    const taxableSales = await run(async (ctx) => {
      const rows = await repo(ctx, JournalLine).aggregate({
        where: { ...october, accountId: acc['4000'] },
        groupBy: ['taxCategory', 'taxRate'],
        metrics: { credit: { sum: 'credit' } },
      });
      return rows
        .map((r) => [
          String(r.taxCategory),
          Decimal.from(String(r.taxRate)).toString(),
          (r.credit as Decimal).toString(),
        ])
        .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    });
    expect(taxableSales).toEqual([
      ['reduced', '0.08', '3333'],
      ['standard', '0.1', '239000'],
    ]);
    const nonTaxable = await run(async (ctx) =>
      repo(ctx, JournalLine).aggregate({
        where: { ...october, taxCategory: 'non_taxable' },
        groupBy: ['accountId'],
        metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } },
      }),
    );
    expect(nonTaxable.map((r) => [codeOf.get(String(r.accountId)), (r.debit as Decimal).toString()])).toEqual([
      ['6200', '80000'],
    ]);
  });

  it('9. 売掛金年齢表（基準日 2026-12-05）: C1 168,599（INV1 165,000 + INV4 3,599）と C3 64,900 が 1〜30日、計 233,499', async () => {
    const aging = await act<Table>('sales.ar_aging', { asOf: '2026-12-05' });
    expect(aging.meta).toMatchObject({ asOf: '2026-12-05' });
    const byPartner = new Map(aging.rows.map((r) => [String(r.partnerId), r]));
    expect(byPartner.size).toBe(2);
    expect.soft(byPartner.get(partner.C1 ?? ''), 'C1 株式会社アルファ').toMatchObject({
      partnerName: '株式会社アルファ',
      notDue: '0',
      days1to30: '168599',
      days31to60: '0',
      days61to90: '0',
      over90: '0',
      total: '168599',
    });
    expect.soft(byPartner.get(partner.C3 ?? ''), 'C3 ガンマ（個人）').toMatchObject({
      partnerName: 'ガンマ（個人）',
      notDue: '0',
      days1to30: '64900',
      days31to60: '0',
      days61to90: '0',
      over90: '0',
      total: '64900',
    });
    expect
      .soft(aging.totals, '年齢表 合計')
      .toEqual({ notDue: '0', days1to30: '233499', days31to60: '0', days61to90: '0', over90: '0', total: '233499' });
    // the same asOf over HTTP, and the buckets move with the reference day (11-30 = due date → 期日前)
    const viaHttp = await call('POST', '/actions/sales.ar_aging', { body: { asOf: '2026-12-05' } });
    expect(viaHttp.body).toEqual(aging);
    const onDue = await act<Table>('sales.ar_aging', { asOf: '2026-11-30' });
    expect(onDue.totals).toMatchObject({ notDue: '233499', days1to30: '0' });
  });

  it('10. 適格請求書（INV3）: 登録番号 T1234567890123、10% 対象 59,000 / 消費税 5,900 / 税込 64,900、宛名、支払期限 2026-11-30（令和8年11月30日）', async () => {
    const { html } = await act<{ html: string }>('sales.render_invoice_html', { id: inv.INV3?.id ?? '' });
    expect(html.startsWith('<!DOCTYPE html>'), 'l10n/jp layout is active (registry override sales.invoice_html)').toBe(
      true,
    );
    expect(html).toContain('ヨコヤマデザイン事務所');
    expect(html).toContain('登録番号 T1234567890123');
    expect(html).toContain(`請求書番号</th><td>${inv.INV3?.number ?? ''}`);
    expect(html).toContain('ガンマ（個人） 御中');
    // 税率ごとの区分: 10% 対象 59,000、消費税 5,900、税込 64,900
    expect(html).toContain(
      '<th scope="row">10%対象</th><td class="num">¥59,000</td><td class="num">¥5,900</td><td class="num">¥64,900</td>',
    );
    expect(html).toContain(
      '<th scope="row">合計</th><td class="num">¥59,000</td><td class="num">¥5,900</td><td class="num">¥64,900</td>',
    );
    expect(html).toContain('ご請求金額（税込）</span><span class="value">¥64,900</span>');
    // lines: P2×1 50,000 + P3×3 9,000
    expect(html).toContain(
      '<td>ロゴ制作</td><td class="num">1</td><td class="num">¥50,000</td><td class="num">¥50,000</td><td class="center">10%</td>',
    );
    expect(html).toContain(
      '<td>デザイン素材集（書籍）</td><td class="num">3</td><td class="num">¥3,000</td><td class="num">¥9,000</td><td class="center">10%</td>',
    );
    // dates: 発行日 2026-10-28 / 支払期限 2026-11-30, printed as 西暦（和暦）
    expect(html).toContain('発行日</th><td>2026年10月28日（令和8年10月28日）</td>');
    expect(html).toContain('支払期限</th><td>2026年11月30日（令和8年11月30日）</td>');
    expect(html).toContain('令和8年11月30日');
    expect(
      html,
      'the script writes the due date as 2026-11-30; the jp layout prints 2026年11月30日 (same date, 西暦 in Japanese form)',
    ).toMatch(/2026-11-30|2026年11月30日/);
    // and over HTTP
    const viaHttp = await call('POST', '/actions/sales.render_invoice_html', { body: { id: inv.INV3?.id ?? '' } });
    expect(viaHttp.status).toBe(200);
    expect(viaHttp.body.html).toBe(html);
  });

  it('11. 消費税集計表（accounting.tax_period_summary 10/01〜10/31）: 売上 standard 239,000 / 23,900・reduced 3,333 / 266、仕入 3 行、totals 24,166 / 5,900 / 18,266', async () => {
    const t = await act<Table>('accounting.tax_period_summary', { from: '2026-10-01', to: '2026-10-31' });
    expect(t.title).toEqual({
      ja: '消費税集計表 2026-10-01〜2026-10-31',
      en: 'Consumption tax summary 2026-10-01..2026-10-31',
    });
    expect(t.meta).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    // [side, taxCategory, taxRate, taxableAmount, taxAmount, count]; count = posted journal lines grouped into the row
    // (base lines + tax lines, services/tax-summary.ts), not documents
    expect(t.rows.map((r) => [r.side, r.taxCategory, r.taxRate, r.taxableAmount, r.taxAmount, r.count])).toEqual([
      ['売上', 'standard', '0.10', '239000', '23900', 8], // 4000: INV1 2 + INV2 1 + INV3 2; 2200: one per invoice = 3
      ['売上', 'reduced', '0.08', '3333', '266', 4], // 4000: INV4 3 (per line, 税抜入力); 2200: 1 (one per rate)
      ['仕入', 'standard', '0.10', '70000', '5500', 4], // 6960 BILL1 + 6980 BILL2; 1500 BILL1 + BILL2 (控除対象外 1,500 has no category)
      ['仕入', 'reduced', '0.08', '5000', '400', 2], // 6970 BILL4; 1500 BILL4
      ['仕入', 'non_taxable', '0.00', '80000', '0', 1], // 6200 BILL3 (no tax line)
    ]);
    expect(t.rows.map((r) => r.taxCategoryLabel)).toEqual(['標準税率', '軽減税率', '標準税率', '軽減税率', '非課税']);
    expect(t.totals).toEqual({ output_tax_total: '24166', input_tax_total: '5900', net_tax_due: '18266' });
    // the report agrees with the ledger: 仮受消費税 (2200) and 仮払消費税 (1500) closing balances of the trial balance
    const tb = await act<Table>('accounting.trial_balance', { from: '2026-10-01', to: '2026-10-31' });
    const closing = (code: string) => String(tb.rows.find((r) => r.code === code)?.closingBalance);
    expect(Decimal.from(closing('2200')).neg().toString(), 'output_tax_total = −2200').toBe(t.totals?.output_tax_total);
    expect(closing('1500'), 'input_tax_total = 1500').toBe(t.totals?.input_tax_total);
    // and over HTTP
    const viaHttp = await call('POST', '/actions/accounting.tax_period_summary', {
      body: { from: '2026-10-01', to: '2026-10-31' },
    });
    expect(viaHttp.status).toBe(200);
    expect(viaHttp.body).toEqual(t);
  });
});
