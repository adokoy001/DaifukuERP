// Postgres tests for docs/specs/opening-balances.md — the opening journal (AC-2..AC-5, AC-7, AC-9..AC-14, AC-25..AC-29,
// D-14, D-15, D-19). Test DB: TEST_DATABASE_URL*. Each describe works on its own synthetic fiscal-year layout.
import {
  bootstrapTenant,
  companies,
  newId,
  NotFound,
  PermissionDenied,
  registerCrudActions,
  repo,
  runAction,
  setSetting,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Partner } from '@daifuku/mod-partner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Account,
  FiscalPeriod,
  FiscalYear,
  JournalEntry,
  JournalLine,
  OPENING_BALANCES_KEY,
  openingBalancesSchema,
  openingBalanceStatusOutput,
  openingImportResult,
  type OpeningImportResult,
} from '../src/index.ts';

const NOW = new Date('2026-04-10T03:00:00Z');
let db: TestDb;
let fyId: string;
let partnerId: string;
const acc: Record<string, string> = {};

const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) =>
  db.run({ now: () => NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

type Row = { accountCode?: string | null; partnerCode?: string | null; debit?: string | null; credit?: string | null };

const importJournal = (rows: Row[], mode: 'dry-run' | 'execute' = 'execute', params: Partial<ContextParams> = {}) =>
  run(params, async (ctx) =>
    openingImportResult.parse(
      await runAction(ctx, 'accounting.import_opening_balances', { fiscalYearId: fyId, mode, rows }),
    ),
  );
const reverse = (params: Partial<ContextParams> = {}) =>
  run(params, (ctx) => runAction(ctx, 'accounting.reverse_opening_balances', { fiscalYearId: fyId }));
const status = (params: Partial<ContextParams> = {}) =>
  run(params, async (ctx) =>
    openingBalanceStatusOutput.parse(await runAction(ctx, 'accounting.opening_balance_status', {})),
  );

/** Cash 1,000,000 + AR total 300,000 (no partner -> clearing) = capital 1,100,000 + AP total 200,000 (clearing). */
const BALANCED: Row[] = [
  { accountCode: '1000', debit: '1,000,000' },
  { accountCode: '1300', debit: '300000' },
  { accountCode: '2100', credit: '200000' },
  { accountCode: '3000', credit: '1100000' },
];

async function entriesOfYear(): Promise<number> {
  return run({}, (ctx) => repo(ctx, JournalEntry).count({ sourceEntity: 'fiscal_year', sourceId: fyId }));
}

async function createAccount(code: string, name: string, type: string, extra: Record<string, unknown> = {}) {
  acc[code] = (await run({}, (ctx) => repo(ctx, Account).create({ code, name, type: type as never, ...extra }))).id;
}

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  const opened = (await run({}, (ctx) =>
    runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-04-01' }),
  )) as { fiscalYear: { id: string } };
  fyId = opened.fiscalYear.id;
  await createAccount('1000', '現金', 'asset');
  await createAccount('1300', '売掛金', 'asset', { partnerRequired: true });
  await createAccount('2100', '買掛金', 'liability', { partnerRequired: true });
  await createAccount('2400', '前受金', 'liability', { partnerRequired: true });
  await createAccount('3000', '元入金', 'equity');
  await createAccount('3900', '期首残高仮勘定', 'equity');
  await createAccount('4000', '売上高', 'revenue');
  await createAccount('6100', '給料手当', 'expense');
  partnerId = (await run({}, (ctx) => repo(ctx, Partner).create({ code: 'C001', name: '得意先A', isCustomer: true })))
    .id;
});
afterAll(async () => {
  await db?.close();
});

