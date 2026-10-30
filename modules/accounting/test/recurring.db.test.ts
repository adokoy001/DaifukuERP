// Postgres tests for docs/specs/recurring-journals.md AC-4..AC-21 (recurring_journal, accounting.generate_recurring,
// accounting.recurring_schedule). Test DB: TEST_DATABASE_URL_OWNER / TEST_DATABASE_URL. "Today" is 2026-10-15 JST;
// fiscal year 2026 (Jan–Dec) is open, 2027 has no fiscal period. Most generations name one template (templateId) so
// tests do not see each other's templates; tests that run every template first deactivate the others.
import {
  companies,
  DaifukuError,
  Decimal,
  f,
  newId,
  registerCrudActions,
  registry,
  repo,
  runAction,
  setSetting,
  ValidationError,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { Partner } from '@daifuku/mod-partner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRecurringRun } from '../src/domain-write.ts';
import {
  Account,
  closeReadinessOutput,
  FiscalYear,
  generateRecurring,
  generateRecurringOutput,
  JournalEntry,
  JournalLine,
  RECURRING_AUTO_SUBMIT_KEY,
  RECURRING_GENERATED_EVENT,
  RecurringJournal,
  RecurringJournalLine,
  RecurringJournalRun,
  recurringAutoSubmitSchema,
  type GenerateRecurringResult,
} from '../src/index.ts';

type Row = Record<string, unknown>;
type LineJson = Row & {
  id: string;
  seq: number;
  accountId: string;
  debit: string;
  credit: string;
  memo: string | null;
};
type TemplateJson = Row & {
  id: string;
  version: number;
  kind: string;
  nextRunDate: string | null;
  lastOccurrenceDate: string | null;
  lines: { recurring_journal_line: LineJson[] };
};
type Table = { columns: { key: string }[]; rows: Row[]; meta?: Row };

// AC-9: extension fields. Each side has one key shared with the journal side and one key of its own; generation copies
// only the shared keys (postingDimensions).
const EXT_SOURCE = { source: 'test:recurring' };
registry.registerExt(RecurringJournal.name, { department: f.text(), templateNote: f.text() }, EXT_SOURCE);
registry.registerExt(JournalEntry.name, { department: f.text() }, EXT_SOURCE);
registry.registerExt(RecurringJournalLine.name, { costCenter: f.text(), lineNote: f.text() }, EXT_SOURCE);
registry.registerExt(JournalLine.name, { costCenter: f.text() }, EXT_SOURCE);

const FIXED_NOW = new Date('2026-10-15T03:00:00Z');
const ACCOUNTING = { roles: ['accounting'], actor: { type: 'user' as const, id: newId() } };
const VIEWER = { roles: ['viewer'], actor: { type: 'user' as const, id: newId() } };
const SALES = { roles: ['sales'], actor: { type: 'user' as const, id: newId() } };

let db: TestDb;
let companyB = '';
let partnerId = '';
let periods: Record<string, string> = {};
let acc: { rent: string; accrued: string; prepaid: string; insurance: string; ar: string; cash: string };

const run = <T>(fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = {}): Promise<T> =>
  db.run({ now: () => FIXED_NOW, ...params }, fn);
const act = <T = Row>(name: string, input: unknown, params: Partial<ContextParams> = ACCOUNTING): Promise<T> =>
  run((ctx) => runAction(ctx, name, input), params) as Promise<T>;
const generate = async (input: Row, params: Partial<ContextParams> = ACCOUNTING): Promise<GenerateRecurringResult> =>
  generateRecurringOutput.parse(await act('accounting.generate_recurring', input, params));
async function caught(p: Promise<unknown>): Promise<DaifukuError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DaifukuError) return e;
    throw e;
  }
  throw new Error('expected a DaifukuError');
}
const line = (accountId: string, debit: string, credit: string, extra: Row = {}): Row => ({
  accountId,
  debit,
  credit,
  ...extra,
});
const rentLines = (amount = '100000') => [
  line(acc.rent, amount, '0', { taxCategory: 'standard', taxRate: '0.10', memo: '家賃' }),
  line(acc.accrued, '0', amount, { partnerId }),
];
async function template(input: Row, params: Partial<ContextParams> = ACCOUNTING): Promise<TemplateJson> {
  const { lines, ...head } = input;
  return act<TemplateJson>(
    'recurring_journal.create',
    { ...head, ...(lines ? { lines: { recurring_journal_line: lines } } : {}) },
    params,
  );
}
const getTemplate = (id: string, params: Partial<ContextParams> = ACCOUNTING) =>
  act<TemplateJson>('recurring_journal.get', { id }, params);
