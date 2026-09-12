// Postgres tests for docs/specs/accounting.md AC-1..AC-12. Test DB: daifuku_test_accounting (TEST_DATABASE_URL*).
// Partner is imported first so `journal_line.partnerId` resolves and the module's `depends` is satisfied.
import { Conflict, Decimal, DependencyError, NotFound, PermissionDenied, StateError, ValidationError, appMeta, auditTrail, newId, registerCrudActions, repo, runAction, systemParams, withContext, type Context, type ContextParams } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Partner } from '@daifuku/mod-partner';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Account, AccountingModule, FiscalPeriod, FiscalYear, JournalEntry, JournalLine, NO_CANCEL_HINT, PERIOD_HINT, REVERSED_EVENT, postFromSource, reverseEntry, reverseSourceEntry, tableResult } from '../src/index.ts';

type Row = Record<string, unknown>;
type LineJson = Row & { id: string; seq: number; accountId: string; debit: string; credit: string; posted: boolean; entryDate: string | null; partnerId: string | null; memo: string | null };
type EntryJson = Row & { id: string; number: string | null; docstatus: number; date: string; description: string | null; totalDebit: string; totalCredit: string; reversalOf: string | null; version: number };
type EntryWithKeyedLines = EntryJson & { lines: { journal_line: LineJson[] } };
type EntryWithFlatLines = EntryJson & { lines: LineJson[] };
type Table = { title: { ja: string; en: string }; columns: { key: string; kind: string }[]; rows: Row[]; totals?: Record<string, string>; meta?: Row };

/** 2026-09-10 12:00 JST: the seed and report defaults derive "today" from ctx.now(), so tests are date-stable. */
const FIXED_NOW = new Date('2026-09-10T03:00:00Z');
let db: TestDb;
let partnerId: string;
/** Accounts: cash (asset), ar (asset, partnerRequired), sales (revenue), expense. */
let acc: { cash: string; ar: string; sales: string; expense: string };

const run = <T>(params: Partial<ContextParams>, fn: (ctx: Context) => Promise<T>) => db.run({ now: () => FIXED_NOW, ...params }, fn);
const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const caught = (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e: unknown) => e);
const line = (accountId: string, debit: string, credit: string, extra: Row = {}): Row => ({ accountId, debit, credit, ...extra });

async function createEntry(ctx: Context, date: string, lines: Row[], head: Row = {}): Promise<EntryWithKeyedLines> {
  return (await runAction(ctx, 'journal_entry.create', { date, ...head, lines: { journal_line: lines } })) as EntryWithKeyedLines;
}
async function submit(ctx: Context, id: string): Promise<EntryJson> {
  return (await runAction(ctx, 'journal_entry.submit', { id })) as EntryJson;
}
/** Create + submit in two transactions (a failed submit must not roll the draft back). */
async function postEntry(date: string, lines: Row[], head: Row = {}, params: Partial<ContextParams> = {}): Promise<EntryWithKeyedLines> {
  const draft = await run(params, (ctx) => createEntry(ctx, date, lines, head));
  await run(params, (ctx) => submit(ctx, draft.id));
  return run(params, async (ctx) => (await runAction(ctx, 'journal_entry.get', { id: draft.id })) as EntryWithKeyedLines);
}
async function createAccount(code: string, name: string, type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense', extra: Row = {}): Promise<string> {
  return (await run({}, (ctx) => repo(ctx, Account).create({ code, name, type, ...extra }))).id;
}
/** Σdebit − Σcredit per account over posted lines, via the aggregate port. */
async function netByAccount(ctx: Context): Promise<Map<string, string>> {
  const rows = await repo(ctx, JournalLine).aggregate({ where: { posted: true }, groupBy: ['accountId'], metrics: { debit: { sum: 'debit' }, credit: { sum: 'credit' } } });
  return new Map(rows.map((r) => [String(r.accountId), (r.debit as Decimal).minus(r.credit as Decimal).toString()]));
}

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  partnerId = (await run({}, (ctx) => repo(ctx, Partner).create({ name: '得意先A', isCustomer: true }))).id;
  acc = {
    cash: await createAccount('1000', '現金', 'asset', { subtype: '現金預金' }),
    ar: await createAccount('1300', '売掛金', 'asset', { subtype: '売掛金', partnerRequired: true }),
    sales: await createAccount('4000', '売上高', 'revenue', { subtype: '売上', taxCategoryDefault: 'standard' }),
    expense: await createAccount('5000', '仕入高', 'expense', { subtype: '仕入' }),
  };
});
afterAll(async () => {
  await db.close();
});

