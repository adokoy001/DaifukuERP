// Postgres tests for docs/specs/opening-balances.md — opening receivables (AC-6, AC-7, AC-15..AC-22, AC-26, AC-27,
// D-8, D-14, D-16, D-18), and how opening invoices stay off the print declarations and statements of
// docs/specs/print-templates.md (AC-3, AC-15). Test DB: TEST_DATABASE_URL*.
import {
  appMeta,
  companies,
  defineWriteCapability,
  newId,
  PermissionDenied,
  registerCrudActions,
  repo,
  runAction,
  setSetting,
  submitDocument,
  systemParams,
  withContext,
  withWriteCapability,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import {
  Account,
  FiscalPeriod,
  JournalEntry,
  JournalLine,
  openingImportResult,
  type OpeningImportResult,
} from '@daifuku/mod-accounting';
import { closingDateOf, Partner } from '@daifuku/mod-partner';
import { formatMoney } from '@daifuku/mod-print-layout';
import { Product, seedUoms } from '@daifuku/mod-product';
import { TaxModule } from '@daifuku/mod-tax';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SALES_ACCOUNTS_KEY, salesAccountsSchema, SalesInvoice, SalesInvoiceLine } from '../src/index.ts';

const NOW = new Date('2026-04-10T03:00:00Z');
let db: TestDb;
let fyId: string;
const acc: Record<string, string> = {};
const partner: Record<string, string> = {};

