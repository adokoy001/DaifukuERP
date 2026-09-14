// Release-finishing AC-3: count actual SQL while preserving scoped reads, individual writes and atomic posting.
import {
  Decimal,
  DOCSTATUS,
  NotFound,
  auditTrail,
  cancelDocument,
  newId,
  registry,
  repo,
  runAction,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Account, JournalEntry, JournalLine, postFromSource, reverseSourceEntry } from '../src/index.ts';

const NOW = new Date('2026-09-14T00:00:00Z');
let db: TestDb;
let cash: string;
let revenue: string;
let partnerAccount: string;
let stampFailureAfter = 0;
let stamped = 0;
let changeClassificationBeforeStamp = false;
const run = <T>(fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = {}) =>
  db.run({ now: () => NOW, ...params }, fn);
const input = (count: number, debitAccount = cash) => ({
  sourceEntity: 'posting_batch_test',
  sourceId: newId(),
  date: '2026-09-14',
  lines: Array.from({ length: count }, (_, index) => ({
    accountId: index % 2 === 0 ? debitAccount : revenue,
    debit: index % 2 === 0 ? '100' : '0',
    credit: index % 2 === 0 ? '0' : '100',
    memo: `Line ${index + 1}`,
  })),
});

beforeAll(async () => {
  db = await freshDb();
  await run((ctx) => runAction(ctx, 'accounting.open_fiscal_year', { startDate: '2026-01-01' }));
  cash = (await run((ctx) => repo(ctx, Account).create({ code: 'CASH', name: 'Cash', type: 'asset' }))).id;
  revenue = (await run((ctx) => repo(ctx, Account).create({ code: 'SALES', name: 'Sales', type: 'revenue' }))).id;
  partnerAccount = (
    await run((ctx) =>
      repo(ctx, Account).create({
        code: 'AR',
        name: 'Receivable',
        type: 'asset',
        partnerRequired: true,
      }),
    )
  ).id;
  registry.registerHook(JournalEntry.name, 'before_submit', async (ctx) => {
    if (changeClassificationBeforeStamp) await repo(ctx, Account).update(cash, { type: 'expense' });
  });
  registry.registerHook(JournalLine.name, 'after_update', (_ctx, { row }) => {
    if (stampFailureAfter && row.posted === true && ++stamped === stampFailureAfter)
      throw new Error('Synthetic stamp failure');
  });
});
afterAll(async () => {
  await db.close();
});

async function counts() {
  const [row] = await db.owner.sql`select
    (select count(*)::int from journal_entry) as entries,
    (select count(*)::int from journal_line) as lines,
    (select count(*)::int from audit_log) as audits,
    (select count(*)::int from outbox) as events,
    (select coalesce(sum(next_value),0)::text from sequences) as numbering`;
  return row;
}

it('AC-3 keeps account classification reads constant for two and twenty repeated-account lines', async () => {
  const measured = [];
  for (const lineCount of [2, 20]) {
    const statements: string[] = [];
    const previous = db.app.sql.options.debug;
    db.app.sql.options.debug = (_connection, query) => statements.push(query);
    try {
      const posted = await run((ctx) => postFromSource(ctx, input(lineCount)));
      expect(posted.lines).toHaveLength(lineCount);
      expect(posted.lines.every((line) => line.posted && line.entryDate === '2026-09-14')).toBe(true);
    } finally {
      db.app.sql.options.debug = previous;
    }
    const reads = statements.filter((query) => /^select\b/i.test(query));
    const accountReads = reads.filter((query) => /from "account"\s/i.test(query));
    const fullAccountReads = accountReads.filter((query) => query.includes('"type"'));
    const accountCounts = accountReads.filter((query) => /count\(/i.test(query));
    measured.push({
      lines: lineCount,
      statements: statements.length,
      reads: reads.length,
      writes: statements.filter((query) => /^(insert|update|delete)\b/i.test(query)).length,
      accountReads: accountReads.length,
      accountClassificationReads: fullAccountReads.length,
      accountCountReads: accountCounts.length,
    });
  }
  console.info('Posting query measurements:', JSON.stringify(measured));
  for (const result of measured) {
    expect(result.accountClassificationReads).toBe(2);
    expect(result.accountCountReads).toBe(2);
    // FK visibility/locks and individual line writes remain deliberate work, independent of classification reads.
    expect(result.accountReads).toBeGreaterThan(result.accountClassificationReads + result.accountCountReads);
    expect(result.writes).toBeGreaterThan(result.lines);
  }
});

it('AC-3 rejects an account hidden by the caller read rule without posting or leaking partial side effects', async () => {
  const before = await counts();
  const permissions = Account.config.permissions;
  const previous = permissions.rowRules;
  permissions.rowRules = [{ roles: ['accounting'], where: { id: { $ne: cash } } }];
  try {
    await expect(run((ctx) => postFromSource(ctx, input(4)), { roles: ['accounting'] })).rejects.toBeInstanceOf(
      NotFound,
    );
  } finally {
    if (previous === undefined) delete permissions.rowRules;
    else permissions.rowRules = previous;
  }
  expect(await counts()).toEqual(before);
});

it.each(['missing', 'other company', 'other tenant'])(
  'AC-3 rejects %s account references and rolls the whole source posting back',
  async (kind) => {
    let accountId = newId();
    if (kind !== 'missing') {
      const tenantId = kind === 'other tenant' ? newId() : db.tenantId;
      const companyId = newId();
      if (kind === 'other tenant')
        await db.owner.sql`insert into tenants(id,name) values(${tenantId},'Foreign synthetic tenant')`;
      await db.owner
        .sql`insert into companies(id,tenant_id,code,name) values(${companyId},${tenantId},'FOREIGN','Foreign synthetic company')`;
      accountId = (
        await run((ctx) => repo(ctx, Account).create({ code: 'FOREIGN', name: 'Foreign account', type: 'asset' }), {
          tenantId,
          companyId,
        })
      ).id;
    }
    const before = await counts();
    await expect(run((ctx) => postFromSource(ctx, input(4, accountId)))).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await counts()).toEqual(before);
  },
);

