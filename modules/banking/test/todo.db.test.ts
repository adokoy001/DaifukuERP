// docs/specs/inbox.md AC-1..AC-3: banking.todo counts statements without an active reconciliation in the company-wide
// accounting context; site-limited and non-accounting callers are refused. Test DB: TEST_DATABASE_URL*.
import {
  appMeta,
  companies,
  newId,
  PermissionDenied,
  runAction,
  todoResult,
  type ContextParams,
} from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bankReconciliationView } from '../src/contract.ts';
import { bankingFixture, required, type BankFixture } from './fixture.ts';

let f: BankFixture;
beforeAll(async () => {
  f = await bankingFixture();
});
afterAll(async () => {
  await f?.db.close();
});
const todo = async (params: Partial<ContextParams> = f.accounting) =>
  todoResult.parse(await f.run((ctx) => runAction(ctx, 'banking.todo', {}), params));

describe('banking.todo (docs/specs/inbox.md)', () => {
  it('AC-1 AC-2: unmatched statement lines follow confirmation and undo; zero is omitted', async () => {
    expect(await todo()).toEqual({ items: [] });
    const imported = await f.importRows('todo-a,2026-09-05,receive,1200,入金A\ntodo-b,2026-09-06,pay,800,支払B');
    expect(await todo()).toEqual({
      items: [
        {
          key: 'unmatched_statements',
          label: { ja: '照合待ちの銀行明細', en: 'Bank statement lines awaiting reconciliation' },
          count: 2,
          href: '/finance/banking',
          severity: 'info',
        },
      ],
    });
    const invoice = await f.invoice('receive', '1200');
    const statement = required(imported.statements.find((row) => row.externalId === 'todo-a'));
    const matched = await f.action(
      'reconcile',
      {
        requestId: newId(),
        statementId: statement.id,
        targetKind: 'invoice',
        targetId: invoice.id,
        targetVersion: invoice.version,
        expectedBalance: '1200',
        reason: '入金を確認',
      },
      bankReconciliationView,
    );
    expect((await todo()).items[0]?.count).toBe(1);
    await f.action(
      'undo_reconciliation',
      {
        reconciliationId: matched.id,
        expectedVersion: matched.version,
        correctionDate: '2026-09-06',
        reason: '照合を取り消し',
      },
      bankReconciliationView,
    );
    expect((await todo()).items[0]?.count).toBe(2);
  });

  it('AC-1: another company of the tenant counts nothing of this company', async () => {
    const otherCompanyId = newId();
    await f.db.owner.drizzle
      .insert(companies)
      .values({ id: otherCompanyId, tenantId: f.db.tenantId, code: 'OTHER', name: '別会社' });
    expect(await todo({ ...f.accounting, companyId: otherCompanyId })).toEqual({ items: [] });
  });

  it('AC-3: site-limited accounting and other roles are refused and do not see the provider', async () => {
    const siteScoped = { ...f.accounting, accessScope: 'sites' as const, siteIds: [newId()] };
    const outsider = { roles: ['sales'], actor: { type: 'user' as const, id: newId() } };
    for (const params of [siteScoped, outsider]) {
      await expect(todo(params)).rejects.toBeInstanceOf(PermissionDenied);
      expect(await f.run(async (ctx) => appMeta(ctx).actions.map((a) => a.name), params)).not.toContain('banking.todo');
    }
    expect(await f.run(async (ctx) => appMeta(ctx).actions.map((a) => a.name), f.accounting)).toContain('banking.todo');
  });
});
