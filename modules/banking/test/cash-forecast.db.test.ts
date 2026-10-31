// Postgres tests for docs/specs/cash-forecast.md: banking.cash_forecast and banking.cash_schedule over real documents —
// posted cash movements (netting, drafts, future dates), open invoice balances (partial receipt, paid, cancelled,
// overdue, negative), transfer reservations through prepare / export / cancel, contract billing (and its move to the
// receivables after generation), drafts, notes on unallocated and non-cash payments, the permission and company
// boundaries, missing cash accounts, input errors and the export path. Today is 2026-09-13 (fixture clock).
import {
  canExportAction,
  checkActionExport,
  companies,
  newId,
  registry,
  repo,
  runAction,
  tableResult,
  withContext,
  type Context,
  type ContextParams,
  type TableResult,
} from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  bankTransferDetail,
  bankTransferExportOutput,
  bankTransferView,
  cashForecastMeta,
  cashScheduleMeta,
  CASH_SOURCES,
  CASH_SOURCE_COLUMN,
  type CashForecastMeta,
} from '../src/contract.ts';
import { allById } from '../src/cash-sources.ts';
import { bankingFixture, required, type BankFixture } from './fixture.ts';

let f: BankFixture;
let s1: { id: string };
let s2: { id: string };
let p2: { id: string; version: number };
let contractId: string;
const RANGE = { from: '2026-09-01', to: '2026-10-31' };
type Params = Partial<ContextParams>;

async function act(name: string, input: unknown, params: Params = {}): Promise<TableResult> {
  return tableResult.parse(await f.run((ctx) => runAction(ctx, `banking.${name}`, input), params));
}
const forecast = (input: Record<string, unknown> = RANGE, params: Params = f.accounting) =>
  act('cash_forecast', input, params);
const schedule = (input: Record<string, unknown> = RANGE, params: Params = f.accounting) =>
  act('cash_schedule', input, params);
const metaOf = (t: TableResult): CashForecastMeta => cashForecastMeta.parse(t.meta);
const day = (t: TableResult, date: string) => required(t.rows.find((r) => r.date === date));

async function invoice(
  side: 'sales' | 'purchase',
  amount: string,
  dates: { date: string; dueDate: string },
  submit = true,
): Promise<{ id: string; version: number }> {
  const entity = side === 'sales' ? 'sales_invoice' : 'purchase_invoice';
  return f.run(async (ctx) => {
    const created = (await runAction(ctx, `${entity}.create`, {
      partnerId: f.partner.id,
      ...dates,
      lines: {
        [`${entity}_line`]: [
          {
            ...(side === 'purchase' ? { accountId: f.chart.get('5000') } : {}),
            description: '資金繰り試験',
            unitPrice: amount,
            taxCategory: 'exempt',
          },
        ],
      },
    })) as { id: string; version: number };
    if (!submit) return created;
    return (await runAction(ctx, `${entity}.submit`, { id: created.id })) as { id: string; version: number };
  });
}

async function payment(
  direction: 'receive' | 'pay',
  amount: string,
  date: string,
  allocations: { invoiceId: string; amount: string }[],
  accountId = f.ledgerId,
) {
  const invoiceEntity = direction === 'receive' ? 'sales_invoice' : 'purchase_invoice';
  await f.run(async (ctx) => {
    const draft = (await runAction(ctx, 'payment.create', {
      direction,
      partnerId: f.partner.id,
      date,
      amount,
      method: 'bank_transfer',
      accountId,
      ...(allocations.length
        ? { lines: { payment_allocation: allocations.map((a) => ({ ...a, invoiceEntity })) } }
        : {}),
    })) as { id: string };
    await runAction(ctx, 'payment.submit', { id: draft.id });
  });
}

async function journal(date: string, lines: [string, string, string][], submit = true, params: Params = {}) {
  await f.run(async (ctx) => {
    const entry = (await runAction(ctx, 'journal_entry.create', {
      date,
      description: '資金繰り試験',
      lines: {
        journal_line: lines.map(([code, debit, credit], i) => ({
          seq: i + 1,
          accountId: required(f.chart.get(code)),
          debit,
          credit,
        })),
      },
    })) as { id: string };
    if (submit) await runAction(ctx, 'journal_entry.submit', { id: entry.id });
  }, params);
}

