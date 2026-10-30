// docs/specs/opening-balances.md over HTTP with every module registered: the golden check (AC-30) reads the four CSV
// fixtures, imports them through POST /actions/..., and compares the trial balance opening column, the clearing
// account, AR/AP aging and the inventory valuation with the files; AC-8 (body limit) and AC-7 (company isolation).
import { readFileSync } from 'node:fs';
import { Decimal, companies, newId, repo, runAction, systemParams, withContext } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { seedChartOfAccounts } from '@daifuku/l10n-jp';
import { openFiscalYear } from '@daifuku/mod-accounting';
import { seedWarehouses } from '@daifuku/mod-inventory';
import { Partner } from '@daifuku/mod-partner';
import { Product, seedUoms } from '@daifuku/mod-product';
import { seedTaxRates } from '@daifuku/mod-tax';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';

const NOW = new Date('2026-04-10T03:00:00Z');
let db: TestDb;
let app: FastifyInstance;
let admin: string;
let fiscalYearId: string;

type Cells = Record<string, string | null>;
type Table = { rows: Record<string, string | null>[]; totals?: Record<string, string> };

/** The fixtures are plain CSV without quotes (spec verification step 3): split lines and commas. */
function fixture(name: string): Cells[] {
  const text = readFileSync(new URL(`./fixtures/opening-balances/${name}.csv`, import.meta.url), 'utf8');
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const headers = (head ?? '').split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] === '' || cells[i] === undefined ? null : cells[i]]));
  });
}