const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) =>
  db.run({ now: () => NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

type Row = Partial<Record<'partnerCode' | 'amount' | 'dueDate' | 'reference' | 'originalDate' | 'memo', string | null>>;
const importAr = (
  rows: Row[],
  mode: 'dry-run' | 'execute' = 'execute',
  params: Partial<ContextParams> = {},
): Promise<OpeningImportResult> =>
  run(params, async (ctx) =>
    openingImportResult.parse(
      await runAction(ctx, 'sales.import_opening_receivables', { fiscalYearId: fyId, mode, rows }),
    ),
  );
const openingInvoices = (partnerId?: string) =>
  run({}, (ctx) =>
    repo(ctx, SalesInvoice).list({
      where: { openingBalance: true, ...(partnerId ? { partnerId } : {}) },
      orderBy: [{ field: 'createdAt', dir: 'asc' }],
      limit: 500,
    }),
  );
const codesOf = (r: OpeningImportResult) => r.rows.map((row) => row.messages?.[0]?.code ?? row.status);

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await withContext(db.app, systemParams(db.tenantId, db.companyId, { now: () => NOW }), async (ctx) => {
    await seedUoms(ctx);
    await TaxModule.seed?.(ctx);
  });
  fyId = (
    (await run({}, (ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-04-01' }))) as {
      fiscalYear: { id: string };
    }
  ).fiscalYear.id;
  for (const [code, name, type, extra] of [
    ['1000', '現金', 'asset', {}],
    ['1300', '売掛金', 'asset', { partnerRequired: true }],
    ['2200', '仮受消費税', 'liability', { taxRole: 'output_tax' }],
    ['4000', '売上高', 'revenue', {}],
    ['3900', '期首残高仮勘定', 'equity', {}],
  ] as const)
    acc[code] = (await run({}, (ctx) => repo(ctx, Account).create({ code, name, type, ...extra }))).id;
  for (const [code, name] of [
    ['C001', '得意先A'],
    ['C002', 'B商事'],
    ['C003', 'C工業'],
    ['C004', '同名'],
    ['C005', '同名'],
  ] as const)
    partner[code] = (
      await run({}, (ctx) =>
        repo(ctx, Partner).create({
          code,
          name,
          isCustomer: true,
          closingDay: 31,
          paymentMonthOffset: 1,
          paymentDay: 31,
        }),
      )
    ).id;
});
afterAll(async () => {
  await db?.close();
});

describe('opening receivables: input and request checks', () => {
  it('AC-15: amounts, dates, partners and $ctx. cells are classified per row; a dry-run writes nothing', async () => {
    const result = await importAr(
      [
        { partnerCode: 'C001', amount: '0' },
        { partnerCode: 'C001', amount: '' },
        { partnerCode: 'C001', amount: '-1' },
        { partnerCode: 'C001', amount: '1.5' },
        { partnerCode: 'C001', amount: 'x' },
        { partnerCode: 'C001', amount: '1', dueDate: '2026/13/40' },
        { partnerCode: 'C001', amount: '1', originalDate: '2026-04-01' },
        { partnerCode: 'C001', amount: '1', originalDate: '2026-03-01', dueDate: '2026-02-01' },
        { partnerCode: 'NOPE', amount: '1' },
        { partnerCode: '同名', amount: '1' },
        { partnerCode: '$ctx.companyId', amount: '1' },
        { partnerCode: 'B商事', amount: '１，０００', dueDate: '2026/5/31' },
      ],
      'dry-run',
    );
    expect(codesOf(result)).toEqual([
      'zero_amount',
      'zero_amount',
      'negative_amount',
      'not_whole_yen',
      'invalid_value',
      'invalid_value',
      'invalid_value',
      'invalid_value',
      'ref_not_found',
      'ref_ambiguous',
      'invalid_value',
      'ok',
    ]);
    expect(result.rows[4]?.messages?.[0]).toMatchObject({ field: 'amount', column: 'amount' });
    expect(result.totals).toEqual({ amount: '1000' });
    expect(result.committed).toBe(false);
    expect((await openingInvoices()).total).toBe(0);
  });

  it('AC-6: accounting alone and sales alone get 403; accounting + sales and admin pass', async () => {
    const row = [{ partnerCode: 'C001', amount: '1000' }];
    for (const roles of [['accounting'], ['sales'], ['viewer']])
      expect(await caught(importAr(row, 'dry-run', asRole(roles)))).toBeInstanceOf(PermissionDenied);
    const denied = (await caught(importAr(row, 'dry-run', asRole(['accounting'])))) as PermissionDenied;
    expect(String(denied.details?.op)).toContain('sales_invoice:create');
    expect((await importAr(row, 'dry-run', asRole(['accounting', 'sales']))).summary.errors).toBe(0);
    expect((await importAr(row, 'dry-run')).summary.errors).toBe(0);
  });

  it('D-16: missing sales posting accounts refuse the whole request', async () => {
    await run({}, (ctx) =>
      setSetting(ctx, SALES_ACCOUNTS_KEY, salesAccountsSchema, {
        receivable: '9999',
        revenue: '4000',
        taxPayable: '2200',
      }),
    );
    expect(await caught(importAr([{ partnerCode: 'C001', amount: '1' }], 'dry-run'))).toMatchObject({
      code: 'INVALID_STATE',
    });
    await run({}, (ctx) =>
      setSetting(ctx, SALES_ACCOUNTS_KEY, salesAccountsSchema, {
        receivable: '1300',
        revenue: '4000',
        taxPayable: '2200',
      }),
    );
  });

  it('AC-15 Q-5: more than 200 rows are a VALIDATION of the whole request', async () => {
    const rows = Array.from({ length: 201 }, () => ({ partnerCode: 'C001', amount: '1' }));
    expect(await caught(importAr(rows, 'dry-run'))).toMatchObject({ code: 'VALIDATION' });
  });

  it('AC-26: one bad row keeps the execute from writing anything', async () => {
    const result = await importAr([
      { partnerCode: 'C001', amount: '1000' },
      { partnerCode: 'NOPE', amount: '1000' },
    ]);
    expect(result).toMatchObject({ committed: false, documents: [] });
    expect(result.rows[0]?.status).toBe('ok');
    expect((await openingInvoices()).total).toBe(0);
  });

  it('AC-21: the generic create cannot set openingBalance', async () => {
    const err = await caught(
      run({}, (ctx) =>
        runAction(ctx, 'sales_invoice.create', { partnerId: partner.C001, date: '2026-04-05', openingBalance: true }),
      ),
    );
    expect(err).toBeInstanceOf(PermissionDenied);
    expect(String((err as PermissionDenied).details?.op)).toContain('server-owned:openingBalance');
  });
});

describe('opening receivables: invoices, posting, aging', () => {
  it('AC-16 AC-17 AC-27 D-18: one opening invoice per row, posted receivable / clearing on the opening date', async () => {
    const result = await importAr([
      { partnerCode: 'C001', amount: '100000', dueDate: '2026-04-30', reference: 'OLD-1', originalDate: '2026-03-10' },
      { partnerCode: 'C001', amount: '50000', originalDate: '2026-01-15', memo: '分割' },
      { partnerCode: 'B商事', amount: '30000' },
    ]);
    expect(result.committed).toBe(true);
    expect(result.summary).toEqual({ rows: 3, accepted: 3, clearing: 0, skipped: 0, errors: 0 });
    expect(result.totals).toEqual({ amount: '180000' });
    expect(result.clearingBalance).toEqual({ before: '0', after: '-180000' });
    expect(result.documents.map((d) => d.entity)).toEqual(['sales_invoice', 'sales_invoice', 'sales_invoice']);
    const invoices = (await openingInvoices()).items;
    expect(invoices.map((i) => [i.date, i.dueDate, i.total.toString(), i.status, i.taxTotal.toString()])).toEqual([
      ['2026-03-31', '2026-04-30', '100000', 'open', '0'],
      // D-18: the empty due date follows the terms (month-end close, next month-end) from the original date
      ['2026-03-31', '2026-02-28', '50000', 'open', '0'],
      ['2026-03-31', '2026-04-30', '30000', 'open', '0'],
    ]);
    expect(invoices[0]?.number).toMatch(/^INV-2026-/);
    expect(invoices[0]?.note).toBe('期首残高 元請求書 OLD-1（2026-03-10）');
    expect(invoices[1]?.note).toBe('期首残高（2026-01-15） 分割');
    expect(invoices.every((i) => i.issuedSnapshot === null && i.openingBalance)).toBe(true);
    const lines = await run({}, (ctx) =>
      repo(ctx, SalesInvoiceLine).list({ where: { invoiceId: invoices[0]?.id as string } }),
    );
    expect(lines.items.map((l) => [l.description, l.taxCategory, l.productId, l.amount.toString()])).toEqual([
      ['期首残高', 'out_of_scope', null, '100000'],
    ]);
    const journal = await run({}, async (ctx) => {
      const entry = await repo(ctx, JournalEntry).get(invoices[0]?.journalEntryId as string);
      const jl = await repo(ctx, JournalLine).list({
        where: { entryId: entry.id },
        orderBy: [{ field: 'seq', dir: 'asc' }],
      });
      return { entry, lines: jl.items };
    });
    expect(journal.entry.date).toBe('2026-03-31');
    expect(
      journal.lines.map((l) => [l.accountId, l.debit.toString(), l.credit.toString(), l.partnerId, l.taxCategory]),
    ).toEqual([
      [acc['1300'], '100000', '0', partner.C001, null],
      [acc['3900'], '0', '100000', null, 'out_of_scope'],
    ]);
  });

  it('AC-20: an opening invoice is not rendered as a qualified invoice', async () => {
    const id = (await openingInvoices()).items[0]?.id as string;
    const err = await caught(run({}, (ctx) => runAction(ctx, 'sales.render_invoice_html', { id })));
    expect(err).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'opening_balance' } });
  });

  it('AC-20 (print-templates AC-3): /meta declares the invoice print only for openingBalance = false, so an opening invoice gets no button', async () => {
    const print = await run(
      asRole(['sales']),
      async (ctx) => appMeta(ctx).actions.find((a) => a.name === 'sales.render_invoice_html')?.print,
    );
    expect(print?.when).toEqual({ openingBalance: false });
    // the record values the web compares `when` with (lib/print.ts printActionsFor): the opening invoice never matches
    const opening = (await openingInvoices()).items[0];
    expect(opening?.openingBalance).toBe(true);
    const values = new Map(Object.entries(opening ?? {}));
    expect(Object.entries(print?.when ?? {}).every(([field, value]) => values.get(field) === value)).toBe(false);
  });

  it('AC-20 (print-templates AC-15): the statement of the closing period holding the opening date lists the normal invoice, not the opening invoice', async () => {
    await run({}, (ctx) =>
      setSetting(ctx, SALES_ACCOUNTS_KEY, salesAccountsSchema, {
        receivable: '1300',
        revenue: '4000',
        taxPayable: '2200',
      }),
    );
    // closing day 20: the period (2026-03-20, 2026-04-20] holds both the opening date 2026-03-31 and April sales
    const partnerId = (
      await run({}, (ctx) =>
        repo(ctx, Partner).create({ code: 'C020', name: '二十日締め', isCustomer: true, closingDay: 20 }),
      )
    ).id;
    expect(closingDateOf('2026-03-31', 20)).toBe('2026-04-20');
    expect((await importAr([{ partnerCode: 'C020', amount: '70000', reference: 'OLD-20' }])).committed).toBe(true);
    const opening = (await openingInvoices(partnerId)).items[0];
    expect(opening).toMatchObject({ date: '2026-03-31', docstatus: 1, openingBalance: true });
    const normal = await run({}, async (ctx) => {
      const created = (await runAction(ctx, 'sales_invoice.create', {
        partnerId,
        date: '2026-04-05',
        lines: { sales_invoice_line: [{ description: '通常の売上', unitPrice: '1000', taxCategory: 'standard' }] },
      })) as { id: string };
      await runAction(ctx, 'sales_invoice.submit', { id: created.id });
      return repo(ctx, SalesInvoice).get(created.id);
    });
    expect(normal).toMatchObject({ docstatus: 1, openingBalance: false });
    const html = await run(
      asRole(['sales']),
      async (ctx) =>
        (
          (await runAction(ctx, 'sales.render_statement_html', { partnerId, closingDate: '2026-04-20' })) as {
            html: string;
          }
        ).html,
    );
    expect(html).toContain(`>${String(normal.number)}<`);
    expect(html).not.toContain(`>${String(opening?.number)}<`);
    expect(html).toContain(
      `当期ご請求額合計（税込）</span> <strong style="margin-left:16px;">${formatMoney(normal.total.toString())}円`,
    );
  });

  it('AC-22: opening invoices take payments and appear in AR aging by due date', async () => {
    const id = (await openingInvoices(partner.C002)).items[0]?.id as string;
    await run({}, (ctx) =>
      runAction(ctx, 'sales.record_payment', { invoiceId: id, amount: '10000', date: '2026-04-05' }),
    );
    const aging = (await run({}, (ctx) => runAction(ctx, 'sales.ar_aging', { asOf: '2026-04-01' }))) as {
      rows: Record<string, string>[];
    };
    const byName = Object.fromEntries(aging.rows.map((r) => [r.partnerName, r]));
    expect(byName['得意先A']).toMatchObject({ total: '150000', notDue: '100000', days31to60: '50000' });
    expect(byName['B商事']).toMatchObject({ total: '30000', notDue: '30000' });
    const later = (await run({}, (ctx) => runAction(ctx, 'sales.ar_aging', { asOf: '2026-04-10' }))) as {
      rows: Record<string, string>[];
    };
    expect(later.rows.find((r) => r.partnerName === 'B商事')).toMatchObject({ total: '20000' });
  });

  it('AC-18: partners with a live opening invoice are `exists`; a missing partner can be added later', async () => {
    const result = await importAr(
      [
        { partnerCode: 'C001', amount: '1' },
        { partnerCode: 'C003', amount: '7000' },
        { partnerCode: 'C003', amount: '3000' },
      ],
      'dry-run',
    );
    expect(codesOf(result)).toEqual(['exists', 'ok', 'ok']);
    expect(result.rows[0]?.messages?.[0]?.message).toMatch(/INV-2026-/);
    const added = await importAr([
      { partnerCode: 'C003', amount: '7000' },
      { partnerCode: 'C003', amount: '3000' },
    ]);
    expect(added.committed).toBe(true);
    expect((await openingInvoices(partner.C003)).total).toBe(2);
  });

  it('AC-19 D-8: a cancel on the opening date allows a re-import; an in-year cancel blocks it (cancelled_in_year)', async () => {
    const c3 = (await openingInvoices(partner.C003)).items;
    for (const inv of c3) await run({}, (ctx) => runAction(ctx, 'sales_invoice.cancel', { id: inv.id }));
    const cancelled = await run({}, (ctx) => repo(ctx, SalesInvoice).get(c3[0]?.id as string));
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelledDate: '2026-03-31' });
    const reversal = await run({}, (ctx) =>
      repo(ctx, JournalEntry).list({ where: { reversalOf: cancelled.journalEntryId as string } }),
    );
    expect(reversal.items[0]?.date).toBe('2026-03-31');
    const again = await importAr([{ partnerCode: 'C003', amount: '9000' }]);
    expect(again.committed).toBe(true);
    const fresh = (await openingInvoices(partner.C003)).items.find((i) => i.docstatus === 1);
    await run({}, (ctx) => runAction(ctx, 'sales_invoice.cancel', { id: fresh?.id, correctionDate: '2026-04-15' }));
    // the in-year cancel is reversed on the correction date by the ordinary rule
    const inYear = await run({}, async (ctx) => {
      const inv = await repo(ctx, SalesInvoice).get(fresh?.id as string);
      return repo(ctx, JournalEntry).list({ where: { reversalOf: inv.journalEntryId as string } });
    });
    expect(inYear.items.map((e) => [e.date, e.docstatus])).toEqual([['2026-04-15', 1]]);
    const blocked = await importAr([{ partnerCode: 'C003', amount: '9000' }], 'dry-run');
    expect(codesOf(blocked)).toEqual(['cancelled_in_year']);
  });

  it('AC-19: a draft amended from a cancelled opening invoice cannot be submitted (opening_amend)', async () => {
    const cancelled = (await openingInvoices(partner.C003)).items.find((i) => i.docstatus === 2) as { id: string };
    const amended = (await run({}, (ctx) => runAction(ctx, 'sales_invoice.amend', { id: cancelled.id }))) as {
      id: string;
      openingBalance: boolean;
    };
    expect(amended.openingBalance).toBe(false);
    const err = await caught(run({}, (ctx) => runAction(ctx, 'sales_invoice.submit', { id: amended.id })));
    expect(err).toMatchObject({ code: 'VALIDATION' });
    expect(JSON.stringify((err as { details?: unknown }).details)).toContain('opening_amend');
  });

  it('AC-19: with the first period closed, a cancel without a correction date is refused', async () => {
    const period = (
      await run({}, (ctx) => repo(ctx, FiscalPeriod).list({ where: { fiscalYearId: fyId, startDate: '2026-04-01' } }))
    ).items[0] as { id: string };
    await run({}, (ctx) => repo(ctx, FiscalPeriod).update(period.id, { isClosed: true }));
    const b = (await openingInvoices(partner.C001)).items[0] as { id: string };
    const err = await caught(run({}, (ctx) => runAction(ctx, 'sales_invoice.cancel', { id: b.id })));
    expect(err).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'first_period_closed' } });
    await run({}, (ctx) => repo(ctx, FiscalPeriod).update(period.id, { isClosed: false }));
  });

  it('AC-17: the submit check refuses malformed opening invoices (2 lines, taxable, product, wrong date)', async () => {
    // A test-only capability stands in for the module's private one to build malformed drafts.
    const forge = defineWriteCapability({
      name: 'test.opening',
      entity: 'sales_invoice',
      fields: ['openingBalance'],
      operations: ['create'],
    });
    const draft = (date: string, lines: Record<string, unknown>[]) =>
      run({}, async (ctx) => {
        const inv = await withWriteCapability(ctx, forge, (w) =>
          repo(w, SalesInvoice).create({ partnerId: partner.C002 as string, date, openingBalance: true }),
        );
        for (const [i, l] of lines.entries())
          await repo(ctx, SalesInvoiceLine).create({
            invoiceId: inv.id,
            seq: i + 1,
            description: 'x',
            quantity: '1',
            ...l,
          });
        return inv.id;
      });
    const productId = (
      await run({}, (ctx) =>
        repo(ctx, Product).create({ code: 'OB-P', name: '期首の品目', taxCategory: 'out_of_scope' }),
      )
    ).id;
    // each draft breaks exactly one rule, so each rule is pinned by its own issue path
    const bad: [string, string][] = [
      [
        await draft('2026-03-31', [
          { unitPrice: '1', taxCategory: 'out_of_scope' },
          { unitPrice: '1', taxCategory: 'out_of_scope' },
        ]),
        'lines',
      ],
      [await draft('2026-03-31', [{ unitPrice: '1', taxCategory: 'standard' }]), 'lines.taxCategory'],
      [await draft('2026-03-31', [{ unitPrice: '1', taxCategory: 'out_of_scope', productId }]), 'lines.productId'],
      [await draft('2026-04-05', [{ unitPrice: '1', taxCategory: 'out_of_scope' }]), 'date'],
    ];
    for (const [id, path] of bad) {
      const err = await caught(run({}, (ctx) => submitDocument(ctx, SalesInvoice, id)));
      expect(err).toMatchObject({ code: 'VALIDATION' });
      expect((err as Error).message).toContain('is not a valid opening invoice');
      const issues = (err as { details?: { issues?: { path: string }[] } }).details?.issues ?? [];
      expect(issues.map((i) => i.path)).toEqual([path]);
    }
  });
});

