// expense.todo inbox provider (spec AC-18, docs/specs/inbox.md AC-1): draft settlements waiting for confirmation by
// someone other than their employee, and open advances, counted with Repository.count in the caller's Context. Only
// callers who can submit a settlement (accounting + workforce_payroll, or admin) get items: the others could not act.
// An API key is refused with `human-actor-required` before the role check, as `workforce.todo` refuses it
// (docs/specs/machine-credentials.md AC-22): the inbox is the work queue of a person.
import {
  defineAction,
  DOCSTATUS,
  isUuid,
  label,
  repo,
  todoInput,
  todoItems,
  todoResult,
  type Context,
} from '@daifuku/kernel';
import { actorUserId, canSettle } from '../access.ts';
import { ExpenseAdvance, ExpenseSettlement } from '../entities/index.ts';

async function todo(ctx: Context) {
  const me = actorUserId(ctx);
  if (!canSettle(ctx)) return { items: [] };
  const drafts = await repo(ctx, ExpenseSettlement).count({
    docstatus: DOCSTATUS.draft,
    ...(isUuid(me) ? { userId: { $ne: me } } : {}),
  });
  const open = await repo(ctx, ExpenseAdvance).count({ docstatus: DOCSTATUS.submitted, status: 'open' });
  return todoItems([
    {
      key: 'draft_settlements',
      label: label('確定待ちの経費精算書', 'Expense settlements awaiting confirmation'),
      count: drafts,
      href: `/e/${ExpenseSettlement.name}?status=draft`,
      severity: 'warn',
    },
    {
      key: 'open_advances',
      label: label('未精算の仮払', 'Open advances'),
      count: open,
      href: '/finance/expenses',
      severity: 'info',
    },
  ]);
}

export const todoAction = defineAction({
  name: 'expense.todo',
  description: label(
    '受信箱: 確定待ちの経費精算書と未精算の仮払の件数',
    'Inbox: expense settlements awaiting confirmation and open advances',
  ),
  input: todoInput,
  output: todoResult,
  permission: { entity: ExpenseSettlement.name, op: 'submit' },
  siteAccess: true,
  tx: 'none',
  mutates: false,
  handler: todo,
});
