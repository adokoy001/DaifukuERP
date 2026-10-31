// workforce.todo inbox provider (docs/specs/inbox.md AC-1/AC-2): counts the caller's pending workforce work through
// Repository.list in the caller's context, so site and self row boundaries apply unchanged. Review and settlement
// counts follow the review/settle/confirm action permissions and leave out the caller's own records (self-approval is
// refused by those actions). Each href opens the management screen on the month of the oldest pending record.
import {
  canRunAction,
  defineAction,
  isUuid,
  label,
  repo,
  todoInput,
  todoItems,
  todoResult,
  type ActionDef,
  type Context,
  type Domain,
  type EntityDef,
  type Label,
  type TodoCandidate,
} from '@daifuku/kernel';
import { E, H, M, P } from '../entities/common.ts';
import {
  WorkforceAttendance,
  WorkforceAttendanceCorrection,
  WorkforceExpense,
  WorkforceLeaveRequest,
  WorkforcePayroll,
} from '../entities/index.ts';
import { userId } from '../common.ts';
import { reviewAttendanceAction } from './attendance.ts';
import { reviewCorrectionAction } from './corrections.ts';
import { reviewExpenseAction, settleExpenseAction } from './expenses.ts';
import { reviewLeaveAction } from './leave.ts';
import { confirmPayrollAction } from './payroll.ts';

interface Queue {
  key: string;
  label: Label;
  action: ActionDef;
  entity: EntityDef;
  where: Domain;
  /** Field whose oldest value picks the month the link opens (YYYY-MM-DD or YYYY-MM). */
  dateField: string;
  tab?: 'payroll';
  severity: TodoCandidate['severity'];
}

const QUEUES: readonly Queue[] = [
  {
    key: 'attendance_review',
    label: label('確認待ちの勤怠', 'Attendance awaiting review'),
    action: reviewAttendanceAction,
    entity: WorkforceAttendance,
    where: { status: 'submitted' },
    dateField: 'workDate',
    severity: 'info',
  },
  {
    key: 'correction_review',
    label: label('承認待ちの勤怠訂正', 'Attendance corrections awaiting approval'),
    action: reviewCorrectionAction,
    entity: WorkforceAttendanceCorrection,
    where: { status: 'pending' },
    dateField: 'workDate',
    severity: 'info',
  },
  {
    key: 'leave_review',
    label: label('承認待ちの有給申請', 'Paid leave requests awaiting approval'),
    action: reviewLeaveAction,
    entity: WorkforceLeaveRequest,
    where: { status: 'pending' },
    dateField: 'leaveDate',
    severity: 'info',
  },
  {
    key: 'expense_review',
    label: label('承認待ちの経費', 'Expenses awaiting approval'),
    action: reviewExpenseAction,
    entity: WorkforceExpense,
    where: { status: 'submitted' },
    dateField: 'expenseDate',
    severity: 'info',
  },
  {
    key: 'expense_settlement',
    label: label('精算待ちの経費', 'Approved expenses awaiting settlement'),
    action: settleExpenseAction,
    entity: WorkforceExpense,
    where: { status: 'approved' },
    dateField: 'expenseDate',
    severity: 'info',
  },
  {
    key: 'payroll_confirmation',
    label: label('確認待ちの給与（下書き）', 'Draft payroll awaiting confirmation'),
    action: confirmPayrollAction,
    entity: WorkforcePayroll,
    where: { docstatus: 0 },
    dateField: 'period',
    tab: 'payroll',
    severity: 'warn',
  },
];

/** Oldest first, one row: the total counts every match and the row picks the month a link opens. */
async function oldest(
  ctx: Context,
  entity: EntityDef,
  where: Domain,
  dateField: string,
): Promise<{ total: number; month: string | undefined }> {
  const page = await repo(ctx, entity).list({
    where,
    orderBy: [
      { field: dateField, dir: 'asc' },
      { field: 'id', dir: 'asc' },
    ],
    limit: 1,
  });
  const row = page.items[0] as Record<string, unknown> | undefined;
  const date = typeof row?.[dateField] === 'string' ? (row[dateField] as string) : undefined;
  return { total: page.total, month: date?.slice(0, 7) };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function href(month: string | undefined, tab?: 'payroll'): string {
  const search = new URLSearchParams();
  if (tab) search.set('tab', tab);
  if (month && MONTH.test(month)) search.set('period', month);
  const query = search.toString();
  return query ? `/workforce?${query}` : '/workforce';
}

async function queue(ctx: Context, item: Queue, self: string | undefined): Promise<TodoCandidate | null> {
  if (!canRunAction(ctx, item.action)) return null;
  const where: Domain = { ...item.where, ...(self ? { userId: { $ne: self } } : {}) };
  const found = await oldest(ctx, item.entity, where, item.dateField);
  return {
    key: item.key,
    label: item.label,
    count: found.total,
    href: href(found.month, item.tab),
    severity: item.severity,
  };
}

/**
 * The caller's own returned attendance and expenses, which only the caller can correct and resubmit. The link opens
 * the employee portal (/me) on the tab and month of the oldest returned record, because the portal shows one month.
 */
async function returned(ctx: Context, self: string | undefined): Promise<TodoCandidate | null> {
  if (!self) return null;
  const mine = { userId: self, status: 'returned' };
  const attendance = await oldest(ctx, WorkforceAttendance, mine, 'workDate');
  const expenses = await oldest(ctx, WorkforceExpense, mine, 'expenseDate');
  const first = [
    { tab: 'attendance', month: attendance.month },
    { tab: 'expenses', month: expenses.month },
  ]
    .filter((item): item is { tab: string; month: string } => !!item.month && MONTH.test(item.month))
    .sort((a, b) => a.month.localeCompare(b.month))[0];
  return {
    key: 'my_returned',
    label: label('差し戻された自分の勤怠・経費', 'My returned attendance and expenses'),
    count: attendance.total + expenses.total,
    href: first ? `/me?${new URLSearchParams({ tab: first.tab, period: first.month }).toString()}` : '/me',
    severity: 'warn',
  };
}

export const todoAction = defineAction({
  name: 'workforce.todo',
  description: label(
    '受信箱: 承認・確認・精算を待つ勤怠・申請・経費・給与と、差し戻された自分の記録の件数',
    'Inbox: workforce reviews, settlements and payroll awaiting the caller, and the caller’s returned records',
  ),
  input: todoInput,
  output: todoResult,
  permission: { roles: [E, M, H, P] },
  siteAccess: true,
  tx: 'none',
  mutates: false,
  async handler(ctx) {
    const id = userId(ctx);
    const self = isUuid(id) ? id : undefined;
    const counted: (TodoCandidate | null)[] = [];
    for (const item of QUEUES) counted.push(await queue(ctx, item, self));
    counted.push(await returned(ctx, self));
    return todoItems(counted);
  },
});