beforeAll(async () => {
  f = await bankingFixture();
  const current = await f.run((ctx) => repo(ctx, Account).create({ code: '1110', name: '当座預金', type: 'asset' }));
  f.chart.set('1110', current.id);
  // ledger balance before 2026-09-01
  await journal('2026-08-15', [
    ['1100', '500000', '0'],
    ['4000', '0', '500000'],
  ]);
  s1 = await invoice('sales', '100000', { date: '2026-09-01', dueDate: '2026-09-30' });
  await payment('receive', '30000', '2026-09-10', [{ invoiceId: s1.id, amount: '30000' }]);
  s2 = await invoice('sales', '40000', { date: '2026-08-01', dueDate: '2026-09-05' });
  const paid = await invoice('sales', '20000', { date: '2026-09-01', dueDate: '2026-09-20' });
  await payment('receive', '20000', '2026-09-10', [{ invoiceId: paid.id, amount: '20000' }]);
  const cancelled = await invoice('sales', '60000', { date: '2026-09-01', dueDate: '2026-09-22' });
  await f.run((ctx) => runAction(ctx, 'sales_invoice.cancel', { id: cancelled.id }));
  await invoice('sales', '15000', { date: '2026-09-02', dueDate: '2026-09-25' }, false);
  await invoice('purchase', '50000', { date: '2026-09-01', dueDate: '2026-09-30' });
  p2 = await invoice('purchase', '25000', { date: '2026-09-01', dueDate: '2026-10-05' });
  await invoice('purchase', '8000', { date: '2026-09-02', dueDate: '2026-09-28' }, false);
  // paid from 当座預金, which is not a cash account: the invoice balance drops, the cash never appears
  const p3 = await invoice('purchase', '7000', { date: '2026-09-01', dueDate: '2026-09-15' });
  await payment('pay', '7000', '2026-09-12', [{ invoiceId: p3.id, amount: '7000' }], current.id);
  // advance received with nothing allocated
  await payment('receive', '12000', '2026-09-12', []);
  // transfer between cash accounts, a draft entry and a future-dated posted payment
  await journal('2026-09-11', [
    ['1100', '10000', '0'],
    ['1000', '0', '10000'],
  ]);
  await journal(
    '2026-09-11',
    [
      ['1100', '9999', '0'],
      ['4000', '0', '9999'],
    ],
    false,
  );
  await journal('2026-09-20', [
    ['5000', '3000', '0'],
    ['1100', '0', '3000'],
  ]);
  contractId = await f.run(async (ctx) => {
    const draft = (await runAction(ctx, 'contract.create', {
      partnerId: f.partner.id,
      title: '保守契約',
      startDate: '2026-09-01',
      billingDay: 20,
      lines: { contract_line: [{ description: '保守料', unitPrice: '31000', taxCategory: 'exempt' }] },
    })) as { id: string };
    await runAction(ctx, 'contract.submit', { id: draft.id });
    return draft.id;
  });
});
afterAll(async () => {
  await f?.db.close();
});