describe('opening journal: classification, dry-run and execute', () => {
  it('AC-9 AC-10 AC-11: rows are classified in the spec order; partner-less partner-required rows go to clearing', async () => {
    const result = await importJournal(
      [
        ...BALANCED,
        { accountCode: '1000', debit: '', credit: '0' },
        { accountCode: '1000', debit: 'abc' },
        { accountCode: '1000', debit: '-5' },
        { accountCode: '1000', debit: '5', credit: '5' },
        { accountCode: '1000', debit: '5.5' },
        { accountCode: '$ctx.companyId', debit: '5' },
        { accountCode: '9999', debit: '5' },
        { accountCode: '4000', credit: '5' },
        { accountCode: '3900', credit: '5' },
        { accountCode: '1000', partnerCode: 'NOPE', debit: '5' },
        { accountCode: '1000', partnerCode: '$ctx.userId', debit: '5' },
      ],
      'dry-run',
    );
    const codes = result.rows.map((r) => [r.status, r.messages?.[0]?.code ?? null]);
    expect(codes).toEqual([
      ['ok', null],
      ['clearing', null],
      ['clearing', null],
      ['ok', null],
      ['skipped', 'zero_amount'],
      ['error', 'invalid_value'],
      ['error', 'negative_amount'],
      ['error', 'both_sides'],
      ['error', 'not_whole_yen'],
      ['error', 'invalid_value'],
      ['error', 'ref_not_found'],
      ['error', 'pl_account'],
      ['error', 'clearing_account'],
      ['error', 'ref_not_found'],
      ['error', 'invalid_value'],
    ]);
    expect(result.rows[5]?.messages?.[0]).toMatchObject({ field: 'debit', column: 'debit' });
    expect(result.summary).toEqual({ rows: 15, accepted: 4, clearing: 2, skipped: 1, errors: 10 });
    expect(result.totals).toEqual({ debit: '1300000', credit: '1300000', difference: '0' });
    expect(result.clearingAccounts).toEqual([
      { code: '1300', name: '売掛金', debit: '300000', credit: '0' },
      { code: '2100', name: '買掛金', debit: '0', credit: '200000' },
    ]);
    expect(result.committed).toBe(false);
    expect(await entriesOfYear()).toBe(0);
  });

  it('AC-11: unbalanced or fewer than 2 accepted rows write nothing, even on execute', async () => {
    const unbalanced = await importJournal([...BALANCED.slice(0, 3), { accountCode: '3000', credit: '1099999' }]);
    expect(unbalanced).toMatchObject({ committed: false, documents: [] });
    expect(unbalanced.issues[0]).toMatchObject({ code: 'unbalanced' });
    expect(unbalanced.totals.difference).toBe('1');
    const single = await importJournal([{ accountCode: '1000', debit: '1' }]);
    expect(single.issues[0]?.code).toBe('no_lines');
    expect(await entriesOfYear()).toBe(0);
  });

  it('AC-25: a dry-run runs the posting and rolls back sequences, audit and outbox; execute moves all of them', async () => {
    const state = async () => {
      const [seq] = await db.owner.sql`select coalesce(sum(next_value), 0)::int as n from sequences
        where company_id = ${db.companyId}`;
      const [out] = await db.owner.sql`select count(*)::int as n from outbox where company_id = ${db.companyId}`;
      const [aud] = await db.owner.sql`select count(*)::int as n from audit_log where company_id = ${db.companyId}`;
      return { sequence: seq?.n, outbox: out?.n, audit: aud?.n, entries: await entriesOfYear() };
    };
    const before = await state();
    const dry = await importJournal(BALANCED, 'dry-run');
    expect(dry).toMatchObject({ committed: false, documents: [], issues: [] });
    expect(dry.clearingBalance).toEqual({ before: '0', after: '100000' });
    expect(await state()).toEqual(before);
    const executed = await importJournal(BALANCED);
    expect(executed.committed).toBe(true);
    const after = await state();
    expect(after.entries).toBe(1);
    expect(after.sequence).toBeGreaterThan(before.sequence ?? 0);
    expect(after.audit).toBeGreaterThan(before.audit ?? 0);
    expect(after.outbox).toBeGreaterThan(before.outbox ?? 0);
  });

  it('AC-12: one entry dated the day before the year, linked to the year, lines in row order with clearing memos', async () => {
    const entry = await run({}, async (ctx) => {
      const e = (await repo(ctx, JournalEntry).list({ where: { sourceEntity: 'fiscal_year', sourceId: fyId } }))
        .items[0];
      const lines = await repo(ctx, JournalLine).list({
        where: { entryId: e?.id },
        orderBy: [{ field: 'seq', dir: 'asc' }],
      });
      return { e, lines: lines.items };
    });
    expect(entry.e).toMatchObject({ date: '2026-03-31', description: '期首残高 FY2026', docstatus: 1 });
    expect(entry.e?.number).toMatch(/^JE-2026-/);
    expect(entry.lines.map((l) => [l.accountId, l.debit.toString(), l.credit.toString()])).toEqual([
      [acc['1000'], '1000000', '0'],
      [acc['3900'], '300000', '0'],
      [acc['3900'], '0', '200000'],
      [acc['3000'], '0', '1100000'],
    ]);
    expect(entry.lines[1]?.memo).toBe('期首残高 1300 売掛金（取引先別は期首請求書）');
    expect(entry.lines.every((l) => l.posted && l.entryDate === '2026-03-31')).toBe(true);
  });

  it('AC-13: a second import of the same year is a CONFLICT in dry-run and execute', async () => {
    for (const mode of ['dry-run', 'execute'] as const) {
      const err = await caught(importJournal(BALANCED, mode));
      expect(err).toMatchObject({ code: 'CONFLICT', details: { reason: 'opening_entry_exists' } });
    }
    expect(await entriesOfYear()).toBe(1);
  });

  it('AC-3 AC-14: generic entries on the opening date and accounting.reverse_entry of the opening journal are refused', async () => {
    const generic = await caught(
      run({}, async (ctx) => {
        const draft = (await runAction(ctx, 'journal_entry.create', {
          date: '2026-03-31',
          lines: {
            journal_line: [
              { accountId: acc['1000'], debit: '1' },
              { accountId: acc['3000'], credit: '1' },
            ],
          },
        })) as { id: string };
        return runAction(ctx, 'journal_entry.submit', { id: draft.id });
      }),
    );
    expect(generic).toMatchObject({ code: 'INVALID_STATE' });
    const live = await run({}, (ctx) =>
      repo(ctx, JournalEntry).list({ where: { sourceEntity: 'fiscal_year', sourceId: fyId } }),
    );
    const err = await caught(run({}, (ctx) => runAction(ctx, 'accounting.reverse_entry', { id: live.items[0]?.id })));
    expect(err).toMatchObject({ code: 'INVALID_STATE' });
  });

  it('AC-29 AC-28: status shows the opening entry, the clearing balance and the moved accounts', async () => {
    const s = await status();
    expect(s.years).toHaveLength(1);
    expect(s.selected).toMatchObject({ code: 'FY2026', openingDate: '2026-03-31', importable: true, reversedCount: 0 });
    expect(s.selected.entry).toMatchObject({ debit: '1300000', credit: '1300000' });
    expect(s.clearing).toMatchObject({ ok: true, code: '3900', balance: '100000', foreignPostings: 0 });
    expect(s.clearing.lines.map((l) => l.memo)).toEqual([
      '期首残高 1300 売掛金（取引先別は期首請求書）',
      '期首残高 2100 買掛金（取引先別は期首請求書）',
    ]);
  });

  it('AC-14: reverse_opening_balances reverses on the opening date; then a re-import is accepted', async () => {
    const reversed = (await reverse()) as { reversal: { id: string } };
    const rev = await run({}, (ctx) => repo(ctx, JournalEntry).get(reversed.reversal.id));
    expect(rev.date).toBe('2026-03-31');
    expect((await caught(reverse())) as { details?: { reason?: string } }).toMatchObject({
      details: { reason: 'no_opening_entry' },
    });
    expect((await status()).selected).toMatchObject({ entry: null, reversedCount: 1 });
    const again = await importJournal(BALANCED);
    expect(again.committed).toBe(true);
    expect((await status()).selected.reversedCount).toBe(1);
  });

  it('AC-10: a partner on a partner-required account posts there with the journal_only_open_item notice', async () => {
    await reverse();
    const result = await importJournal(
      [
        { accountCode: '1000', debit: '50000' },
        { accountCode: '2400', partnerCode: '得意先A', credit: '50000' },
      ],
      'dry-run',
    );
    expect(result.rows[1]).toMatchObject({ status: 'ok', messages: [{ code: 'journal_only_open_item' }] });
    expect(result.notices[0]?.code).toBe('journal_only_open_item');
    expect(result.clearingAccounts).toEqual([]);
    void partnerId;
  });
});