describe('opening receivables: isolation and concurrency', () => {
  it('AC-7: a partner code of another company is ref_not_found', async () => {
    const otherCompanyId = newId();
    await db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: db.tenantId, code: 'ARX', name: '別会社' });
    await run({ companyId: otherCompanyId }, (ctx) =>
      repo(ctx, Partner).create({ code: 'X900', name: '他社の得意先', isCustomer: true }),
    );
    const result = await importAr([{ partnerCode: 'X900', amount: '1' }], 'dry-run');
    expect(codesOf(result)).toEqual(['ref_not_found']);
  });

  it('D-14 AC-18: two concurrent imports for the same partner create exactly one opening invoice', async () => {
    const id = (await run({}, (ctx) => repo(ctx, Partner).create({ code: 'C010', name: '同時', isCustomer: true }))).id;
    const settled = await Promise.allSettled([
      importAr([{ partnerCode: 'C010', amount: '500' }]),
      importAr([{ partnerCode: 'C010', amount: '500' }]),
    ]);
    const values = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    expect(values).toHaveLength(2);
    expect(values.filter((v) => v.committed)).toHaveLength(1);
    expect(values.find((v) => !v.committed)?.rows[0]?.messages?.[0]?.code).toBe('exists');
    expect((await openingInvoices(id)).total).toBe(1);
  });
});