describe('cash forecast over real documents', () => {
  it('AC-1 AC-2 AC-5 AC-9: posted movements, open balances, overdue and notes for accounting', async () => {
    const result = await forecast();
    const meta = metaOf(result);
    expect(result.rows).toHaveLength(61);
    expect(result.columns.map((c) => c.key)).toEqual([
      'date',
      'postedIn',
      'postedOut',
      'receivables',
      'contracts',
      'payables',
      'transfers',
      'inflow',
      'outflow',
      'net',
      'balance',
    ]);
    expect(result.title).toEqual({
      ja: '資金繰り表 2026-09-01〜2026-10-31',
      en: 'Cash forecast 2026-09-01..2026-10-31',
    });
    // posted: 30,000 + 20,000 receipts on 09-10, the 12,000 advance on 09-12, the future 3,000 payment on 09-20;
    // the 1000 -> 1100 transfer, the draft entry and the 当座預金 payment move nothing
    expect(day(result, '2026-09-10')).toMatchObject({ postedIn: '50000', postedOut: '0' });
    expect(day(result, '2026-09-11')).toMatchObject({ postedIn: '0', postedOut: '0' });
    expect(day(result, '2026-09-12')).toMatchObject({ postedIn: '12000', postedOut: '0' });
    expect(day(result, '2026-09-20')).toMatchObject({ postedOut: '3000' });
    // scheduled from today: the partial receipt leaves 70,000; paid and cancelled invoices are gone
    expect(day(result, '2026-09-30')).toMatchObject({ receivables: '70000', payables: '50000' });
    expect(day(result, '2026-10-05')).toMatchObject({ payables: '25000', transfers: '0' });
    expect(day(result, '2026-10-31')).toMatchObject({ contracts: '31000' });
    expect(result.totals).toMatchObject({
      postedIn: '62000',
      postedOut: '3000',
      receivables: '70000',
      contracts: '31000',
      payables: '75000',
      transfers: '0',
      openingBalance: '500000',
      balance: '585000',
    });
    expect(meta).toMatchObject({
      today: '2026-09-13',
      openingBalance: '500000',
      openingBasis: 'ledger',
      ledgerBalance: '500000',
      closingBalance: '585000',
      minBalance: { date: '2026-09-01', balance: '500000' },
      missingAccountCodes: [],
      overdue: { count: 1, inflow: '40000', outflow: '0' },
      beforeFrom: { count: 0, inflow: '0', outflow: '0' },
      contractBacklog: { count: 0, subtotal: '0' },
      unallocated: { receive: { count: 1, amount: '12000' }, pay: { count: 0, amount: '0' } },
      uncountedPaymentAccounts: [{ code: '1110', name: '当座預金', count: 1, receive: '0', pay: '7000' }],
      notices: [],
      truncated: false,
    });
    expect(meta.cashAccounts.map((a) => [a.code, a.balance])).toEqual([
      ['1000', '0'],
      ['1100', '500000'],
    ]);
    expect(meta.sources).toContainEqual({ source: 'payroll', included: false, reason: 'permission' });
    expect(meta).not.toHaveProperty('unscheduledPayroll');
    expect(meta).not.toHaveProperty('closingBalanceWithDrafts');
  });

  it('AC-3 AC-4 AC-5: schedule rows match the day columns per source; drafts, paid and cancelled invoices are absent', async () => {
    const days = await forecast();
    const rows = await schedule();
    expect(cashScheduleMeta.parse(rows.meta)).toMatchObject({ truncated: false, rowCount: rows.rows.length });
    for (const row of days.rows)
      for (const source of CASH_SOURCES) {
        const column = CASH_SOURCE_COLUMN[source];
        if (!(column in row)) continue;
        const sum = rows.rows
          .filter((r) => r.date === row.date && r.source === source && r.inBalance && r.state === 'submitted')
          .reduce((acc, r) => acc + BigInt(String(r.amount)), 0n);
        expect(sum.toString()).toBe(String(row[column]));
      }
    expect(rows.rows.map((r) => [r.date, r.source, r.amount, r.overdue, r.inBalance])).toEqual([
      ['2026-09-30', 'sales_invoice', '70000', false, true],
      ['2026-09-30', 'purchase_invoice', '50000', false, true],
      ['2026-10-05', 'purchase_invoice', '25000', false, true],
      ['2026-10-31', 'contract', '31000', false, true],
      ['2026-09-05', 'sales_invoice', '40000', true, false],
    ]);
    const contract = required(rows.rows.find((r) => r.source === 'contract'));
    expect(contract).toMatchObject({ contractId, period: '2026-09', partnerName: 'カ)テスト', count: 1 });
    expect(rows.rows.find((r) => r.salesInvoiceId === s2.id)).toMatchObject({ dueDate: '2026-09-05' });
    expect(rows.totals).toMatchObject({ inflow: '101000', outflow: '75000', overdueInflow: '40000' });
  });

  it('AC-10 AC-11: includeOverdue places overdue receivables on today; drafts get their own columns without changing balance', async () => {
    const overdue = await forecast({ ...RANGE, includeOverdue: true });
    expect(day(overdue, '2026-09-13')).toMatchObject({ receivables: '40000' });
    expect(metaOf(overdue).closingBalance).toBe('625000');
    const drafts = await forecast({ ...RANGE, includeDrafts: true });
    expect(day(drafts, '2026-09-25')).toMatchObject({ draftInflow: '15000' });
    expect(day(drafts, '2026-09-28')).toMatchObject({ draftOutflow: '8000' });
    expect(metaOf(drafts)).toMatchObject({ closingBalance: '585000', closingBalanceWithDrafts: '592000' });
    expect(drafts.totals).toMatchObject({ balance: '585000', balanceWithDrafts: '592000' });
    const draftRows = (await schedule({ ...RANGE, includeDrafts: true })).rows.filter((r) => r.state === 'draft');
    expect(draftRows.map((r) => [r.source, r.amount, r.inBalance])).toEqual([
      ['sales_invoice', '15000', false],
      ['purchase_invoice', '8000', false],
    ]);
  });

  it('AC-28: the start date changes neither overdue nor the balances from today on', async () => {
    const a = await forecast({ from: '2026-09-01', to: '2026-10-31' });
    const b = await forecast({ from: '2026-09-11', to: '2026-10-31' });
    const c = await forecast({ from: '2026-09-20', to: '2026-10-31' });
    expect(metaOf(a).overdue).toEqual(metaOf(b).overdue);
    expect(metaOf(a).overdue).toEqual(metaOf(c).overdue);
    const tail = (t: TableResult) => t.rows.filter((r) => String(r.date) >= '2026-09-20').map((r) => r.balance);
    expect(tail(a)).toEqual(tail(b));
    expect(tail(a)).toEqual(tail(c));
    // from > today: the opening balance is projected from today .. from − 1
    expect(metaOf(c)).toMatchObject({ openingBasis: 'projected', ledgerBalance: '562000', openingBalance: '562000' });
  });

  it('AC-6: a reserved invoice moves to its transfer date through prepare and export, and back after cancel', async () => {
    const batch = await f.action(
      'prepare_transfer',
      {
        requestId: newId(),
        bankAccountId: f.account.id,
        accountVersion: f.account.version,
        transferDate: '2026-09-25',
        items: [
          {
            invoiceId: p2.id,
            expectedVersion: p2.version,
            expectedBalance: '25000',
            payeeId: f.payee.id,
            payeeVersion: f.payee.version,
          },
        ],
      },
      bankTransferDetail,
    );
    const prepared = await forecast();
    expect(day(prepared, '2026-09-25')).toMatchObject({ transfers: '25000' });
    expect(day(prepared, '2026-10-05')).toMatchObject({ payables: '0' });
    const row = required((await schedule()).rows.find((r) => r.purchaseInvoiceId === p2.id));
    expect(row).toMatchObject({ source: 'bank_transfer', date: '2026-09-25', dueDate: '2026-10-05' });
    const exported = await f.action(
      'export_transfer',
      { batchId: batch.id, expectedVersion: batch.version, format: 'canonical_csv', lineEnding: 'crlf' },
      bankTransferExportOutput,
    );
    expect(day(await forecast(), '2026-09-25')).toMatchObject({ transfers: '25000' });
    await f.action(
      'cancel_transfer',
      { batchId: batch.id, expectedVersion: exported.batch.version, reason: '銀行へ未送信のため取消' },
      bankTransferView,
    );
    const cancelled = await forecast();
    expect(day(cancelled, '2026-09-25')).toMatchObject({ transfers: '0' });
    expect(day(cancelled, '2026-10-05')).toMatchObject({ payables: '25000' });
  });

  it('AC-6: an invoice due after the period is placed on a transfer date inside it (paying before the due date)', async () => {
    const p4 = await invoice('purchase', '44000', { date: '2026-09-01', dueDate: '2026-12-31' });
    const unreserved = await forecast();
    expect(unreserved.totals).toMatchObject({ payables: '75000', transfers: '0' });
    expect((await schedule()).rows.find((r) => r.purchaseInvoiceId === p4.id)).toBeUndefined();
    const batch = await f.action(
      'prepare_transfer',
      {
        requestId: newId(),
        bankAccountId: f.account.id,
        accountVersion: f.account.version,
        transferDate: '2026-09-28',
        items: [
          {
            invoiceId: p4.id,
            expectedVersion: p4.version,
            expectedBalance: '44000',
            payeeId: f.payee.id,
            payeeVersion: f.payee.version,
          },
        ],
      },
      bankTransferDetail,
    );
    const reserved = await forecast();
    expect(day(reserved, '2026-09-28')).toMatchObject({ transfers: '44000' });
    expect(reserved.totals).toMatchObject({ payables: '75000', transfers: '44000' });
    expect([metaOf(unreserved).closingBalance, metaOf(reserved).closingBalance]).toEqual(['585000', '541000']);
    const row = required((await schedule()).rows.find((r) => r.purchaseInvoiceId === p4.id));
    expect(row).toMatchObject({ source: 'bank_transfer', date: '2026-09-28', dueDate: '2026-12-31', amount: '44000' });
    // a transfer date after `to` stays out, like any item scheduled after the period
    expect((await forecast({ from: '2026-09-01', to: '2026-09-27' })).totals).toMatchObject({ transfers: '0' });
    await f.action(
      'cancel_transfer',
      { batchId: batch.id, expectedVersion: batch.version, reason: '試験のため取消' },
      bankTransferView,
    );
    expect((await forecast()).totals).toMatchObject({ payables: '75000', transfers: '0' });
  });

  it('decision 3: keyset paging keeps every still-matching row when a read row leaves the filter between pages', async () => {
    // the open-invoice reads page 500 rows by id; partners stand in for invoices (same port, cheap to create)
    const marker = `頁送り-${newId().slice(-8)}`;
    await f.run(async (ctx) => {
      for (let i = 0; i < 501; i++) await repo(ctx, Partner).create({ name: `${marker}-${i}`, isCustomer: true });
    });
    const where = { name: { $like: `${marker}-%` }, isActive: true };
    let pages = 0;
    let changed = '';
    const read = await f.run((ctx) =>
      allById(async (q) => {
        const page = await repo(ctx, Partner).list(q);
        if (pages++ === 0) {
          // another transaction commits a change that drops the first row of page 1 out of the filter
          changed = required(page.items[0]).id;
          await f.run((other) => repo(other, Partner).update(changed, { isActive: false }));
        }
        return page;
      }, where),
    );
    const stillMatching = await f.run((ctx) => allById((q) => repo(ctx, Partner).list(q), where));
    expect(pages).toBe(2);
    expect(stillMatching).toHaveLength(500);
    // offset paging would have skipped the 501st row (offset 500 over 500 remaining rows)
    expect(read.map((p) => p.id)).toEqual(expect.arrayContaining(stillMatching.map((p) => p.id)));
    expect(read.map((p) => p.id)).toContain(changed);
    expect(read).toHaveLength(501);
  });

  it('AC-7: a generated and submitted contract invoice leaves the contract column and appears in receivables', async () => {
    await f.run((ctx) => runAction(ctx, 'contract.generate_invoices', { period: '2026-09', contractId, submit: true }));
    const result = await forecast();
    expect(day(result, '2026-10-31')).toMatchObject({ contracts: '0', receivables: '31000' });
    expect(metaOf(result).closingBalance).toBe('585000');
  });
});