describe('opening journal: year conditions, permissions, isolation', () => {
  it('AC-5: accounting and admin pass; sales, purchasing, inventory and viewer get 403', async () => {
    expect((await importJournal(BALANCED, 'dry-run', asRole(['accounting']))).issues).toEqual([]);
    for (const roles of [['sales'], ['purchasing'], ['inventory'], ['viewer']]) {
      expect(await caught(importJournal(BALANCED, 'dry-run', asRole(roles)))).toBeInstanceOf(PermissionDenied);
      expect(await caught(status(asRole(roles)))).toBeInstanceOf(PermissionDenied);
      expect(await caught(reverse(asRole(roles)))).toBeInstanceOf(PermissionDenied);
    }
  });

  it('AC-7: store-limited contexts are refused; another company cannot see the year (404) and its codes are not found', async () => {
    const storeScoped = { ...asRole(['accounting']), accessScope: 'stores' as const, storeIds: [newId()] };
    expect(await caught(importJournal(BALANCED, 'dry-run', storeScoped))).toBeInstanceOf(PermissionDenied);
    const otherCompanyId = newId();
    await db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: db.tenantId, code: 'OB2', name: '別会社' });
    const other = { companyId: otherCompanyId, ...asRole(['accounting']) };
    expect(await caught(importJournal(BALANCED, 'dry-run', other))).toBeInstanceOf(NotFound);
    const otherYear = (await run(other, (ctx) =>
      runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-04-01' }),
    )) as { fiscalYear: { id: string } };
    await run(other, (ctx) => repo(ctx, Account).create({ code: '3900', name: '仮', type: 'equity' }));
    const result = await run(other, async (ctx) =>
      openingImportResult.parse(
        await runAction(ctx, 'accounting.import_opening_balances', {
          fiscalYearId: otherYear.fiscalYear.id,
          mode: 'dry-run',
          rows: BALANCED,
        }),
      ),
    );
    expect(result.rows.map((r) => r.messages?.[0]?.code)).toEqual(Array(4).fill('ref_not_found'));
    const tenant = await bootstrapTenant(db.owner, {
      tenantName: 'Other opening tenant',
      companyCode: 'OT',
      companyName: '別テナント',
      adminEmail: 'other-opening@example.com',
      adminName: 'Other',
      adminPassword: 'test-password',
    });
    const foreign = { tenantId: tenant.tenantId, companyId: tenant.companyId, ...asRole(['accounting']) };
    expect(await caught(importJournal(BALANCED, 'dry-run', foreign))).toBeInstanceOf(NotFound);
  });

  it('AC-28: a missing, inactive or unsuitable clearing account refuses the request; foreign postings are a notice', async () => {
    await setClearing('3999');
    expect(await caught(importJournal(BALANCED, 'dry-run'))).toMatchObject({
      details: { reason: 'clearing_account_missing', code: '3999' },
    });
    await setClearing('1300');
    expect(await caught(importJournal(BALANCED, 'dry-run'))).toMatchObject({
      details: { reason: 'clearing_account_invalid' },
    });
    await setClearing('4000');
    expect(await caught(importJournal(BALANCED, 'dry-run'))).toMatchObject({
      details: { reason: 'clearing_account_invalid' },
    });
    expect((await status()).clearing).toMatchObject({ ok: false, reason: 'clearing_account_invalid', code: '4000' });
    await run({}, (ctx) => repo(ctx, Account).update(acc['3900'] as string, { isActive: false }));
    await setClearing('3900');
    expect(await caught(importJournal(BALANCED, 'dry-run'))).toMatchObject({
      details: { reason: 'clearing_account_invalid' },
    });
    await run({}, (ctx) => repo(ctx, Account).update(acc['3900'] as string, { isActive: true }));
    // an ordinary in-year entry on the clearing account
    await run({}, async (ctx) => {
      const draft = (await runAction(ctx, 'journal_entry.create', {
        date: '2026-04-05',
        lines: {
          journal_line: [
            { accountId: acc['3900'], debit: '1' },
            { accountId: acc['1000'], credit: '1' },
          ],
        },
      })) as { id: string };
      await runAction(ctx, 'journal_entry.submit', { id: draft.id });
    });
    const result = await importJournal(BALANCED, 'dry-run');
    expect(result.notices.map((n) => n.code)).toContain('clearing_account_used');
    expect((await status()).clearing.foreignPostings).toBe(1);
  });

  it('AC-8: rows above the request limit are a VALIDATION; more than 500 accepted lines too', async () => {
    const many = Array.from({ length: 1001 }, () => ({ accountCode: '1000', debit: '1' }));
    expect(await caught(importJournal(many, 'dry-run'))).toMatchObject({ code: 'VALIDATION' });
    const lines = Array.from({ length: 501 }, () => ({ accountCode: '1000', debit: '1' }));
    expect(await caught(importJournal(lines, 'dry-run'))).toMatchObject({ code: 'VALIDATION' });
  });
});