async function entryWithLines(id: string): Promise<Row & { lines: { journal_line: LineJson[] } }> {
  return act('journal_entry.get', { id });
}
async function entriesOf(templateId: string): Promise<Row[]> {
  return run(async (ctx) => (await repo(ctx, RecurringJournalRun).list({ where: { templateId }, limit: 500 })).items);
}
/** Payloads of recurring_journal.generated in the outbox for one template, oldest first (AC-20). */
async function eventsOf(templateId: string): Promise<Row[]> {
  const rows = await db.owner.sql<{ payload: Row }[]>`
    select payload from outbox
    where topic = ${RECURRING_GENERATED_EVENT} and tenant_id = ${db.tenantId} and payload->>'templateId' = ${templateId}
    order by created_at, id`;
  return rows.map((r) => r.payload);
}
async function deactivateAll(): Promise<void> {
  await run(async (ctx) => {
    for (const t of (await repo(ctx, RecurringJournal).list({ where: { isActive: true }, limit: 500 })).items)
      await repo(ctx, RecurringJournal).update(t.id, { isActive: false });
  });
}
async function setPeriodClosed(code: string, closed: boolean): Promise<void> {
  await act(closed ? 'accounting.close_period' : 'accounting.reopen_period', { periodId: periods[code] ?? '' });
}
async function createAccount(code: string, name: string, type: string, extra: Row = {}): Promise<string> {
  return (await run((ctx) => repo(ctx, Account).create({ code, name, type: type as never, ...extra }))).id;
}

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  await act('accounting.open_fiscal_year', { startDate: '2026-01-01' }, {});
  const list = await act<{ items: Row[] }>('fiscal_period.list', { limit: 100 });
  periods = Object.fromEntries(list.items.map((p) => [String(p.code), String(p.id)]));
  partnerId = (await run((ctx) => repo(ctx, Partner).create({ name: '大家株式会社', isSupplier: true }))).id;
  acc = {
    rent: await createAccount('6100', '地代家賃', 'expense'),
    accrued: await createAccount('2200', '未払費用', 'liability'),
    prepaid: await createAccount('1500', '前払費用', 'asset'),
    insurance: await createAccount('6200', '保険料', 'expense'),
    ar: await createAccount('1300', '売掛金', 'asset', { partnerRequired: true }),
    cash: await createAccount('1000', '現金', 'asset'),
  };
  companyB = newId();
  await db.owner.drizzle.insert(companies).values({ id: companyB, tenantId: db.tenantId, code: 'B', name: 'B' });
});
afterAll(async () => {
  await db.close();
});