describe('permissions, companies and inputs', () => {
  it('AC-13: general roles, payroll-only, site/store scopes, relay and no company are refused', async () => {
    for (const params of [
      { roles: ['viewer'] },
      { roles: ['sales'] },
      { roles: ['purchasing'] },
      { roles: ['workforce_payroll'] },
      { roles: ['accounting'], accessScope: 'sites' as const, siteIds: [newId()] },
      { roles: ['admin'], accessScope: 'stores' as const, storeIds: [newId()] },
      { roles: ['accounting'], actor: { type: 'relay' as const, id: newId() } },
      { roles: ['accounting'], companyId: null },
    ]) {
      await expect(forecast(RANGE, params)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(schedule(RANGE, params)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }
  });

  it('AC-14: payroll is included only for admin and accounting + workforce_payroll', async () => {
    for (const params of [
      { roles: ['admin'] },
      { roles: ['accounting', 'workforce_payroll'], actor: { type: 'user' as const, id: newId() } },
    ]) {
      const result = await forecast(RANGE, params);
      expect(result.columns.map((c) => c.key)).toContain('payroll');
      expect(metaOf(result).sources).toContainEqual({ source: 'payroll', included: true });
      expect(metaOf(result).notices).toEqual(['payroll_posted_overlap']);
      expect(metaOf(result).unscheduledPayroll).toEqual({ count: 0, netPay: '0' });
    }
    const accounting = await forecast(RANGE, { roles: ['accounting', 'workforce_hr'] });
    expect(accounting.columns.map((c) => c.key)).not.toContain('payroll');
  });

  it('AC-16: export is admin-only by role definitions and the export path returns the same rows and totals', async () => {
    for (const name of ['banking.cash_forecast', 'banking.cash_schedule']) {
      const action = registry.action(name);
      expect(await f.run(async (ctx) => canExportAction(ctx, action), f.accounting)).toBe(false);
      expect(await f.run(async (ctx) => canExportAction(ctx, action))).toBe(true);
      const plain = await f.run((ctx) => runAction(ctx, name, RANGE));
      const exported = await withContext(
        f.db.app,
        {
          tenantId: f.db.tenantId,
          companyId: f.db.companyId,
          actor: { type: 'user', id: f.db.adminUserId },
          roles: ['admin'],
          now: () => new Date('2026-09-13T03:00:00Z'),
        },
        async (ctx: Context) => {
          checkActionExport(ctx, action);
          return runAction(ctx, name, RANGE);
        },
        { snapshot: true },
      );
      expect(exported).toEqual(plain);
    }
    const schema = z.toJSONSchema(registry.action('banking.cash_forecast').input, {
      io: 'input',
      unrepresentable: 'any',
    }) as { properties: Record<string, { format?: string }>; additionalProperties: unknown; required: string[] };
    expect(schema.properties.from?.format).toBe('date');
    expect(schema.required).toEqual(['from', 'to']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('AC-17: invalid input is refused with the field path', async () => {
    for (const [input, path] of [
      [{ from: '2026-09-10', to: '2026-09-01' }, 'to'],
      [{ from: '2026-01-01', to: '2027-01-02' }, 'to'],
      [{ from: '2026-09-31', to: '2026-10-01' }, 'from'],
      [{ from: '2028-09-01', to: '2028-09-30' }, 'to'],
      [{ ...RANGE, unknown: true }, ''],
    ] as const) {
      const error = await forecast(input).then(
        () => null,
        (e: unknown) => e as { code: string; details: { issues: { path: string }[] } },
      );
      expect(error?.code).toBe('VALIDATION');
      expect(error?.details.issues.map((i) => i.path)).toContain(path);
    }
  });

  it('AC-15 AC-18: another company is isolated; missing cash accounts are refused or reported', async () => {
    const before = await forecast(RANGE, {});
    const otherCompanyId = newId();
    await f.db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: f.db.tenantId, code: 'CASH2', name: '別会社' });
    const other = { companyId: otherCompanyId };
    await expect(forecast(RANGE, other)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await f.run(async (ctx) => {
      await runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-01-01' });
      for (const [code, type] of [
        ['1100', 'asset'],
        ['1300', 'asset'],
        ['4000', 'revenue'],
        ['2200', 'liability'],
      ] as const)
        await repo(ctx, Account).create({ code, name: `別 ${code}`, type, partnerRequired: code === '1300' });
    }, other);
    const partial = await forecast(RANGE, other);
    expect(metaOf(partial).missingAccountCodes).toEqual(['1000']);
    await f.run(async (ctx) => {
      const partner = await repo(ctx, Partner).create({ name: '別取引先', isCustomer: true });
      const created = (await runAction(ctx, 'sales_invoice.create', {
        partnerId: partner.id,
        date: '2026-09-01',
        dueDate: '2026-09-30',
        lines: { sales_invoice_line: [{ description: '別会社', unitPrice: '999999', taxCategory: 'exempt' }] },
      })) as { id: string };
      await runAction(ctx, 'sales_invoice.submit', { id: created.id });
    }, other);
    const otherResult = await forecast(RANGE, other);
    expect(day(otherResult, '2026-09-30')).toMatchObject({ receivables: '999999' });
    const after = await forecast(RANGE, {});
    expect(after).toEqual(before);
  });
});