it('AC-3 keeps partner-required validation and rolls back earlier stamps when a later line hook fails', async () => {
  const before = await counts();
  await expect(run((ctx) => postFromSource(ctx, input(4, partnerAccount)))).rejects.toMatchObject({
    code: 'VALIDATION',
  });
  expect(await counts()).toEqual(before);
  stamped = 0;
  stampFailureAfter = 3;
  try {
    await expect(run((ctx) => postFromSource(ctx, input(6)))).rejects.toThrow('Synthetic stamp failure');
  } finally {
    stampFailureAfter = 0;
  }
  expect(stamped).toBe(3);
  expect(await counts()).toEqual(before);
});

it('AC-3 keeps stamped classification, audit, cancellation protection and reversal amounts unchanged', async () => {
  const source = input(6);
  const original = await run((ctx) => postFromSource(ctx, source));
  expect(original.docstatus).toBe(DOCSTATUS.submitted);
  expect(original.totalDebit.toString()).toBe('300');
  expect(original.totalCredit.toString()).toBe('300');
  expect(original.lines.map((line) => [line.accountType, line.accountTaxRole])).toEqual([
    ['asset', 'none'],
    ['revenue', 'none'],
    ['asset', 'none'],
    ['revenue', 'none'],
    ['asset', 'none'],
    ['revenue', 'none'],
  ]);
  const audit = await run((ctx) => auditTrail(ctx, JournalEntry.name, original.id));
  expect(audit.some((row) => row.op === 'create')).toBe(true);
  expect(audit.some((row) => row.op === 'submit')).toBe(true);
  await expect(run((ctx) => cancelDocument(ctx, JournalEntry, original.id))).rejects.toMatchObject({
    code: 'INVALID_STATE',
  });
  await run((ctx) => repo(ctx, Account).update(cash, { type: 'expense', taxRole: 'input_tax' }));
  try {
    const reversal = await run((ctx) =>
      reverseSourceEntry(ctx, {
        id: original.id,
        sourceEntity: source.sourceEntity,
        sourceId: source.sourceId,
        date: source.date,
      }),
    );
    expect(reversal.lines.map((line) => [line.accountType, line.accountTaxRole])).toEqual(
      original.lines.map((line) => [line.accountType, line.accountTaxRole]),
    );
    const net = new Map<string, Decimal>();
    for (const line of [...original.lines, ...reversal.lines])
      net.set(line.accountId, (net.get(line.accountId) ?? Decimal.zero()).plus(line.debit).minus(line.credit));
    expect([...net.values()].every((value) => value.isZero())).toBe(true);
    const events = await db.owner
      .sql`select payload from outbox where topic='journal_entry.reversed' and payload->>'id'=${original.id}`;
    expect(events).toHaveLength(1);
  } finally {
    await run((ctx) => repo(ctx, Account).update(cash, { type: 'asset', taxRole: 'none' }));
  }
});

it('AC-3 reloads classification after later header hooks instead of caching the validation-phase account rows', async () => {
  changeClassificationBeforeStamp = true;
  try {
    const posted = await run((ctx) => postFromSource(ctx, input(4)));
    expect(posted.lines.filter((line) => line.accountId === cash).map((line) => line.accountType)).toEqual([
      'expense',
      'expense',
    ]);
  } finally {
    changeClassificationBeforeStamp = false;
    await run((ctx) => repo(ctx, Account).update(cash, { type: 'asset' }));
  }
});