describe('recurring journal template (AC-4, AC-5, AC-7, AC-8)', () => {
  it('AC-4 accounting reads/creates/updates/deletes, viewer reads, sales and a site-limited context are refused; lines come with get', async () => {
    const t = await template({ name: '事務所家賃', startDate: '2026-08-01', dayOfMonth: 25, lines: rentLines() });
    expect(t).toMatchObject({ kind: 'fixed', frequency: 'monthly', isActive: true, dayOfMonth: 25 });
    expect(t.lines.recurring_journal_line.map((l) => [l.seq, l.debit, l.credit])).toEqual([
      [1, '100000', '0'],
      [2, '0', '100000'],
    ]);
    expect((await getTemplate(t.id, VIEWER)).lines.recurring_journal_line).toHaveLength(2);
    expect((await caught(template({ name: 'x', lines: rentLines() }, VIEWER))).code).toBe('PERMISSION_DENIED');
    expect((await caught(getTemplate(t.id, SALES))).code).toBe('PERMISSION_DENIED');
    const site = { ...ACCOUNTING, accessScope: 'sites' as const, siteIds: [newId()] };
    expect((await caught(getTemplate(t.id, site))).code).toBe('PERMISSION_DENIED');
    const lineList = await caught(act('recurring_journal_line.list', {}, SALES));
    expect(lineList.code).toBe('PERMISSION_DENIED');
    const tmp = await template({ name: '削除用', lines: rentLines() });
    await act('recurring_journal.delete', { id: tmp.id });
    expect(await run((ctx) => repo(ctx, RecurringJournalLine).count({ templateId: tmp.id }))).toBe(0);
  });

  it('AC-5 nextRunDate is derived on create and update; nextRunDate / lastOccurrenceDate input is PERMISSION_DENIED', async () => {
    const t = await template({ name: '顧問料', startDate: '2026-08-01', dayOfMonth: 25, lines: rentLines('30000') });
    expect(t.nextRunDate).toBe('2026-08-25');
    const moved = await act<TemplateJson>('recurring_journal.update', {
      id: t.id,
      patch: { startDate: '2026-09-26' },
    });
    expect(moved.nextRunDate).toBe('2026-10-25');
    expect((await caught(template({ name: 'x', nextRunDate: '2026-01-01', lines: rentLines() }))).code).toBe(
      'PERMISSION_DENIED',
    );
    expect(
      (await caught(act('recurring_journal.update', { id: t.id, patch: { lastOccurrenceDate: '2026-09-25' } }))).code,
    ).toBe('PERMISSION_DENIED');
    const ended = await act<TemplateJson>('recurring_journal.update', { id: t.id, patch: { endDate: '2026-10-24' } });
    expect(ended.nextRunDate).toBeNull();
  });

  it('AC-7 line rules on save with lines (issues on grid cells), header rules on every update; a create without lines is accepted', async () => {
    const unbalanced = await caught(
      template({ name: '不一致', lines: [line(acc.rent, '100', '0'), line(acc.accrued, '0', '90')] }),
    );
    expect(unbalanced).toBeInstanceOf(ValidationError);
    expect(unbalanced.code).toBe('VALIDATION');
    const partner = await caught(
      template({ name: '取引先', lines: [line(acc.ar, '100', '0'), line(acc.cash, '0', '100')] }),
    );
    expect((partner.details?.issues as Row[]).map((i) => i.path)).toEqual(['lines.recurring_journal_line.0.partnerId']);
    // nothing of a refused create remains
    expect(await run((ctx) => repo(ctx, RecurringJournal).count({ name: '不一致' }))).toBe(0);
    const header = await caught(template({ name: '期間', startDate: '2026-05-01', endDate: '2026-04-30' }));
    expect((header.details?.issues as Row[]).map((i) => i.path)).toEqual(['endDate']);
    const bare = await template({ name: '明細なし' });
    expect(bare.lines.recurring_journal_line).toEqual([]);
    const renamed = await act<TemplateJson>('recurring_journal.update', { id: bare.id, patch: { name: '明細なし2' } });
    expect(renamed.name).toBe('明細なし2');
    const badHeader = await caught(act('recurring_journal.update', { id: bare.id, patch: { endDate: '2020-01-01' } }));
    expect(badHeader.code).toBe('VALIDATION');
  });

  it('AC-7 one save switching fixed -> allocation and cutting 3 lines to 1 debit + 1 credit passes; a header-only switch against 3 saved lines is refused', async () => {
    const t = await template({
      name: '保険（定額→按分）',
      startDate: '2026-11-01',
      lines: [line(acc.insurance, '600', '0'), line(acc.rent, '600', '0'), line(acc.prepaid, '0', '1200')],
    });
    const headerOnly = await caught(
      act('recurring_journal.update', { id: t.id, patch: { kind: 'allocation', allocationPeriods: 12 } }),
    );
    expect(headerOnly.code).toBe('VALIDATION');
    expect((headerOnly.details?.issues as Row[]).map((i) => i.path)).toContain('lines');
    const combined = await act<TemplateJson>('recurring_journal.update', {
      id: t.id,
      expectedVersion: t.version,
      patch: {
        kind: 'allocation',
        allocationPeriods: 12,
        lines: { recurring_journal_line: [line(acc.insurance, '1200', '0'), line(acc.prepaid, '0', '1200')] },
      },
    });
    expect(combined).toMatchObject({ kind: 'allocation', allocationPeriods: 12, nextRunDate: '2026-11-30' });
    expect(combined.lines.recurring_journal_line).toHaveLength(2);
    // and an allocation with a fractional yen total is refused on save
    const frac = await caught(
      act('recurring_journal.update', {
        id: t.id,
        patch: {
          lines: { recurring_journal_line: [line(acc.insurance, '1200.5', '0'), line(acc.prepaid, '0', '1200.5')] },
        },
      }),
    );
    expect((frac.details?.issues as Row[]).map((i) => i.path)).toEqual(['lines.recurring_journal_line.0.debit']);
  });

  it('AC-8 after generation: kind and the allocation schedule/amounts/rows are frozen, memo/tax/order are not; the template cannot be deleted', async () => {
    const t = await template({
      name: '前払保険料',
      kind: 'allocation',
      allocationPeriods: 6,
      startDate: '2026-08-01',
      lines: [line(acc.insurance, '60000', '0', { memo: 'm' }), line(acc.prepaid, '0', '60000')],
    });
    const res = await generate({ templateId: t.id, asOf: '2026-08-31' });
    expect(res.templates[0]?.entries).toHaveLength(1);
    const after = await getTemplate(t.id);
    expect(after.lastOccurrenceDate).toBe('2026-08-31');
    const pick = (l: LineJson) => ({
      id: l.id,
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo,
    });
    const [debit, credit] = after.lines.recurring_journal_line.map(pick) as [LineJson, LineJson];
    const refuse = async (patch: Row) => (await caught(act('recurring_journal.update', { id: t.id, patch }))).code;
    expect(await refuse({ kind: 'fixed', allocationPeriods: null })).toBe('INVALID_STATE');
    expect(await refuse({ allocationPeriods: 12 })).toBe('INVALID_STATE');
    expect(await refuse({ dayOfMonth: 15 })).toBe('INVALID_STATE');
    expect(await refuse({ startDate: '2026-07-01' })).toBe('INVALID_STATE');
    const amount = {
      lines: {
        recurring_journal_line: [
          { ...debit, debit: '70000' },
          { ...credit, credit: '70000' },
        ],
      },
    };
    expect(await refuse(amount)).toBe('INVALID_STATE');
    const added = { lines: { recurring_journal_line: [debit, credit, line(acc.rent, '0', '0')] } };
    expect(await refuse(added)).toBe('INVALID_STATE');
    const direct = await caught(
      act('recurring_journal_line.create', { templateId: t.id, accountId: acc.rent, debit: '1', credit: '0' }),
    );
    expect(direct.code).toBe('INVALID_STATE');
    // memo, tax category and order may change (values of the frozen fields are unchanged)
    const edited = await act<TemplateJson>('recurring_journal.update', {
      id: t.id,
      patch: {
        name: '前払保険料（改）',
        endDate: '2027-01-31',
        lines: {
          recurring_journal_line: [
            { id: credit.id, accountId: credit.accountId, debit: '0', credit: '60000.00', memo: '貸方' },
            { id: debit.id, accountId: debit.accountId, debit: '60000', credit: '0', taxCategory: 'exempt' },
          ],
        },
      },
    });
    expect(edited.lines.recurring_journal_line.map((l) => [l.id, l.memo])).toEqual([
      [credit.id, '貸方'],
      [debit.id, 'm'],
    ]);
    expect(edited.isActive).toBe(true);
    await act('recurring_journal.update', { id: t.id, patch: { isActive: false } });
    expect((await caught(act('recurring_journal.delete', { id: t.id }))).code).toBe('INVALID_STATE');
  });

  it('AC-8 a fixed template may change day and start after generation; the next run moves to the next month, not a second entry in this one', async () => {
    const t = await template({ name: '駐車場', startDate: '2026-10-01', dayOfMonth: 15, lines: rentLines('20000') });
    await generate({ templateId: t.id, asOf: '2026-10-15' });
    const changed = await act<TemplateJson>('recurring_journal.update', { id: t.id, patch: { dayOfMonth: 31 } });
    expect(changed.nextRunDate).toBe('2026-11-30');
    const again = await generate({ templateId: t.id, asOf: '2026-10-31' });
    expect(again.templates[0]).toMatchObject({ status: 'up_to_date', entries: [] });
    expect(await entriesOf(t.id)).toHaveLength(1);
    await act('recurring_journal.update', { id: t.id, patch: { isActive: false } });
  });
});

