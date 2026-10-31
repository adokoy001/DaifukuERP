// docs/specs/recurring-journals.md AC-22: accounting.todo counts active recurring journals whose next run date is on or
// before today (JST) for callers who can run accounting.generate_recurring. Test DB: TEST_DATABASE_URL*.
import {
  appMeta,
  companies,
  DaifukuError,
  newId,
  registerCrudActions,
  repo,
  runAction,
  todoResult,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import '@daifuku/mod-partner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Account, RecurringJournal } from '../src/index.ts';

const FIXED_NOW = new Date('2026-10-15T03:00:00Z');
const ACCOUNTING = { roles: ['accounting'], actor: { type: 'user' as const, id: newId() } };

let db: TestDb;
let companyB = '';
let lines: Record<string, unknown>[] = [];

const run = <T>(fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = ACCOUNTING): Promise<T> =>
  db.run({ now: () => FIXED_NOW, ...params }, fn);
const todo = async (params: Partial<ContextParams> = ACCOUNTING) =>
  todoResult.parse(await run((ctx) => runAction(ctx, 'accounting.todo', {}), params));
const template = (input: Record<string, unknown>, params: Partial<ContextParams> = ACCOUNTING) =>
  run(
    (ctx) => runAction(ctx, 'recurring_journal.create', { ...input, lines: { recurring_journal_line: lines } }),
    params,
  );

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  const accounts = await run(async (ctx) => [
    await repo(ctx, Account).create({ code: '6100', name: '地代家賃', type: 'expense' }),
    await repo(ctx, Account).create({ code: '2200', name: '未払費用', type: 'liability' }),
  ]);
  lines = [
    { accountId: accounts[0]?.id, debit: '1000', credit: '0' },
    { accountId: accounts[1]?.id, debit: '0', credit: '1000' },
  ];
  companyB = newId();
  await db.owner.drizzle.insert(companies).values({ id: companyB, tenantId: db.tenantId, code: 'B', name: 'B' });
});
afterAll(async () => {
  await db.close();
});

describe('accounting.todo (AC-22)', () => {
  it('AC-22 counts active templates due today or earlier; zero is omitted; inactive and future ones are not counted', async () => {
    expect(await todo()).toEqual({ items: [] });
    await template({ name: '期日到来', startDate: '2026-10-01', dayOfMonth: 15 });
    await template({ name: '過去', startDate: '2026-09-01', dayOfMonth: 1 });
    await template({ name: '未来', startDate: '2026-10-16' });
    await template({ name: '無効', startDate: '2026-09-01', isActive: false });
    expect(await todo()).toEqual({
      items: [
        {
          key: 'recurring_due',
          label: { ja: '生成待ちの定期仕訳', en: 'Recurring journals due' },
          count: 2,
          href: '/finance/recurring',
          severity: 'info',
        },
      ],
    });
    expect(await run((ctx) => repo(ctx, RecurringJournal).count())).toBe(4);
  });

  it('AC-22 another company is not counted; admin sees the item; viewer and sales are not the audience', async () => {
    const inB = { ...ACCOUNTING, companyId: companyB };
    const bAccounts = await run(
      async (ctx) => [
        await repo(ctx, Account).create({ code: '6100', name: '家賃B', type: 'expense' }),
        await repo(ctx, Account).create({ code: '2200', name: '未払B', type: 'liability' }),
      ],
      inB,
    );
    await run(
      (ctx) =>
        runAction(ctx, 'recurring_journal.create', {
          name: 'B社',
          startDate: '2026-09-01',
          lines: {
            recurring_journal_line: [
              { accountId: bAccounts[0]?.id, debit: '5', credit: '0' },
              { accountId: bAccounts[1]?.id, debit: '0', credit: '5' },
            ],
          },
        }),
      inB,
    );
    expect((await todo()).items[0]?.count).toBe(2);
    expect((await todo(inB)).items[0]?.count).toBe(1);
    expect((await todo({ roles: ['admin'], actor: { type: 'user', id: newId() } })).items[0]?.count).toBe(2);
    for (const roles of [['viewer'], ['sales']]) {
      const params = { roles, actor: { type: 'user' as const, id: newId() } };
      const err = await run((ctx) => runAction(ctx, 'accounting.todo', {}), params).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DaifukuError);
      expect((err as DaifukuError).code).toBe('PERMISSION_DENIED');
      const listed = await run(async (ctx) => appMeta(ctx).actions.map((a) => a.name), params);
      expect(listed).not.toContain('accounting.todo');
    }
  });
});
