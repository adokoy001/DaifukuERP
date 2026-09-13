import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { newId, registerCrudActions, repo, runAction, type Context } from '@daifuku/kernel';
import { Account, FiscalPeriod, JournalEntry, openFiscalYear } from '@daifuku/mod-accounting';
import { GroupRun, type CompanySource, type GroupBoard, type GroupMapping } from '../src/index.ts';
let db: TestDb;
let second: string;
let userId: string;
const run = <T>(fn: (ctx: Context) => Promise<T>, companyId?: string) =>
  db.run({ ...(companyId ? { companyId } : {}), now: () => new Date('2026-09-12T03:00:00Z') }, fn);
type Result = { id: string; version: number; status: string };
const act = (name: string, input: unknown) => run((ctx) => runAction(ctx, 'group_accounting.' + name, input));
const sources = () =>
  act('sources', { companyIds: [db.companyId, second], from: '2026-08-01', to: '2026-08-31' }) as Promise<{
    sources: CompanySource[];
  }>;
const mapping = (values: CompanySource[]): GroupMapping[] =>
  values.flatMap((s) =>
    s.rows.map((a) => ({
      companyId: s.companyId,
      accountId: a.accountId,
      groupCode: a.code,
      groupName: a.name,
      groupType: a.type as GroupMapping['groupType'],
    })),
  );