describe('accounting.generate_recurring (AC-9..AC-20)', () => {
  it('AC-9 one draft entry per due occurrence with the template description, lines, partner, tax and shared ext keys; no source; next run advanced', async () => {
    const t = await template({
      name: '本社家賃',
      description: '本社 家賃 未払計上',
      startDate: '2026-08-01',
      ext: { department: 'D1', templateNote: 'not copied' },
      lines: [
        line(acc.rent, '100000', '0', {
          taxCategory: 'standard',
          taxRate: '0.10',
          memo: '家賃',
          ext: { costCenter: 'C9', lineNote: 'not copied' },
        }),
        line(acc.accrued, '0', '100000', { partnerId }),
      ],
    });
    const res = await generate({ templateId: t.id });
    expect(res).toMatchObject({ asOf: '2026-10-15', autoSubmit: false, created: 2, truncated: false });
    const tr = res.templates[0];
    expect(tr).toMatchObject({ templateId: t.id, name: '本社家賃', status: 'generated', nextRunDate: '2026-10-31' });
    expect(tr?.entries.map((e) => [e.occurrenceDate, e.occurrenceNo, e.docstatus, e.number, e.amount])).toEqual([
      ['2026-08-31', null, 0, null, '100000'],
      ['2026-09-30', null, 0, null, '100000'],
    ]);
    const entry = await entryWithLines(tr?.entries[0]?.entryId ?? '');
    expect(entry).toMatchObject({
      date: '2026-08-31',
      description: '本社 家賃 未払計上',
      docstatus: 0,
      sourceEntity: null,
      sourceId: null,
      reversalOf: null,
      totalDebit: '0',
    });
    // only the keys registered on both the template side and the journal side are copied
    expect(entry.ext).toEqual({ department: 'D1' });
    expect(entry.lines.journal_line.map((l) => l.ext ?? {})).toEqual([{ costCenter: 'C9' }, {}]);
    expect(
      entry.lines.journal_line.map((l) => [
        l.accountId,
        l.debit,
        l.credit,
        l.partnerId,
        l.taxCategory,
        l.taxRate,
        l.memo,
      ]),
    ).toEqual([
      [acc.rent, '100000', '0', null, 'standard', '0.1', '家賃'],
      [acc.accrued, '0', '100000', partnerId, null, null, null],
    ]);
    const after = await getTemplate(t.id);
    expect(after).toMatchObject({ lastOccurrenceDate: '2026-09-30', nextRunDate: '2026-10-31' });
    await act('recurring_journal.update', { id: t.id, patch: { isActive: false } });
  });

  it('AC-10 a repeated run creates nothing; two concurrent runs both succeed with exactly one entry per occurrence; a second run row is CONFLICT', async () => {
    await deactivateAll();
    const a = await template({ name: '同時A', startDate: '2026-07-01', lines: rentLines('1000') });
    const b = await template({ name: '同時B', startDate: '2026-07-01', dayOfMonth: 10, lines: rentLines('2000') });
    const [first, second] = await Promise.allSettled([generate({}), generate({})]);
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('fulfilled');
    const created = [first, second].map((r) => (r.status === 'fulfilled' ? r.value.created : -1));
    expect(created.sort()).toEqual([0, 7]); // A: Jul–Sep (3), B: Jul–Oct 10 (4)
    // Neither run fails only because of the other: the later one waits on the series lock and reads the candidates after
    // the first commit, so it finds nothing due (without the locks the unique key would turn its templates into failed).
    const results = [first, second].flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    expect(
      results.flatMap((r) =>
        r.templates.filter((t) => t.status !== 'generated').map((t) => [t.name, t.status, t.stop]),
      ),
    ).toEqual([]);
    expect(results.find((r) => r.created === 0)?.templates).toEqual([]);
    for (const [id, n] of [
      [a.id, 3],
      [b.id, 4],
    ] as const) {
      const runs = await entriesOf(id);
      expect(runs).toHaveLength(n);
      expect(new Set(runs.map((r) => r.occurrenceDate)).size).toBe(n);
    }
    const repeat = await generate({});
    expect(repeat).toMatchObject({ created: 0, truncated: false, templates: [] });
    const dup = await caught(
      run((ctx) =>
        withRecurringRun(ctx, (w) =>
          repo(w, RecurringJournalRun).create({ templateId: a.id, occurrenceDate: '2026-07-31', occurrenceNo: null }),
        ),
      ),
    );
    expect(dup.code).toBe('CONFLICT');
    await deactivateAll();
  });

  it('AC-11 a closed period stops the template at that occurrence (earlier entries stay, other templates continue); closed year and no period too', async () => {
    await deactivateAll();
    await setPeriodClosed('2026-09', true);
    const stopped = await template({ name: '締め', startDate: '2026-08-01', lines: rentLines('500') });
    const other = await template({ name: '他', startDate: '2026-10-01', dayOfMonth: 5, lines: rentLines('700') });
    const res = await generate({ asOf: '2026-10-31' });
    const s = res.templates.find((t) => t.templateId === stopped.id);
    expect(s).toMatchObject({ status: 'blocked', nextRunDate: '2026-09-30' });
    expect(s?.entries.map((e) => e.occurrenceDate)).toEqual(['2026-08-31']);
    expect(s?.stop).toMatchObject({
      occurrenceDate: '2026-09-30',
      reason: 'closed_period',
      code: 'INVALID_STATE',
      periodCode: '2026-09',
    });
    expect(res.templates.find((t) => t.templateId === other.id)).toMatchObject({ status: 'generated' });
    // a repeated run reports the same stop with nothing created
    const again = await generate({ templateId: stopped.id, asOf: '2026-10-31' });
    expect(again.templates[0]).toMatchObject({
      status: 'blocked',
      entries: [],
      stop: { occurrenceDate: '2026-09-30' },
    });
    await setPeriodClosed('2026-09', false);
    // closed year
    const yearId = (await run((ctx) => repo(ctx, FiscalYear).list({ limit: 1 }))).items[0]?.id ?? '';
    await run((ctx) => repo(ctx, FiscalYear).update(yearId, { isClosed: true }));
    const year = await generate({ templateId: stopped.id, asOf: '2026-10-31' });
    expect(year.templates[0]?.stop).toMatchObject({ reason: 'closed_year', fiscalYearCode: 'FY2026' });
    await run((ctx) => repo(ctx, FiscalYear).update(yearId, { isClosed: false }));
    // no period: 2027 is not opened
    const done = await generate({ templateId: stopped.id, asOf: '2027-01-31' });
    expect(done.templates[0]?.entries.map((e) => e.occurrenceDate)).toEqual([
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ]);
    expect(done.templates[0]?.stop).toMatchObject({ occurrenceDate: '2027-01-31', reason: 'no_period' });
    await deactivateAll();
  });

  it('AC-12 a business error rolls back only that occurrence (and its event, AC-20) and stops its template; a template without lines is invalid_template; other errors fail the run', async () => {
    await deactivateAll();
    registry.registerHook(JournalEntry.name, 'before_create', (_ctx, { row }) => {
      if (row.description === 'boom' && row.date === '2026-09-30')
        throw new ValidationError('synthetic business rule', [{ path: 'date', message: 'refused by test hook' }]);
      if (row.description === 'crash') throw new Error('synthetic infrastructure failure');
    });
    const boom = await template({ name: 'b', description: 'boom', startDate: '2026-08-01', lines: rentLines('10') });
    const bare = await template({ name: '明細なし', startDate: '2026-08-01' });
    const fine = await template({ name: 'ok', startDate: '2026-10-01', dayOfMonth: 1, lines: rentLines('20') });
    const res = await generate({ asOf: '2026-10-31' });
    const b = res.templates.find((t) => t.templateId === boom.id);
    expect(b).toMatchObject({ status: 'failed', nextRunDate: '2026-09-30' });
    expect(b?.entries.map((e) => e.occurrenceDate)).toEqual(['2026-08-31']);
    expect(b?.stop).toMatchObject({ occurrenceDate: '2026-09-30', reason: 'error', code: 'VALIDATION' });
    expect(b?.stop?.issues).toEqual([{ path: 'date', message: 'refused by test hook' }]);
    expect((await entriesOf(boom.id)).map((r) => r.occurrenceDate)).toEqual(['2026-08-31']);
    expect(await run((ctx) => repo(ctx, JournalEntry).count({ description: 'boom', date: '2026-09-30' }))).toBe(0);
    // AC-20: the generated occurrence has its event, the rolled-back one has none (the emit is the last step inside the
    // occurrence's savepoint, so an occurrence rolled back by an earlier step never reaches it)
    expect((await eventsOf(boom.id)).map((p) => p.occurrenceDate)).toEqual(['2026-08-31']);
    const n = res.templates.find((t) => t.templateId === bare.id);
    expect(n).toMatchObject({
      status: 'failed',
      entries: [],
      stop: { reason: 'invalid_template', occurrenceDate: '2026-08-31' },
    });
    expect(res.templates.find((t) => t.templateId === fine.id)).toMatchObject({ status: 'generated' });
    // a non-business error fails the whole call and leaves nothing
    await act('recurring_journal.update', { id: boom.id, patch: { isActive: false } });
    await act('recurring_journal.update', { id: bare.id, patch: { isActive: false } });
    const crash = await template({
      name: 'c',
      description: 'crash',
      startDate: '2026-10-01',
      dayOfMonth: 2,
      lines: rentLines('30'),
    });
    const ok2 = await template({ name: 'ok2', startDate: '2026-10-01', dayOfMonth: 3, lines: rentLines('40') });
    const runsBefore = await run((ctx) => repo(ctx, RecurringJournalRun).count());
    await expect(generate({ asOf: '2026-10-31' })).rejects.toThrow(/synthetic infrastructure failure/);
    expect(await run((ctx) => repo(ctx, RecurringJournalRun).count())).toBe(runsBefore);
    expect((await getTemplate(ok2.id)).lastOccurrenceDate).toBeNull();
    await act('recurring_journal.update', { id: crash.id, patch: { isActive: false } });
    await deactivateAll();
  });

  it('AC-13 an allocation spreads 100,000 over 12 months (8,333 × 11, 8,337), adds up to the total and ends after the 12th', async () => {
    const t = await template({
      name: '年払保険料',
      description: '保険料振替',
      kind: 'allocation',
      allocationPeriods: 12,
      startDate: '2026-01-01',
      lines: [line(acc.insurance, '100000', '0', { taxCategory: 'exempt' }), line(acc.prepaid, '0', '100000')],
    });
    const res = await generate({ templateId: t.id, asOf: '2026-12-31' });
    const entries = res.templates[0]?.entries ?? [];
    expect(entries.map((e) => [e.occurrenceNo, e.amount])).toEqual([
      ...Array.from({ length: 11 }, (_, i) => [i + 1, '8333']),
      [12, '8337'],
    ]);
    expect(Decimal.sum(entries.map((e) => Decimal.from(e.amount))).eq('100000')).toBe(true);
    expect(res.templates[0]?.nextRunDate).toBeNull();
    const last = await entryWithLines(entries[11]?.entryId ?? '');
    expect(last.description).toBe('保険料振替 (12/12)');
    expect(last.lines.journal_line.map((l) => [l.debit, l.credit])).toEqual([
      ['8337', '0'],
      ['0', '8337'],
    ]);
    const runs = await entriesOf(t.id);
    expect(runs.map((r) => r.occurrenceNo).sort((x, y) => Number(x) - Number(y))).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    await act('recurring_journal.update', { id: t.id, patch: { isActive: false } });
  });

  it('AC-14 auto-submit off leaves drafts counted by the close guide; on submits them (number, docstatus 1) and the draft count does not grow', async () => {
    const draftsOf = async (code: string) => {
      const r = closeReadinessOutput.parse(await act('accounting.close_readiness', { periodId: periods[code] ?? '' }));
      return r.items.find((i) => i.id === 'draft:journal_entry')?.count ?? 0;
    };
    const before = await draftsOf('2026-06');
    const off = await template({
      name: '自動確定オフ',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      lines: rentLines('111'),
    });
    await generate({ templateId: off.id });
    expect(await draftsOf('2026-06')).toBe(before + 1);
    await run((ctx) => setSetting(ctx, RECURRING_AUTO_SUBMIT_KEY, recurringAutoSubmitSchema, true), {});
    const on = await template({
      name: '自動確定オン',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      lines: rentLines('222'),
    });
    const res = await generate({ templateId: on.id });
    expect(res.autoSubmit).toBe(true);
    const e = res.templates[0]?.entries[0];
    expect(e).toMatchObject({ docstatus: 1, occurrenceDate: '2026-06-30' });
    expect(e?.number).toMatch(/^JE-/);
    expect(await draftsOf('2026-06')).toBe(before + 1);
    const posted = await run((ctx) => repo(ctx, JournalLine).count({ entryId: e?.entryId ?? '', posted: true }));
    expect(posted).toBe(2);
    await run((ctx) => setSetting(ctx, RECURRING_AUTO_SUBMIT_KEY, recurringAutoSubmitSchema, false), {});
  });

  it('AC-15 sales, viewer and a store-limited context are refused; admin may run it', async () => {
    const t = await template({ name: '権限', startDate: '2026-10-01', dayOfMonth: 1, lines: rentLines('5') });
    for (const params of [SALES, VIEWER, { ...ACCOUNTING, accessScope: 'stores' as const, storeIds: [newId()] }])
      expect((await caught(generate({ templateId: t.id }, params))).code).toBe('PERMISSION_DENIED');
    expect(await entriesOf(t.id)).toHaveLength(0);
    const res = await generate({ templateId: t.id }, { roles: ['admin'], actor: { type: 'user', id: newId() } });
    expect(res.created).toBe(1);
  });

  it('AC-16 company isolation: another company is not read, not changed; its templateId is NOT_FOUND; an inactive template reports inactive', async () => {
    const inB = { ...ACCOUNTING, companyId: companyB };
    await act('accounting.open_fiscal_year', { startDate: '2026-01-01' }, inB);
    const bAccount = await run((ctx) => repo(ctx, Account).create({ code: '6100', name: '家賃B', type: 'expense' }), {
      companyId: companyB,
    });
    const bAccrued = await run((ctx) => repo(ctx, Account).create({ code: '2200', name: '未払B', type: 'liability' }), {
      companyId: companyB,
    });
    const tb = await template(
      { name: 'B社家賃', startDate: '2026-09-01', lines: [line(bAccount.id, '9', '0'), line(bAccrued.id, '0', '9')] },
      inB,
    );
    const resA = await generate({});
    expect(resA.templates.map((t) => t.templateId)).not.toContain(tb.id);
    expect((await caught(generate({ templateId: tb.id }))).code).toBe('NOT_FOUND');
    expect((await caught(getTemplate(tb.id))).code).toBe('NOT_FOUND');
    expect(
      await run((ctx) => repo(ctx, RecurringJournalRun).count({ templateId: tb.id }), { companyId: companyB }),
    ).toBe(0);
    expect((await getTemplate(tb.id, inB)).lastOccurrenceDate).toBeNull();
    const resB = await generate({ templateId: tb.id }, inB);
    expect(resB.created).toBe(1);
    const entryB = resB.templates[0]?.entries[0]?.entryId ?? '';
    expect((await caught(act('journal_entry.get', { id: entryB }))).code).toBe('NOT_FOUND');
    const inactive = await template({ name: '無効', isActive: false, startDate: '2026-09-01', lines: rentLines('1') });
    expect((await generate({ templateId: inactive.id })).templates).toEqual([
      expect.objectContaining({ templateId: inactive.id, status: 'inactive', entries: [] }),
    ]);
  });

  it('AC-17 run records refuse every generic write (admin too: create by field ownership, update/delete by the hook); deleting a generated draft clears entryId and skips the occurrence; a submitted one reverses', async () => {
    const t = await template({ name: '記録', startDate: '2026-09-01', dayOfMonth: 1, lines: rentLines('77') });
    const res = await generate({ templateId: t.id });
    const [sep, oct] = res.templates[0]?.entries ?? [];
    const admin = { roles: ['admin'], actor: { type: 'user' as const, id: newId() } };
    const runRow = (await entriesOf(t.id))[0] as Row;
    for (const [name, input] of [
      ['recurring_journal_run.create', { templateId: t.id, occurrenceDate: '2026-11-01' }],
      ['recurring_journal_run.update', { id: runRow.id, patch: {} }],
      ['recurring_journal_run.delete', { id: runRow.id }],
    ] as const) {
      const err = await caught(act(name, input, admin));
      expect([name, err.code]).toEqual([name, name.endsWith('.create') ? 'PERMISSION_DENIED' : 'INVALID_STATE']);
    }
    // A create without the server-owned fields fails validation (they are required) before any hook runs, so the
    // before_create guard is defence in depth. Call the registered guards directly: each refuses outside generation,
    // and generation's capability (create only) passes create but not update or delete.
    const bare = await caught(run((ctx) => repo(ctx, RecurringJournalRun).create({} as never), admin));
    expect(bare.code).toBe('VALIDATION');
    const guard = (phase: 'before_create' | 'before_update' | 'before_delete', inGeneration: boolean) =>
      run(async (ctx) => {
        const hooks = registry.hooksFor(RecurringJournalRun.name, phase);
        const call = async (c: Context) => {
          for (const hook of hooks)
            await hook(c, { entity: RecurringJournalRun.name, row: { ...runRow }, previous: { ...runRow } });
        };
        try {
          await (inGeneration ? withRecurringRun(ctx, call) : call(ctx));
          return hooks.length > 0 ? 'passed' : 'no guard registered';
        } catch (e) {
          if (e instanceof DaifukuError) return e.code;
          throw e;
        }
      }, admin);
    expect(await guard('before_create', false)).toBe('INVALID_STATE');
    expect(await guard('before_create', true)).toBe('passed');
    expect(await guard('before_update', true)).toBe('INVALID_STATE');
    expect(await guard('before_delete', true)).toBe('INVALID_STATE');
    await act('journal_entry.delete', { id: sep?.entryId ?? '' });
    const runs = await entriesOf(t.id);
    expect(runs.find((r) => r.occurrenceDate === '2026-09-01')).toMatchObject({ entryId: null });
    expect((await generate({ templateId: t.id })).templates[0]).toMatchObject({ status: 'up_to_date', entries: [] });
    expect(await entriesOf(t.id)).toHaveLength(2);
    await act('journal_entry.submit', { id: oct?.entryId ?? '' });
    const reversed = await act<Row>('accounting.reverse_entry', { id: oct?.entryId ?? '' });
    expect(reversed.reversalOf).toBe(oct?.entryId);
    await act('recurring_journal.update', { id: t.id, patch: { isActive: false } });
  });

  it('AC-18 the per-call cap stops with truncated and more; the next call continues', async () => {
    await deactivateAll();
    const a = await template({ name: '上限A', startDate: '2026-01-01', dayOfMonth: 1, lines: rentLines('1') });
    const b = await template({ name: '上限B', startDate: '2026-01-01', dayOfMonth: 2, lines: rentLines('2') });
    const [first] = [a, b].sort((x, y) => x.id.localeCompare(y.id));
    const res1 = await run((ctx) => generateRecurring(ctx, { asOf: '2026-03-31' }, { maxEntries: 2 }), ACCOUNTING);
    expect(res1).toMatchObject({ created: 2, truncated: true });
    expect(res1.templates).toHaveLength(1);
    expect(res1.templates[0]).toMatchObject({ templateId: first?.id, more: true, status: 'generated' });
    const res2 = await run((ctx) => generateRecurring(ctx, { asOf: '2026-03-31' }, { maxEntries: 2 }), ACCOUNTING);
    expect(res2).toMatchObject({ created: 2, truncated: true });
    expect(res2.templates.map((t) => [t.entries.length, t.more])).toEqual([
      [1, false],
      [1, true],
    ]);
    const res3 = await run((ctx) => generateRecurring(ctx, { asOf: '2026-03-31' }, { maxEntries: 2 }), ACCOUNTING);
    expect(res3).toMatchObject({ created: 2, truncated: false });
    expect((await entriesOf(a.id)).length + (await entriesOf(b.id)).length).toBe(6);
    await deactivateAll();
  });

  it('AC-19 an impossible asOf or a non-uuid templateId is VALIDATION and writes nothing', async () => {
    for (const input of [{ asOf: '2026-02-30' }, { asOf: '20261015' }, { templateId: 'abc' }])
      expect((await caught(act('accounting.generate_recurring', input))).code).toBe('VALIDATION');
  });

  it('AC-20 each generated entry emits recurring_journal.generated in its savepoint', async () => {
    const t = await template({ name: 'イベント', startDate: '2026-10-01', dayOfMonth: 1, lines: rentLines('3') });
    const res = await generate({ templateId: t.id });
    const entryId = res.templates[0]?.entries[0]?.entryId;
    expect(await eventsOf(t.id)).toEqual([
      { templateId: t.id, occurrenceDate: '2026-10-01', occurrenceNo: null, entryId, submitted: false },
    ]);
    // the rolled-back occurrence leaving no event is checked with AC-12's failing template
    await act('recurring_journal.update', { id: t.id, patch: { isActive: false } });
  });
});

