// payment.todo inbox provider (docs/specs/inbox.md AC-1/AC-2): overdue open invoices and submitted payments with an
// unallocated amount, counted with Repository.count in the caller's context (company scope and the payment direction
// rowRules apply). Invoice counts need read on that invoice entity; unallocated payments are listed only for roles that
// can cancel and amend a payment, the only way to allocate a submitted one. Viewers are not providers' audience.
import {
  can,
  defineAction,
  DOCSTATUS,
  label,
  repo,
  todayLocal,
  todoInput,
  todoItems,
  todoResult,
  type Context,
  type TodoCandidate,
} from '@daifuku/kernel';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import { SalesInvoice } from '@daifuku/mod-sales';
import { Payment } from '../entities/payment.ts';
import { outstandingAction } from './outstanding.ts';

async function overdue(
  ctx: Context,
  entity: typeof SalesInvoice | typeof PurchaseInvoice,
): Promise<TodoCandidate | null> {
  if (!can(ctx, entity, 'read')) return null;
  const where = { docstatus: DOCSTATUS.submitted, status: 'open', dueDate: { $lt: todayLocal(ctx.now()) } };
  const count =
    entity === SalesInvoice
      ? await repo(ctx, SalesInvoice).count(where)
      : await repo(ctx, PurchaseInvoice).count(where);
  const sales = entity === SalesInvoice;
  return {
    key: sales ? 'overdue_sales_invoices' : 'overdue_purchase_invoices',
    label: sales
      ? label('支払期日を過ぎた未入金の売上請求', 'Overdue unpaid sales invoices')
      : label('支払期日を過ぎた未払の仕入請求', 'Overdue unpaid purchase invoices'),
    count,
    href: `/r/${outstandingAction.name}`,
    severity: 'warn',
  };
}

async function unallocated(ctx: Context): Promise<TodoCandidate | null> {
  if (!can(ctx, Payment, 'cancel') || !can(ctx, Payment, 'amend')) return null;
  return {
    key: 'unallocated_payments',
    label: label('請求に配分していない入出金（前受・前払）', 'Payments with an unallocated amount'),
    count: await repo(ctx, Payment).count({ docstatus: DOCSTATUS.submitted, unallocatedAmount: { $gt: '0' } }),
    href: `/e/${Payment.name}?sort=unallocatedAmount:desc`,
    severity: 'info',
  };
}

export const todoAction = defineAction({
  name: 'payment.todo',
  description: label(
    '受信箱: 期日を過ぎた未消込の請求と、未配分の入出金の件数',
    'Inbox: overdue open invoices and payments with an unallocated amount',
  ),
  input: todoInput,
  output: todoResult,
  permission: { roles: ['accounting', 'sales', 'purchasing'] },
  tx: 'none',
  mutates: false,
  handler: async (ctx) =>
    todoItems([await overdue(ctx, SalesInvoice), await overdue(ctx, PurchaseInvoice), await unallocated(ctx)]),
});