async function post(action: string, body: unknown, token = admin) {
  return app.inject({
    method: 'POST',
    url: `/actions/${action}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
async function ok<T = Record<string, unknown>>(action: string, body: unknown): Promise<T> {
  const res = await post(action, body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as T;
}

beforeAll(async () => {
  db = await freshDb();
  app = await buildServer({ owner: db.owner, app: db.app, jwtSecret: 'test-secret' });
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'admin@example.com', password: 'password' },
  });
  admin = (login.json() as { token: string }).token;
  await withContext(db.app, systemParams(db.tenantId, db.companyId, { now: () => NOW }), async (ctx) => {
    await seedUoms(ctx);
    await seedTaxRates(ctx);
    await seedChartOfAccounts(ctx);
    await seedWarehouses(ctx);
    fiscalYearId = (await openFiscalYear(ctx, { startDate: '2026-04-01' })).fiscalYear.id;
    const terms = { closingDay: 31, paymentMonthOffset: 1, paymentDay: 31 };
    await repo(ctx, Partner).create({ code: 'C001', name: '得意先A', isCustomer: true, ...terms });
    await repo(ctx, Partner).create({ code: 'C002', name: 'B商事', isCustomer: true, ...terms });
    await repo(ctx, Partner).create({ code: 'S001', name: '仕入先A', isSupplier: true, ...terms });
    await repo(ctx, Product).create({ code: 'P001', name: '商品A', taxCategory: 'standard' });
    await repo(ctx, Product).create({ code: 'P002', name: '商品B', taxCategory: 'standard' });
  });
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('opening balances over HTTP (golden)', () => {
  it('AC-30: the four CSV files import and the trial balance, clearing account, aging and valuation equal the files', async () => {
    const journal = fixture('journal');
    const dry = await ok<{ committed: boolean; issues: unknown[] }>('accounting.import_opening_balances', {
      fiscalYearId,
      mode: 'dry-run',
      rows: journal,
    });
    expect(dry).toMatchObject({ committed: false, issues: [] });
    for (const [action, name] of [
      ['accounting.import_opening_balances', 'journal'],
      ['sales.import_opening_receivables', 'receivables'],
      ['purchase.import_opening_payables', 'payables'],
      ['inventory.import_opening_stock', 'stock'],
    ] as const) {
      const result = await ok<{ committed: boolean; summary: { errors: number } }>(action, {
        fiscalYearId,
        mode: 'execute',
        rows: fixture(name),
      });
      expect(result, name).toMatchObject({ committed: true, summary: { errors: 0 } });
    }

    // trial balance opening column = the journal CSV's net per account (debit − credit on one side)
    const tb = await ok<Table>('accounting.trial_balance', { from: '2026-04-01', to: '2027-03-31' });
    const expected = new Map<string, Decimal>();
    for (const row of journal) {
      const code = row.accountCode as string;
      const net = Decimal.from(row.debit ?? '0').minus(row.credit ?? '0');
      expected.set(code, (expected.get(code) ?? Decimal.zero()).plus(net));
    }
    for (const [code, net] of expected) {
      const row = tb.rows.find((r) => r.code === code);
      expect(row, code).toBeDefined();
      expect([row?.openingDebit, row?.openingCredit], code).toEqual(
        net.isNegative() ? ['0', net.abs().toString()] : [net.toString(), '0'],
      );
    }
    const clearing = tb.rows.find((r) => r.code === '3900');
    expect([clearing?.openingDebit ?? '0', clearing?.openingCredit ?? '0']).toEqual(['0', '0']);
    for (const row of tb.rows.filter((r) => !expected.has(String(r.code))))
      expect([row.openingDebit, row.openingCredit], String(row.code)).toEqual(['0', '0']);
    const status = await ok<{ clearing: { balance: string } }>('accounting.opening_balance_status', { fiscalYearId });
    expect(status.clearing.balance).toBe('0');

    // AR / AP aging as of the first day of the year = the receivable / payable CSV per partner and due date
    const ar = await ok<Table>('sales.ar_aging', { asOf: '2026-04-01' });
    expect(ar.rows.map((r) => [r.partnerName, r.total, r.notDue, r.days31to60])).toEqual([
      ['B商事', '50000', '50000', '0'],
      // 80,000 from 2026-01-31: month-end close, paid the next month-end (2026-02-28) -> 32 days overdue
      ['得意先A', '280000', '200000', '80000'],
    ]);
    const receivables = fixture('receivables');
    expect(ar.totals?.total).toBe(Decimal.sum(receivables.map((r) => Decimal.from(r.amount as string))).toString());
    const ap = await ok<Table>('purchase.ap_aging', { asOf: '2026-04-01' });
    expect(ap.rows.map((r) => [r.partnerName, r.balance, r.notDue])).toEqual([['仕入先A', '180000', '180000']]);

    // inventory valuation on the opening date = quantity × unit cost (round6) per product
    const valuation = await ok<Table>('inventory.valuation', { asOf: '2026-03-31' });
    const stock = fixture('stock');
    expect(valuation.rows.map((r) => [r.productCode, r.qty, r.value])).toEqual(
      stock.map((s) => [
        s.productCode,
        Decimal.from(s.quantity as string).toString(),
        Decimal.from(s.quantity as string)
          .times(s.unitCost as string)
          .roundHalfUp(6)
          .toString(),
      ]),
    );
    expect(valuation.totals?.value).toBe('119999.99999');
  });

  it('AC-8: a body over 2 MB is refused with 413 and a VALIDATION body', async () => {
    const huge = JSON.stringify({ fiscalYearId, mode: 'dry-run', rows: [{ memo: 'x'.repeat(2 * 1024 * 1024) }] });
    for (const action of [
      'accounting.import_opening_balances',
      'sales.import_opening_receivables',
      'purchase.import_opening_payables',
      'inventory.import_opening_stock',
    ]) {
      const res = await post(action, huge);
      expect(res.statusCode, action).toBe(413);
      expect(res.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    }
  });

  it('AC-7: another company sees nothing of the import and its trial balance has no opening column', async () => {
    const otherCompanyId = newId();
    await db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: db.tenantId, code: 'OBX', name: '別会社' });
    const other = { companyId: otherCompanyId, now: () => NOW };
    const tb = (await db.run(other, (ctx) =>
      runAction(ctx, 'accounting.trial_balance', { from: '2026-04-01', to: '2027-03-31' }),
    )) as Table;
    expect(tb.rows.every((r) => r.openingDebit === '0' && r.openingCredit === '0')).toBe(true);
    const err = await db
      .run(other, (ctx) => runAction(ctx, 'accounting.opening_balance_status', { fiscalYearId }))
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'no_fiscal_year' } });
  });
});