describe('accounting.recurring_schedule (AC-21)', () => {
  it('AC-21 one row per due occurrence with status due / blocked / after_blocked / invalid_template, read-only', async () => {
    await deactivateAll();
    const action = registry.action('accounting.recurring_schedule');
    expect([action.mutates, action.tx]).toEqual([false, 'none']);
    await setPeriodClosed('2026-08', true);
    const t = await template({ name: '予定', startDate: '2026-07-01', dayOfMonth: 31, lines: rentLines('1000') });
    const bad = await template({ name: '予定（明細なし）', startDate: '2026-09-01' });
    const table = await act<Table>('accounting.recurring_schedule', { asOf: '2026-10-31' }, VIEWER);
    expect(table.columns.map((c) => c.key)).toContain('reason');
    const mine = (id: string) =>
      table.rows.filter((r) => r.templateId === id).map((r) => [r.occurrenceDate, r.status, r.reason, r.periodCode]);
    expect(mine(t.id)).toEqual([
      ['2026-07-31', 'due', null, '2026-07'],
      ['2026-08-31', 'blocked', 'closed_period', '2026-08'],
      ['2026-09-30', 'after_blocked', null, '2026-09'],
      ['2026-10-31', 'after_blocked', null, '2026-10'],
    ]);
    expect(mine(bad.id)[0]?.slice(1, 3)).toEqual(['invalid_template', 'invalid_template']);
    expect(table.meta).toMatchObject({ asOf: '2026-10-31', autoSubmit: false, truncated: false });
    expect(await entriesOf(t.id)).toHaveLength(0);
    expect((await caught(act('accounting.recurring_schedule', {}, SALES))).code).toBe('PERMISSION_DENIED');
    await setPeriodClosed('2026-08', false);
    await deactivateAll();
  });
});