describe('opening journal: fiscal-year rules', () => {
  it('AC-2: closing the first period or the year refuses the import; reopening allows it again', async () => {
    const first = await run({}, (ctx) =>
      repo(ctx, FiscalPeriod).list({ where: { fiscalYearId: fyId, startDate: '2026-04-01' } }),
    );
    const periodId = first.items[0]?.id as string;
    await run({}, (ctx) => repo(ctx, FiscalPeriod).update(periodId, { isClosed: true }));
    expect(await caught(importJournal(BALANCED, 'dry-run'))).toMatchObject({
      code: 'INVALID_STATE',
      details: { reason: 'first_period_closed' },
    });
    expect((await status()).selected).toMatchObject({ importable: false, reason: 'first_period_closed' });
    await run({}, (ctx) => repo(ctx, FiscalPeriod).update(periodId, { isClosed: false }));
    await run({}, (ctx) => repo(ctx, FiscalYear).update(fyId, { isClosed: true }));
    expect(await caught(importJournal(BALANCED, 'dry-run'))).toMatchObject({ details: { reason: 'year_closed' } });
    await run({}, (ctx) => repo(ctx, FiscalYear).update(fyId, { isClosed: false }));
    expect((await importJournal(BALANCED, 'dry-run')).issues).toEqual([]);
  });

  it('AC-4 D-19: an earlier year cannot be opened over a live opening journal; after the reversal it can', async () => {
    expect((await importJournal(BALANCED)).committed).toBe(true);
    const err = await caught(
      run({}, (ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2025-04-01' })),
    );
    expect(err).toMatchObject({ code: 'CONFLICT', details: { reason: 'opening_entries_exist' } });
    await reverse();
    const opened = (await run({}, (ctx) =>
      runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2025-04-01' }),
    )) as { fiscalYear: { id: string } };
    // AC-2 (b): the later year is no longer the first one
    expect(await caught(importJournal(BALANCED, 'dry-run'))).toMatchObject({ details: { reason: 'not_earliest' } });
    const s = await status();
    expect(s.years.map((y) => [y.code, y.importable, y.reason])).toEqual([
      ['FY2025', true, null],
      ['FY2026', false, 'not_earliest'],
    ]);
    expect(opened.fiscalYear.id).toBe(s.years[0]?.id);
  });
});

describe('opening journal: concurrency and submit failures', () => {
  it('D-14 AC-13: two concurrent imports post exactly one entry; the other gets 409', async () => {
    const { params, fiscalYearId } = await freshCompany();
    const rows = [
      { accountCode: '1000', debit: '10' },
      { accountCode: '3000', credit: '10' },
    ];
    const go = () =>
      run(params, (ctx) =>
        runAction(ctx, 'accounting.import_opening_balances', { fiscalYearId, mode: 'execute', rows }),
      );
    const settled = await Promise.allSettled([go(), go()]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'CONFLICT' });
    expect(
      await run(params, (ctx) =>
        repo(ctx, JournalEntry).count({ sourceEntity: 'fiscal_year', sourceId: fiscalYearId }),
      ),
    ).toBe(1);
  });

  it('D-15: a posting the database rejects is an issue submit_failed with committed false', async () => {
    const { params, fiscalYearId } = await freshCompany();
    const huge = '1' + '0'.repeat(30);
    const result: OpeningImportResult = openingImportResult.parse(
      await run(params, (ctx) =>
        runAction(ctx, 'accounting.import_opening_balances', {
          fiscalYearId,
          mode: 'execute',
          rows: [
            { accountCode: '1000', debit: huge },
            { accountCode: '3000', credit: huge },
          ],
        }),
      ),
    );
    expect(result.committed).toBe(false);
    expect(result.issues[0]?.code).toBe('submit_failed');
    expect(
      await run(params, (ctx) =>
        repo(ctx, JournalEntry).count({ sourceEntity: 'fiscal_year', sourceId: fiscalYearId }),
      ),
    ).toBe(0);
  });
});

const setClearing = (code: string) =>
  run({}, (ctx) => setSetting(ctx, OPENING_BALANCES_KEY, openingBalancesSchema, { clearingAccount: code }));

/** A new empty company of the test tenant with a fiscal year starting 2027-01-01 and the accounts 1000/3000/3900. */
async function freshCompany(): Promise<{ params: Partial<ContextParams>; fiscalYearId: string }> {
  const companyId = newId();
  await db.owner.drizzle
    .insert(companies)
    .values({ id: companyId, tenantId: db.tenantId, code: `C${companyId.slice(-8)}`, name: '試験会社' });
  const params = { companyId };
  const year = (await run(params, (ctx) =>
    runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2027-01-01' }),
  )) as {
    fiscalYear: { id: string };
  };
  await run(params, async (ctx) => {
    for (const [code, type] of [
      ['1000', 'asset'],
      ['3000', 'equity'],
      ['3900', 'equity'],
    ] as const)
      await repo(ctx, Account).create({ code, name: code, type });
  });
  return { params, fiscalYearId: year.fiscalYear.id };
}