describe('accounting module (docs/specs/accounting.md)', () => {
  it('AC-11 seed opens a Jan–Dec fiscal year for the current year only when none exists (idempotent, no CoA)', async () => {
    const seed = () => withContext(db.app, systemParams(db.tenantId, db.companyId, { now: () => FIXED_NOW }), async (ctx) => AccountingModule.seed?.(ctx));
    expect(await run({}, (ctx) => repo(ctx, FiscalYear).count())).toBe(0);
    await seed();
    await seed();
    const years = await run({}, (ctx) => repo(ctx, FiscalYear).list());
    expect(years.items.map((y) => [y.code, y.startDate, y.endDate, y.isClosed, y.version])).toEqual([['FY2026', '2026-01-01', '2026-12-31', false, 1]]);
    expect(await run({}, (ctx) => repo(ctx, FiscalPeriod).count())).toBe(12);
    expect(await run({}, (ctx) => repo(ctx, Account).count())).toBe(4); // only the accounts this test file created
  });

  it('AC-1 account: defaults, unique immutable code, enums, kana; accounting read/create/update, viewer read, delete admin only', async () => {
    const a = await run({}, (ctx) => repo(ctx, Account).get(acc.cash));
    expect(a).toMatchObject({ code: '1000', name: '現金', type: 'asset', subtype: '現金預金', isActive: true, partnerRequired: false, taxCategoryDefault: null, nameKana: null });
    const s = await run({}, (ctx) => repo(ctx, Account).get(acc.sales));
    expect(s.taxCategoryDefault).toBe('standard');
    await expect(run({}, (ctx) => repo(ctx, Account).create({ code: '1000', name: 'dup', type: 'asset' }))).rejects.toBeInstanceOf(Conflict);
    await expect(run({}, (ctx) => repo(ctx, Account).update(acc.cash, { code: '1001' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'code' }] } });
    await expect(run({}, (ctx) => repo(ctx, Account).create({ code: 'X', name: 'x', type: 'bogus' as never }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'type' }] } });
    await expect(run({}, (ctx) => repo(ctx, Account).create({ code: 'X', name: 'x', type: 'asset', taxCategoryDefault: 'vat' as never }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'taxCategoryDefault' }] } });
    await expect(run({}, (ctx) => repo(ctx, Account).create({ name: 'no code', type: 'asset' } as never))).rejects.toBeInstanceOf(ValidationError);
    const accounting = asRole(['accounting']);
    const created = await run(accounting, (ctx) => repo(ctx, Account).create({ code: '2100', name: '買掛金', nameKana: 'かいかけきん', type: 'liability', partnerRequired: true }));
    expect(created.nameKana).toBe('ｶｲｶｹｷﾝ');
    const updated = await run(accounting, (ctx) => repo(ctx, Account).update(created.id, { isActive: false }));
    expect(updated.version).toBe(2);
    await expect(run(accounting, (ctx) => repo(ctx, Account).delete(created.id))).rejects.toBeInstanceOf(PermissionDenied);
    expect(await run(accounting, async (ctx) => appMeta(ctx).entities.find((e) => e.name === 'account')?.ops)).toEqual(['read', 'create', 'update']);
    const viewer = asRole(['viewer']);
    expect((await run(viewer, (ctx) => repo(ctx, Account).get(created.id))).code).toBe('2100');
    await expect(run(viewer, (ctx) => repo(ctx, Account).create({ code: 'V', name: 'v', type: 'asset' }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run(viewer, (ctx) => repo(ctx, Account).update(created.id, { name: 'v' }))).rejects.toBeInstanceOf(PermissionDenied);
    const found = await run(viewer, (ctx) => runAction(ctx, 'account.list', { search: 'ｶｲｶｹ' }));
    expect((found as { total: number }).total).toBe(1);
    await run({}, (ctx) => repo(ctx, Account).delete(created.id));
    await expect(run({}, (ctx) => repo(ctx, Account).get(created.id))).rejects.toBeInstanceOf(NotFound);
  });

  it('AC-2 open_fiscal_year: 12 monthly periods from any start month; overlap → CONFLICT; non-1st / bad ranges → VALIDATION', async () => {
    const r = (await run({}, (ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2027-04-01' }))) as { fiscalYear: Row; periods: Row[] };
    expect(r.fiscalYear).toMatchObject({ code: 'FY2027', startDate: '2027-04-01', endDate: '2028-03-31', isClosed: false });
    expect(r.periods).toHaveLength(12);
    expect(r.periods.map((p) => p.code)).toEqual(['2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12', '2028-01', '2028-02', '2028-03']);
    expect(r.periods[10]).toMatchObject({ startDate: '2028-02-01', endDate: '2028-02-29', isClosed: false, fiscalYearId: r.fiscalYear.id });
    for (const startDate of ['2026-06-01', '2028-01-01', '2026-01-01']) {
      const err = await caught(run({}, (ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate })));
      expect(err, startDate).toBeInstanceOf(Conflict);
      expect((err as Conflict).details).toMatchObject({ overlaps: startDate === '2028-01-01' ? 'FY2027' : 'FY2026' });
    }
    await expect(run({}, (ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-04-15' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'startDate' }] } });
    await expect(run({}, (ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-13-01' }))).rejects.toMatchObject({ code: 'VALIDATION' });
    // the generic path is guarded by the same hooks
    await expect(run({}, (ctx) => repo(ctx, FiscalYear).create({ code: 'BAD', startDate: '2030-12-31', endDate: '2030-01-01' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'endDate' }] } });
    await expect(run({}, (ctx) => repo(ctx, FiscalYear).create({ code: 'OVL', startDate: '2026-12-01', endDate: '2027-11-30' }))).rejects.toBeInstanceOf(Conflict);
    const fy26 = (await run({}, (ctx) => repo(ctx, FiscalYear).list({ where: { code: 'FY2026' } }))).items[0];
    await expect(run({}, (ctx) => repo(ctx, FiscalYear).update(fy26?.id ?? '', { endDate: '2027-04-30' }))).rejects.toBeInstanceOf(ValidationError);
    const p = r.periods[0] as { id: string };
    await expect(run({}, (ctx) => repo(ctx, FiscalPeriod).update(p.id, { endDate: '2027-03-31' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'endDate' }] } });
    // an overlap-free year after FY2027 is fine; open_fiscal_year needs fiscal_year.create (accounting has it, sales does not)
    await expect(run(asRole(['sales']), (ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2028-04-01' }))).rejects.toBeInstanceOf(PermissionDenied);
    const r2 = (await run(asRole(['accounting']), (ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2028-04-01' }))) as { fiscalYear: Row };
    expect(r2.fiscalYear).toMatchObject({ code: 'FY2028', endDate: '2029-03-31' });
    expect(await run(asRole(['viewer']), (ctx) => repo(ctx, FiscalPeriod).count())).toBe(36);
  });

  it('AC-3 journal_entry with journal_line lines: seq from order, money defaults, JE-<year>-<n> numbering, get returns lines', async () => {
    const e = await run({}, (ctx) => createEntry(ctx, '2026-04-10', [line(acc.ar, '1100', '0', { partnerId, memo: '請求' }), { accountId: acc.sales, credit: '1100', taxCategory: 'standard', taxRate: '0.1' }], { description: '売上計上' }));
    expect(e).toMatchObject({ docstatus: 0, number: null, date: '2026-04-10', description: '売上計上', sourceEntity: null, sourceId: null, reversalOf: null, totalDebit: '0', totalCredit: '0' });
    expect(e.lines.journal_line.map((l) => [l.seq, l.accountId, l.debit, l.credit, l.posted, l.entryDate])).toEqual([
      [1, acc.ar, '1100', '0', false, null],
      [2, acc.sales, '0', '1100', false, null],
    ]);
    expect(e.lines.journal_line[1]).toMatchObject({ taxCategory: 'standard', taxRate: '0.1', partnerId: null, memo: null });
    const got = (await run({}, (ctx) => runAction(ctx, 'journal_entry.get', { id: e.id }))) as EntryWithKeyedLines;
    expect(got.lines.journal_line).toHaveLength(2);
    const submitted = await run({}, (ctx) => submit(ctx, e.id));
    expect(submitted.number).toMatch(/^JE-2026-\d{6}$/);
    expect(submitted.docstatus).toBe(1);
    await expect(run({}, (ctx) => createEntry(ctx, '2026-04-10', [], { sourceId: 'not-a-uuid' }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run({}, (ctx) => createEntry(ctx, '2026-04-10', [line(acc.cash, '-1', '0'), line(acc.sales, '0', '1')]))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'debit' }] } });
    await expect(run({}, (ctx) => createEntry(ctx, '2026-04-10', [{ accountId: newId(), debit: '1' }, line(acc.sales, '0', '1')]))).rejects.toBeInstanceOf(ValidationError);
  });

  it('AC-4 submit validates lines (≥2, XOR, exact balance, partner where required) and the period; sets totals; failure leaves the draft', async () => {
    const expectIssue = async (lines: Row[], path: string, message: RegExp) => {
      const d = await run({}, (ctx) => createEntry(ctx, '2026-04-11', lines));
      const err = await caught(run({}, (ctx) => submit(ctx, d.id)));
      expect(err).toBeInstanceOf(ValidationError);
      const issues = ((err as ValidationError).details as { issues: { path: string; message: string }[] }).issues;
      expect(issues.some((i) => i.path === path && message.test(i.message)), JSON.stringify(issues)).toBe(true);
      const still = await run({}, (ctx) => repo(ctx, JournalEntry).get(d.id));
      expect(still.docstatus).toBe(0);
      expect(still.number).toBeNull();
    };
    await expectIssue([line(acc.cash, '100', '0')], 'lines', /at least 2 lines/);
    await expectIssue([line(acc.cash, '100', '100'), line(acc.sales, '0', '0')], 'lines[0]', /not both/);
    await expectIssue([line(acc.cash, '100', '0'), line(acc.sales, '0', '0')], 'lines[1]', /greater than 0/);
    await expectIssue([line(acc.cash, '100', '0'), line(acc.sales, '0', '99.999999')], 'lines', /differ by 0\.000001/);
    await expectIssue([line(acc.ar, '100', '0'), line(acc.sales, '0', '100')], 'lines[0].partnerId', /requires a partner/);
    // date outside every fiscal period, and a draft whose period is missing: INVALID_STATE with the spec hint
    const noPeriod = await run({}, (ctx) => createEntry(ctx, '2031-01-01', [line(acc.cash, '1', '0'), line(acc.sales, '0', '1')]));
    const err = await caught(run({}, (ctx) => submit(ctx, noPeriod.id)));
    expect(err).toBeInstanceOf(StateError);
    expect(err).toMatchObject({ code: 'INVALID_STATE', hint: expect.stringContaining(PERIOD_HINT) });
    // success: totals computed exactly, lines stamped
    const ok = await postEntry('2026-04-11', [line(acc.cash, '0.1', '0'), line(acc.cash, '0.2', '0'), line(acc.sales, '0', '0.3')]);
    expect(ok).toMatchObject({ docstatus: 1, totalDebit: '0.3', totalCredit: '0.3' });
    expect(ok.lines.journal_line.map((l) => [l.posted, l.entryDate])).toEqual([
      [true, '2026-04-11'],
      [true, '2026-04-11'],
      [true, '2026-04-11'],
    ]);
    // sales may post too (needed by post_from_source in the caller's context); viewer may not
    const bySales = await postEntry('2026-04-11', [line(acc.cash, '5', '0'), line(acc.sales, '0', '5')], {}, asRole(['sales']));
    expect(bySales.docstatus).toBe(1);
    await expect(run(asRole(['viewer']), (ctx) => createEntry(ctx, '2026-04-11', [line(acc.cash, '5', '0'), line(acc.sales, '0', '5')]))).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-5 submitted entries are immutable: only description changes; lines frozen on every path; posted/entryDate are system-owned', async () => {
    const e = await postEntry('2026-04-12', [line(acc.cash, '700', '0', { memo: 'm' }), line(acc.sales, '0', '700')]);
    const lineId = e.lines.journal_line[0]?.id ?? '';
    const u = (await run({}, (ctx) => runAction(ctx, 'journal_entry.update', { id: e.id, patch: { description: '摘要のみ変更可' } }))) as EntryJson;
    expect(u).toMatchObject({ description: '摘要のみ変更可', version: e.version + 1 });
    await expect(run({}, (ctx) => runAction(ctx, 'journal_entry.update', { id: e.id, patch: { date: '2026-04-13' } }))).rejects.toMatchObject({ code: 'INVALID_STATE', details: { blocked: ['date'] } });
    await expect(run({}, (ctx) => runAction(ctx, 'journal_entry.update', { id: e.id, patch: { totalDebit: '1' } }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run({}, (ctx) => runAction(ctx, 'journal_entry.update', { id: e.id, patch: { lines: { journal_line: [] } } }))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => repo(ctx, JournalLine).update(lineId, { memo: 'x' }))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => repo(ctx, JournalLine).update(lineId, { debit: '700.000001' }))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => repo(ctx, JournalLine).update(lineId, { ext: { note: 1 } }))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => repo(ctx, JournalLine).update(lineId, { posted: true, entryDate: '2026-04-12', memo: 'x' }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run({}, (ctx) => repo(ctx, JournalLine).update(lineId, { posted: false }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run({}, (ctx) => repo(ctx, JournalLine).update(lineId, { entryDate: '2026-04-13' }))).rejects.toBeInstanceOf(PermissionDenied);
    // Even echoing a stamp requires the owning module's private capability; public writes never impersonate after_submit.
    await expect(run({}, (ctx) => repo(ctx, JournalLine).update(lineId, { posted: true, entryDate: '2026-04-12' }))).rejects.toBeInstanceOf(PermissionDenied);
    expect(await run({}, (ctx) => repo(ctx, JournalLine).get(lineId))).toMatchObject({ posted: true, entryDate: '2026-04-12', memo: 'm' });
    await expect(run({}, (ctx) => repo(ctx, JournalLine).create({ entryId: e.id, accountId: acc.cash, debit: '1' }))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => repo(ctx, JournalLine).delete(lineId))).rejects.toBeInstanceOf(StateError);
    await expect(run({}, (ctx) => repo(ctx, JournalEntry).delete(e.id))).rejects.toBeInstanceOf(StateError);
    expect(await run({}, (ctx) => repo(ctx, JournalLine).count({ entryId: e.id }))).toBe(2);
    // drafts: lines editable, but posted/entryDate cannot be forged, and a line cannot move under a submitted entry
    const d = await run({}, (ctx) => createEntry(ctx, '2026-04-12', [line(acc.cash, '1', '0'), line(acc.sales, '0', '1')]));
    const draftLine = d.lines.journal_line[0]?.id ?? '';
    expect((await run({}, (ctx) => repo(ctx, JournalLine).update(draftLine, { memo: 'editable' }))).memo).toBe('editable');
    await expect(run({}, (ctx) => repo(ctx, JournalLine).update(draftLine, { posted: true }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run({}, (ctx) => repo(ctx, JournalLine).update(draftLine, { entryDate: '2026-04-12' }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run({}, (ctx) => repo(ctx, JournalLine).create({ entryId: d.id, accountId: acc.cash, debit: '1', posted: true }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run({}, (ctx) => runAction(ctx, 'journal_entry.create', { date: '2026-04-12', lines: { journal_line: [line(acc.cash, '1', '0', { entryDate: '2026-04-12' })] } }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run({}, (ctx) => repo(ctx, JournalLine).update(draftLine, { entryId: e.id }))).rejects.toBeInstanceOf(ValidationError);
    expect(await run({}, (ctx) => repo(ctx, JournalLine).count({ posted: true, entryId: d.id }))).toBe(0);
  });

  it('AC-6 reverse_entry posts the mirror (reversalOf, 逆仕訳: <number>, other line fields kept) and emits journal_entry.reversed; cancel is refused', async () => {
    const e = await postEntry('2026-04-13', [line(acc.ar, '2200', '0', { partnerId, memo: 'A' }), line(acc.sales, '0', '2000', { taxCategory: 'standard', taxRate: '0.1' }), line(acc.expense, '0', '200', { memo: 'C' })], { description: '元仕訳' });
    const rev = (await run({}, (ctx) => runAction(ctx, 'accounting.reverse_entry', { id: e.id }))) as EntryWithFlatLines;
    expect(rev).toMatchObject({ docstatus: 1, reversalOf: e.id, date: '2026-04-13', description: `逆仕訳: ${e.number}`, totalDebit: '2200', totalCredit: '2200', sourceEntity: null });
    expect(rev.number).toMatch(/^JE-2026-\d{6}$/);
    expect(rev.number).not.toBe(e.number);
    expect(rev.lines.map((l) => [l.seq, l.accountId, l.debit, l.credit, l.partnerId, l.memo, l.posted, l.entryDate])).toEqual([
      [1, acc.ar, '0', '2200', partnerId, 'A', true, '2026-04-13'],
      [2, acc.sales, '2000', '0', null, null, true, '2026-04-13'],
      [3, acc.expense, '200', '0', null, 'C', true, '2026-04-13'],
    ]);
    expect(rev.lines[1]).toMatchObject({ taxCategory: 'standard', taxRate: '0.1' });
    const events = await db.owner.sql<{ payload: Row }[]>`select payload from outbox where topic = ${REVERSED_EVENT} and tenant_id = ${db.tenantId}`;
    expect(events.map((r) => r.payload)).toContainEqual({ id: e.id, number: e.number, reversalId: rev.id, reversalNumber: rev.number });
    // twice → CONFLICT; a draft → INVALID_STATE; explicit date is honoured (and must be in an open period)
    await expect(run({}, (ctx) => runAction(ctx, 'accounting.reverse_entry', { id: e.id }))).rejects.toBeInstanceOf(Conflict);
    const d = await run({}, (ctx) => createEntry(ctx, '2026-04-13', [line(acc.cash, '1', '0'), line(acc.sales, '0', '1')]));
    await expect(run({}, (ctx) => reverseEntry(ctx, { id: d.id }))).rejects.toBeInstanceOf(StateError);
    const e2 = await postEntry('2026-04-13', [line(acc.cash, '9', '0'), line(acc.sales, '0', '9')]);
    await expect(run({}, (ctx) => reverseEntry(ctx, { id: e2.id, date: '2031-01-01' }))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const rev2 = await run({}, (ctx) => reverseEntry(ctx, { id: e2.id, date: '2026-05-02' }));
    expect(rev2.date).toBe('2026-05-02');
    expect(rev2.lines[0]?.entryDate).toBe('2026-05-02');
    // cancel: never (hook), and an already-reversed entry is refused even earlier by the kernel's dependency check
    const e3 = await postEntry('2026-04-13', [line(acc.cash, '3', '0'), line(acc.sales, '0', '3')]);
    const cancelErr = await caught(run({}, (ctx) => runAction(ctx, 'journal_entry.cancel', { id: e3.id })));
    expect(cancelErr).toBeInstanceOf(StateError);
    expect(cancelErr).toMatchObject({ code: 'INVALID_STATE', hint: expect.stringContaining(NO_CANCEL_HINT) });
    expect((await run({}, (ctx) => repo(ctx, JournalEntry).get(e3.id))).docstatus).toBe(1);
    await expect(run({}, (ctx) => runAction(ctx, 'journal_entry.cancel', { id: e.id }))).rejects.toBeInstanceOf(DependencyError);
    await expect(run({}, (ctx) => runAction(ctx, 'journal_entry.amend', { id: e.id }))).rejects.toBeInstanceOf(StateError);
    // permission: submit on journal_entry is required
    await expect(run(asRole(['viewer']), (ctx) => runAction(ctx, 'accounting.reverse_entry', { id: e3.id }))).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-7 post_from_source: create+submit linked to the source in one transaction; a second post is CONFLICT until the entry is reversed', async () => {
    const sourceId = newId();
    const input = { sourceEntity: 'sales_invoice', sourceId, date: '2026-04-14', description: '請求書 INV-1', lines: [line(acc.ar, '1100', '0', { partnerId }), line(acc.sales, '0', '1100')] };
    const posted = (await run(asRole(['sales']), (ctx) => runAction(ctx, 'accounting.post_from_source', input))) as EntryWithFlatLines;
    expect(posted).toMatchObject({ docstatus: 1, sourceEntity: 'sales_invoice', sourceId, date: '2026-04-14', description: '請求書 INV-1', totalDebit: '1100', totalCredit: '1100' });
    expect(posted.number).toMatch(/^JE-2026-\d{6}$/);
    expect(posted.lines.map((l) => [l.seq, l.accountId, l.debit, l.credit, l.posted])).toEqual([
      [1, acc.ar, '1100', '0', true],
      [2, acc.sales, '0', '1100', true],
    ]);
    const dup = await caught(run({}, (ctx) => runAction(ctx, 'accounting.post_from_source', input)));
    expect(dup).toBeInstanceOf(Conflict);
    expect((dup as Conflict).details).toMatchObject({ sourceEntity: 'sales_invoice', sourceId, entryId: posted.id, number: posted.number });
    await expect(run({}, (ctx) => reverseEntry(ctx, { id: posted.id }))).rejects.toBeInstanceOf(StateError);
    await run({}, (ctx) => reverseSourceEntry(ctx, { id: posted.id, sourceEntity: input.sourceEntity, sourceId }));
    const again = await run({}, (ctx) => postFromSource(ctx, { ...input, lines: [{ accountId: acc.ar, debit: Decimal.from('1200'), partnerId }, { accountId: acc.sales, credit: '1200' }] }));
    expect(again).toMatchObject({ docstatus: 1, sourceId });
    expect(again.totalDebit).toBeInstanceOf(Decimal); // in-process callers get domain rows (Decimal), not JSON
    expect(again.totalDebit.toString()).toBe('1200');
    expect(again.lines[0]?.debit.toString()).toBe('1200');
    expect(await run({}, (ctx) => repo(ctx, JournalEntry).count({ sourceEntity: 'sales_invoice', sourceId, docstatus: 1 }))).toBe(2);
    // atomic: an invalid line set leaves no trace of the source
    const bad = newId();
    const err = await caught(run({}, (ctx) => runAction(ctx, 'accounting.post_from_source', { ...input, sourceId: bad, lines: [line(acc.cash, '10', '0'), line(acc.sales, '0', '9')] })));
    expect(err).toBeInstanceOf(ValidationError);
    expect(await run({}, (ctx) => repo(ctx, JournalEntry).count({ sourceId: bad }))).toBe(0);
    const closed = await caught(run({}, (ctx) => runAction(ctx, 'accounting.post_from_source', { ...input, sourceId: bad, date: '2031-01-01' })));
    expect(closed).toMatchObject({ code: 'INVALID_STATE' });
    expect(await run({}, (ctx) => repo(ctx, JournalEntry).count({ sourceId: bad }))).toBe(0);
    await expect(run({}, (ctx) => runAction(ctx, 'accounting.post_from_source', { ...input, sourceId: bad, lines: [line(acc.cash, '1', '0')] }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'lines' }] } });
    await expect(run(asRole(['viewer']), (ctx) => runAction(ctx, 'accounting.post_from_source', { ...input, sourceId: bad }))).rejects.toBeInstanceOf(PermissionDenied);
  });

  describe('reports (AC-8, AC-9)', () => {
    let tb: { a: string; b: string; c: string };
    let draftId: string;
    beforeAll(async () => {
      tb = { a: await createAccount('TB-A', '報告A', 'asset'), b: await createAccount('TB-B', '報告B', 'liability'), c: await createAccount('TB-C', '報告C', 'revenue') };
      await postEntry('2026-03-15', [line(tb.a, '300', '0'), line(tb.b, '0', '300')]);
      await postEntry('2026-04-05', [line(tb.b, '100', '0'), line(tb.c, '0', '100')]);
      await postEntry('2026-04-20', [line(tb.a, '50', '0'), line(tb.c, '0', '50')], { description: '4月分' });
      await postEntry('2026-05-01', [line(tb.a, '1', '0'), line(tb.c, '0', '1')]);
      draftId = (await run({}, (ctx) => createEntry(ctx, '2026-04-21', [line(tb.a, '999', '0'), line(tb.c, '0', '999')]))).id;
    });

    it('AC-8 trial_balance: one row per account, opening (before from) / period / closing, totals; posted lines only; TableResult', async () => {
      const t = (await run(asRole(['viewer']), (ctx) => runAction(ctx, 'accounting.trial_balance', { from: '2026-04-01', to: '2026-04-30' }))) as Table;
      expect(tableResult.safeParse(t).success).toBe(true);
      expect(t.columns.map((c) => c.key)).toEqual(['code', 'name', 'type', 'openingDebit', 'openingCredit', 'periodDebit', 'periodCredit', 'closingBalance', 'accountId']);
      expect(t.title).toEqual({ ja: '試算表 2026-04-01〜2026-04-30', en: 'Trial balance 2026-04-01..2026-04-30' });
      expect(t.meta).toMatchObject({ from: '2026-04-01', to: '2026-04-30' });
      const pick = (code: string) => t.rows.find((r) => r.code === code);
      expect(pick('TB-A')).toEqual({ accountId: tb.a, code: 'TB-A', name: '報告A', type: 'asset', openingDebit: '300', openingCredit: '0', periodDebit: '50', periodCredit: '0', closingBalance: '350' });
      expect(pick('TB-B')).toEqual({ accountId: tb.b, code: 'TB-B', name: '報告B', type: 'liability', openingDebit: '0', openingCredit: '300', periodDebit: '100', periodCredit: '0', closingBalance: '-200' });
      expect(pick('TB-C')).toEqual({ accountId: tb.c, code: 'TB-C', name: '報告C', type: 'revenue', openingDebit: '0', openingCredit: '0', periodDebit: '0', periodCredit: '150', closingBalance: '-150' });
      expect(t.rows.map((r) => r.code)).toEqual([...t.rows.map((r) => r.code)].sort());
      expect(t.rows).toHaveLength(await run({}, (ctx) => repo(ctx, Account).count()));
      // every posted entry balances, so the whole book nets to zero and period sides agree
      expect(t.totals?.closingBalance).toBe('0');
      expect(t.totals?.periodDebit).toBe(t.totals?.periodCredit);
      expect(t.totals?.openingDebit).toBe(t.totals?.openingCredit);
      // the 999 draft is invisible; submitting it moves the numbers
      await run({}, (ctx) => submit(ctx, draftId));
      const t2 = (await run({}, (ctx) => runAction(ctx, 'accounting.trial_balance', { from: '2026-04-01', to: '2026-04-30' }))) as Table;
      expect(t2.rows.find((r) => r.code === 'TB-A')).toMatchObject({ periodDebit: '1049', closingBalance: '1349' });
      // defaults: fiscal year start .. today (ctx.now = 2026-09-10)
      const dflt = (await run({}, (ctx) => runAction(ctx, 'accounting.trial_balance', {}))) as Table;
      expect(dflt.meta).toMatchObject({ from: '2026-01-01', to: '2026-09-10' });
      expect(dflt.rows.find((r) => r.code === 'TB-A')).toMatchObject({ openingDebit: '0', periodDebit: '1350', closingBalance: '1350' });
      await expect(run(asRole(['nobody']), (ctx) => runAction(ctx, 'accounting.trial_balance', {}))).rejects.toBeInstanceOf(PermissionDenied);
    });

    it('AC-9 general_ledger: opening row then posted lines in date order with a running balance', async () => {
      const g = (await run(asRole(['viewer']), (ctx) => runAction(ctx, 'accounting.general_ledger', { accountId: tb.a, from: '2026-04-01', to: '2026-04-30' }))) as Table;
      expect(tableResult.safeParse(g).success).toBe(true);
      expect(g.columns.map((c) => c.key)).toEqual(['date', 'number', 'description', 'memo', 'partnerId', 'debit', 'credit', 'balance', 'entryId']);
      expect(g.rows.map((r) => [r.date, r.description, r.debit, r.credit, r.balance])).toEqual([
        ['2026-04-01', '繰越', null, null, '300'],
        ['2026-04-20', '4月分', '50', '0', '350'],
        ['2026-04-21', null, '999', '0', '1349'],
      ]);
      expect(g.rows[1]?.number).toMatch(/^JE-2026-\d{6}$/);
      expect(g.totals).toEqual({ debit: '1049', credit: '0', balance: '1349' });
      expect(g.meta).toMatchObject({ accountId: tb.a, code: 'TB-A', openingBalance: '300', closingBalance: '1349' });
      const c = (await run({}, (ctx) => runAction(ctx, 'accounting.general_ledger', { accountId: tb.c, from: '2026-04-01', to: '2026-05-31' }))) as Table;
      expect(c.rows.map((r) => [r.date, r.credit, r.balance])).toEqual([
        ['2026-04-01', null, '0'],
        ['2026-04-05', '100', '-100'],
        ['2026-04-20', '50', '-150'],
        ['2026-04-21', '999', '-1149'],
        ['2026-05-01', '1', '-1150'],
      ]);
      await expect(run({}, (ctx) => runAction(ctx, 'accounting.general_ledger', { accountId: newId() }))).rejects.toBeInstanceOf(NotFound);
    });
  });

  it('AC-10 close_period refuses submits dated in it, reopen_period allows them again; both audited; accounting/admin only; a closed year blocks too', async () => {
    const period = (await run({}, (ctx) => repo(ctx, FiscalPeriod).list({ where: { code: '2026-06' } }))).items[0];
    const periodId = period?.id ?? '';
    const accounting = asRole(['accounting']);
    const closed = (await run(accounting, (ctx) => runAction(ctx, 'accounting.close_period', { periodId }))) as Row;
    expect(closed).toMatchObject({ id: periodId, code: '2026-06', isClosed: true });
    const d = await run({}, (ctx) => createEntry(ctx, '2026-06-15', [line(acc.cash, '1', '0'), line(acc.sales, '0', '1')]));
    const err = await caught(run({}, (ctx) => submit(ctx, d.id)));
    expect(err).toMatchObject({ code: 'INVALID_STATE', hint: expect.stringContaining(PERIOD_HINT), details: { periodId, code: '2026-06' } });
    await expect(run({}, (ctx) => postFromSource(ctx, { sourceEntity: 'x', sourceId: newId(), date: '2026-06-30', lines: [line(acc.cash, '1', '0'), line(acc.sales, '0', '1')] as never }))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await postEntry('2026-07-01', [line(acc.cash, '1', '0'), line(acc.sales, '0', '1')])).docstatus).toBe(1);
    await expect(run(accounting, (ctx) => runAction(ctx, 'accounting.close_period', { periodId }))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(run(asRole(['sales']), (ctx) => runAction(ctx, 'accounting.reopen_period', { periodId }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(run(asRole(['viewer']), (ctx) => runAction(ctx, 'accounting.close_period', { periodId: newId() }))).rejects.toBeInstanceOf(PermissionDenied);
    const reopened = (await run({}, (ctx) => runAction(ctx, 'accounting.reopen_period', { periodId }))) as Row;
    expect(reopened).toMatchObject({ isClosed: false });
    expect((await run({}, (ctx) => submit(ctx, d.id))).docstatus).toBe(1);
    const trail = await run({}, (ctx) => auditTrail(ctx, 'fiscal_period', periodId));
    const updates = trail.filter((t) => t.op === 'update').map((t) => [t.actorType, (t.before as Row).isClosed, (t.after as Row).isClosed]);
    // FIXED_NOW gives both transitions the same audit timestamp; verify both exact changes without inventing an order.
    expect(updates).toHaveLength(2);
    expect(updates).toEqual(expect.arrayContaining([
      ['user', true, false],
      ['user', false, true],
    ]));
    expect(trail.find((t) => (t.after as Row).isClosed === true)?.actorId).toBe(accounting.actor.id);
    // closing the fiscal year blocks every period in it
    const fy = (await run({}, (ctx) => repo(ctx, FiscalYear).list({ where: { code: 'FY2026' } }))).items[0];
    await run({}, (ctx) => repo(ctx, FiscalYear).update(fy?.id ?? '', { isClosed: true }));
    const d2 = await run({}, (ctx) => createEntry(ctx, '2026-08-01', [line(acc.cash, '1', '0'), line(acc.sales, '0', '1')]));
    await expect(run({}, (ctx) => submit(ctx, d2.id))).rejects.toMatchObject({ code: 'INVALID_STATE', details: { code: 'FY2026' } });
    await run({}, (ctx) => repo(ctx, FiscalYear).update(fy?.id ?? '', { isClosed: false }));
    expect((await run({}, (ctx) => submit(ctx, d2.id))).docstatus).toBe(1);
  });

  describe('AC-12 properties against the database', () => {
    /** Amounts as integer cents rendered as decimal strings (JS integers are exact). */
    const cents = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
    const arbCents = fc.integer({ min: 1, max: 10_000_000 });
    const split = (total: number, weights: number[]) => {
      const k = weights.length;
      const wsum = weights.reduce((a, b) => a + b, 0);
      const parts = weights.map((w) => 1 + Math.floor(((total - k) * w) / wsum));
      parts[k - 1] = (parts[k - 1] ?? 0) + (total - parts.reduce((a, b) => a + b, 0));
      return parts;
    };
    const arbAccount = () => fc.constantFrom(acc.cash, acc.sales, acc.expense);
    /** 1..4 debit lines and 1..4 credit lines over random non-partner accounts with equal totals (never more credit parts than cents). */
    const arbBalanced = () =>
      fc
        .record({ debits: fc.array(fc.tuple(arbAccount(), arbCents), { minLength: 1, maxLength: 4 }), credits: fc.array(fc.tuple(arbAccount(), fc.integer({ min: 1, max: 1000 })), { minLength: 1, maxLength: 4 }) })
        .map(({ debits, credits: all }) => {
          const total = debits.reduce((a, [, c]) => a + c, 0);
          const credits = all.slice(0, Math.min(all.length, total));
          const parts = split(
            total,
            credits.map(([, w]) => w),
          );
          return [...debits.map(([a, c]) => line(a, cents(c), '0')), ...credits.map(([a], i) => line(a, '0', cents(parts[i] ?? 1)))];
        });
    const arbUnbalanced = () =>
      fc.tuple(arbBalanced(), fc.integer({ min: 1, max: 100_000 }), fc.nat()).map(([lines, delta, pick]) => {
        const i = pick % lines.length;
        return lines.map((l, j) => (j === i ? { ...l, [l.debit === '0' ? 'credit' : 'debit']: Decimal.from(String(l.debit === '0' ? l.credit : l.debit)).plus(cents(delta)).toString() } : l));
      });
    const RUNS = { numRuns: 6, endOnFailure: true };

    it('random balanced line sets always submit (totals = Σdebit = Σcredit, every line posted)', async () => {
      await fc.assert(
        fc.asyncProperty(arbBalanced(), async (lines) => {
          const e = await postEntry('2026-02-10', lines);
          const total = lines.reduce((t, l) => t.plus(String(l.debit)), Decimal.zero());
          expect(e.docstatus).toBe(1);
          expect(e.totalDebit).toBe(total.toString());
          expect(e.totalCredit).toBe(total.toString());
          expect(e.lines.journal_line.every((l) => l.posted && l.entryDate === '2026-02-10')).toBe(true);
        }),
        RUNS,
      );
    });

    it('random unbalanced line sets never submit (VALIDATION on the totals) and leave the draft unposted', async () => {
      await fc.assert(
        fc.asyncProperty(arbUnbalanced(), async (lines) => {
          const d = await run({}, (ctx) => createEntry(ctx, '2026-02-11', lines));
          const err = await caught(run({}, (ctx) => submit(ctx, d.id)));
          expect(err).toBeInstanceOf(ValidationError);
          expect(((err as ValidationError).details as { issues: { path: string; message: string }[] }).issues.some((i) => i.path === 'lines' && /differ by/.test(i.message))).toBe(true);
          const still = await run({}, (ctx) => repo(ctx, JournalEntry).get(d.id));
          expect([still.docstatus, still.number]).toEqual([0, null]);
          expect(await run({}, (ctx) => repo(ctx, JournalLine).count({ entryId: d.id, posted: true }))).toBe(0);
        }),
        RUNS,
      );
    });

    it('reversing any submitted entry leaves every account net (Σdebit − Σcredit over posted lines) unchanged — aggregate port', async () => {
      await fc.assert(
        fc.asyncProperty(arbBalanced(), fc.constantFrom('2026-02-12', '2026-03-03'), async (lines, reversalDate) => {
          const before = await run({}, netByAccount);
          const e = await postEntry('2026-02-12', lines);
          const rev = await run({}, (ctx) => reverseEntry(ctx, { id: e.id, date: reversalDate }));
          expect(rev.reversalOf).toBe(e.id);
          expect(rev.lines.map((l) => [l.accountId, l.debit.toString(), l.credit.toString()])).toEqual(e.lines.journal_line.map((l) => [l.accountId, l.credit, l.debit]));
          const after = await run({}, netByAccount);
          expect(after).toEqual(before);
        }),
        RUNS,
      );
    });
  });
});
