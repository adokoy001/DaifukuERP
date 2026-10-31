// accounting.todo inbox provider (docs/specs/recurring-journals.md AC-22, docs/specs/inbox.md): active recurring
// journals whose next run date has come (JST today), shown only to callers who can run accounting.generate_recurring.
// Counted with Repository.count in the caller's context (company scope applies).
import {
  canRunAction,
  defineAction,
  label,
  repo,
  todayLocal,
  todoInput,
  todoItems,
  todoResult,
  type Context,
  type TodoCandidate,
} from '@daifuku/kernel';
import { RecurringJournal } from '../entities/recurring-journal.ts';
import { generateRecurringAction } from './generate-recurring.ts';

async function recurringDue(ctx: Context): Promise<TodoCandidate | null> {
  if (!canRunAction(ctx, generateRecurringAction)) return null;
  return {
    key: 'recurring_due',
    label: label('生成待ちの定期仕訳', 'Recurring journals due'),
    count: await repo(ctx, RecurringJournal).count({ isActive: true, nextRunDate: { $lte: todayLocal(ctx.now()) } }),
    href: '/finance/recurring',
    severity: 'info',
  };
}

export const accountingTodoAction = defineAction({
  name: 'accounting.todo',
  description: label('受信箱: 生成待ちの定期仕訳の件数', 'Inbox: recurring journals due for generation'),
  input: todoInput,
  output: todoResult,
  permission: { roles: ['accounting'] },
  tx: 'none',
  mutates: false,
  handler: async (ctx) => todoItems([await recurringDue(ctx)]),
});
