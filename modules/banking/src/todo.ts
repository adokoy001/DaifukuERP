// banking.todo inbox provider (docs/specs/inbox.md AC-1/AC-2): statements without an active reconciliation, counted
// with Repository.count in the company-wide accounting context that every banking action requires. A statement has at
// most one active reconciliation (reconcile.ts refuses a second one under the banking lock).
import { label, repo, todoItems, type Context } from '@daifuku/kernel';
import { BankReconciliation, BankStatement } from './entities.ts';
import { assertBankContext } from './internal.ts';
export async function bankTodo(ctx: Context) {
  assertBankContext(ctx);
  const statements = await repo(ctx, BankStatement).count();
  const matched = await repo(ctx, BankReconciliation).count({ state: 'active' });
  return todoItems([
    {
      key: 'unmatched_statements',
      label: label('照合待ちの銀行明細', 'Bank statement lines awaiting reconciliation'),
      count: Math.max(0, statements - matched),
      href: '/finance/banking',
      severity: 'info',
    },
  ]);
}
