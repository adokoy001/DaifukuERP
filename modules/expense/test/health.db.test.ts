// Postgres tests of the expense.accounts setting and setup health check (docs/specs/expense-settlement.md AC-19):
// warn with the settings tab of the missing code, ok when every account exists, and the setting's presentation.
import { healthChecks, registry, repo, runHealthChecks, setSetting } from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { PURCHASE_ACCOUNTS_KEY, purchaseAccountsSchema } from '@daifuku/mod-purchase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPENSE_ACCOUNTS_KEY, expenseAccountsSchema, resolveExpenseAccounts } from '../src/index.ts';
import { caught, fixture, type Fixture } from './fixture.ts';

let f: Fixture;
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.db.close();
});

const check = () =>
  f.run({}, async (ctx) => (await runHealthChecks(ctx)).items.find((c) => c.id === 'expense.accounts'));
const setExpense = (codes: Partial<Record<'advance' | 'payable' | 'defaultExpense', string>>) =>
  f.run({}, (ctx) =>
    setSetting(ctx, EXPENSE_ACCOUNTS_KEY, expenseAccountsSchema, {
      advance: '1800',
      payable: '2150',
      defaultExpense: '6900',
      ...codes,
    }),
  );

describe('expense.accounts (AC-19)', () => {
  it('AC-19 the setting is shown under accounting with account-code inputs and the JP defaults', () => {
    const def = registry.allSettings().find((d) => d.key === EXPENSE_ACCOUNTS_KEY);
    expect(def).toMatchObject({
      category: 'accounting',
      default: { advance: '1800', payable: '2150', defaultExpense: '6900' },
    });
    expect(Object.values(def?.fields ?? {}).map((field) => field.widget)).toEqual([
      'account-code',
      'account-code',
      'account-code',
    ]);
  });
  it('AC-19 ok when the three codes and the input-tax code exist', async () => {
    expect(await check()).toMatchObject({ status: 'ok', href: '/settings?tab=accounting' });
    const ids = healthChecks().map((c) => c.id);
    expect(ids.indexOf('expense.accounts')).toBeGreaterThan(ids.indexOf('accounting.fiscal_period'));
  });
  it('AC-19 a missing expense.accounts code warns with the accounting settings tab; resolve names it', async () => {
    await setExpense({ payable: '2999' });
    try {
      expect(await check()).toMatchObject({ status: 'warn', href: '/settings?tab=accounting' });
      expect(await caught(f.run({}, (ctx) => resolveExpenseAccounts(ctx)))).toMatchObject({
        code: 'INVALID_STATE',
        details: { missing: [{ setting: EXPENSE_ACCOUNTS_KEY, role: 'payable', code: '2999' }] },
      });
    } finally {
      await setExpense({});
    }
  });
  it('AC-19 only the input-tax account missing warns with the purchase settings tab', async () => {
    await f.run({}, (ctx) =>
      setSetting(ctx, PURCHASE_ACCOUNTS_KEY, purchaseAccountsSchema, {
        purchases: '5000',
        payable: '2100',
        taxReceivable: '1599',
      }),
    );
    try {
      const c = await check();
      expect(c).toMatchObject({ status: 'warn', href: '/settings?tab=purchase' });
      expect(c?.detail.ja).toContain('1599');
    } finally {
      await f.run({}, (ctx) =>
        setSetting(ctx, PURCHASE_ACCOUNTS_KEY, purchaseAccountsSchema, {
          purchases: '5000',
          payable: '2100',
          taxReceivable: '1500',
        }),
      );
    }
    expect(await f.run({}, (ctx) => repo(ctx, Account).count({ code: '1500' }))).toBe(1);
  });
});