async function prepare() {
  const current = await sources();
  return act('prepare', {
    expectedVersion: 0,
    name: '8月連結',
    companyIds: [db.companyId, second],
    from: '2026-08-01',
    to: '2026-08-31',
    mapping: mapping(current.sources),
    adjustments: [
      {
        key: 'IC-1',
        kind: 'elimination',
        description: '内部取引100の消去・根拠合意済',
        lines: [
          { groupCode: 'REVENUE', debit: '100', credit: '0' },
          { groupCode: 'CASH', debit: '0', credit: '100' },
        ],
      },
    ],
    reviewBasis: '両社決算資料照合済。支配関係・連結範囲は会計担当が別途判断。',
  }) as Promise<Result>;
}
async function closeAll(companyId: string) {
  await run(async (ctx) => {
    const periods = await repo(ctx, FiscalPeriod).list({ where: { endDate: { $lte: '2026-08-31' }, isClosed: false } });
    for (const period of periods.items) await runAction(ctx, 'accounting.close_period', { periodId: period.id });
  }, companyId);
}
beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  second = newId();
  userId = newId();
  await db.owner.sql`insert into companies(id,tenant_id,code,name) values(${second},${db.tenantId},'SECOND','子会社')`;
  await db.owner
    .sql`insert into users(id,tenant_id,name,email) values(${userId},${db.tenantId},'Reviewer','group-reviewer@example.invalid')`;
  await db.owner
    .sql`insert into user_company_memberships(tenant_id,user_id,company_id,roles) values(${db.tenantId},${userId},${db.companyId},'["accounting"]'),(${db.tenantId},${userId},${second},'["accounting"]')`;
  for (const companyId of [db.companyId, second])
    await run(async (ctx) => {
      await openFiscalYear(ctx, { startDate: '2026-01-01' });
      const cash = await repo(ctx, Account).create({ code: 'CASH', name: '現金', type: 'asset' });
      const revenue = await repo(ctx, Account).create({ code: 'REVENUE', name: '売上', type: 'revenue' });
      const entry = (await runAction(ctx, 'journal_entry.create', {
        date: '2026-08-10',
        description: '単体確定仕訳',
        lines: {
          journal_line: [
            { accountId: cash.id, debit: '1000' },
            { accountId: revenue.id, credit: '1000' },
          ],
        },
      })) as { id: string };
      await runAction(ctx, 'journal_entry.submit', { id: entry.id });
    }, companyId);
});
afterAll(async () => {
  await db.close();
});
describe('authorized group worksheet', () => {
  it('maps full standalone balances and balanced eliminations without changing either ledger', async () => {
    const before = await Promise.all(
      [db.companyId, second].map((id) => run(async (ctx) => (await repo(ctx, JournalEntry).list()).total, id)),
    );
    const made = await prepare();
    const board = (await act('board', { runId: made.id })) as GroupBoard;
    expect(board.result).toMatchObject({ debit: '1900', credit: '1900', balanced: true });
    expect(board.result.rows.find((r) => r.code === 'REVENUE')).toMatchObject({
      standalone: '-2000',
      elimination: '100',
      consolidated: '-1900',
    });
    expect(
      await Promise.all(
        [db.companyId, second].map((id) => run(async (ctx) => (await repo(ctx, JournalEntry).list()).total, id)),
      ),
    ).toEqual(before);
    const generic = (await run((ctx) => runAction(ctx, 'group_accounting_run.get', { id: made.id }))) as Record<
      string,
      unknown
    >;
    for (const key of ['sources', 'mapping', 'adjustments', 'result', 'reviewBasis'])
      expect(generic).not.toHaveProperty(key);
    await expect(act('confirm', { runId: made.id, expectedVersion: made.version, reason: '確認' })).rejects.toThrow(
      'closed',
    );
  });
  it('requires refreshed closed snapshots, confirms once under contention, and cancels with history', async () => {
    const stale = await prepare();
    await closeAll(db.companyId);
    await closeAll(second);
    await expect(
      act('confirm', { runId: stale.id, expectedVersion: stale.version, reason: '確認' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const made = await prepare();
    const attempts = await Promise.allSettled([
      act('confirm', { runId: made.id, expectedVersion: made.version, reason: '担当者照合済' }),
      act('confirm', { runId: made.id, expectedVersion: made.version, reason: '二重確認' }),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const confirmed = (attempts.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Result>).value;
    expect(confirmed.status).toBe('confirmed');
    expect(
      await act('cancel', { runId: made.id, expectedVersion: confirmed.version, reason: '連結消去修正のため改訂' }),
    ).toMatchObject({ status: 'cancelled' });
    expect(((await act('board', { runId: made.id })) as GroupBoard).result.debit).toBe('1900');
  });
  it('rechecks live memberships on saved snapshots and denies scoped users despite a copied role', async () => {
    const made = await prepare();
    const asUser = { actor: { type: 'user' as const, id: userId }, roles: ['accounting'], sessionVersion: 1 };
    await db.run(asUser, (ctx) => runAction(ctx, 'group_accounting.board', { runId: made.id }));
    await db.owner.sql`delete from user_company_memberships where user_id=${userId} and company_id=${second}`;
    await expect(
      db.run(asUser, (ctx) => runAction(ctx, 'group_accounting.board', { runId: made.id })),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      db.run({ accessScope: 'stores', storeIds: [newId()] }, (ctx) =>
        runAction(ctx, 'group_accounting.sources', {
          companyIds: [db.companyId],
          from: '2026-08-01',
          to: '2026-08-31',
        }),
      ),
    ).rejects.toThrow();
  });
  it('does not accept partial periods, incomplete mappings, or unbalanced adjustments', async () => {
    await expect(act('sources', { companyIds: [db.companyId], from: '2026-08-02', to: '2026-08-31' })).rejects.toThrow(
      'complete fiscal',
    );
    const s = await sources();
    await expect(
      act('prepare', {
        expectedVersion: 0,
        name: '不完全',
        companyIds: [db.companyId, second],
        from: '2026-08-01',
        to: '2026-08-31',
        mapping: mapping(s.sources).slice(1),
        adjustments: [],
        reviewBasis: '不完全資料',
      }),
    ).rejects.toThrow('Source account is not mapped');
    await expect(run((ctx) => repo(ctx, GroupRun).update(newId(), { status: 'confirmed' }))).rejects.toThrow();
  });
});
