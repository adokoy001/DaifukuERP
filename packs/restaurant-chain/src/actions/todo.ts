// restaurant_chain.todo inbox provider (docs/specs/inbox.md AC-1/AC-2), only callable when the pack is applied:
// unsubmitted reports for planned trading days of the last seven days (through yesterday, from the same board rows as
// the operations screen), returned reports, and reports awaiting store review or headquarters posting. Every read is
// the caller's Repository read, so the store boundary of chain staff and managers applies unchanged.
import {
  can,
  canRunAction,
  defineAction,
  label,
  repo,
  todoInput,
  todoItems,
  todoResult,
  type Context,
  type TodoCandidate,
} from '@daifuku/kernel';
import { RestaurantClosing } from '../entities/closing.ts';
import { boardRows } from '../services/operations-board.ts';
import { operationsData } from '../services/operations-data.ts';
import { dayCount, resolveRange, shiftDay, today } from '../services/operation-dates.ts';
import { reviewClosingAction } from './review.ts';

/** Days of unsubmitted reports the inbox looks back over, ending yesterday (today's report is still in progress). */
export const MISSING_WINDOW_DAYS = 7;
/** Longest board range a link opens, so the operations screen stays within its store-day limit. */
const LINK_DAYS = 31;
const WAITING = {
  returned: { key: 'returned_reports', label: label('差し戻された日次報告', 'Returned daily reports') },
  submitted: { key: 'review_reports', label: label('店長確認待ちの日次報告', 'Daily reports awaiting store review') },
  approved: {
    key: 'finalize_reports',
    label: label('本部確定待ちの日次報告', 'Daily reports awaiting headquarters posting'),
  },
} as const;

function boardHref(from: string, to: string): string {
  return `/operations?${new URLSearchParams({ from, to }).toString()}`;
}

async function missing(ctx: Context): Promise<TodoCandidate> {
  const current = today(ctx);
  const from = shiftDay(current, -MISSING_WINDOW_DAYS);
  const to = shiftDay(current, -1);
  const input = { from, to, asOf: current };
  const range = resolveRange(ctx, input);
  const rows = boardRows(await operationsData(ctx, input, range), range);
  return {
    key: 'missing_reports',
    label: label('未提出の日次報告（直近7日の営業予定日）', 'Missing daily reports (planned days, last 7 days)'),
    count: rows.filter((row) => row.counts.missingDays === 1 && row.status !== 'returned').length,
    href: boardHref(from, to),
    severity: 'warn',
  };
}

async function waiting(
  ctx: Context,
  reviewStatus: 'returned' | 'submitted' | 'approved',
): Promise<TodoCandidate | null> {
  const allowed =
    reviewStatus === 'returned'
      ? can(ctx, RestaurantClosing, 'update')
      : reviewStatus === 'submitted'
        ? canRunAction(ctx, reviewClosingAction)
        : can(ctx, RestaurantClosing, 'submit');
  if (!allowed) return null;
  const page = await repo(ctx, RestaurantClosing).list({
    where: { docstatus: 0, reviewStatus },
    orderBy: [
      { field: 'date', dir: 'asc' },
      { field: 'id', dir: 'asc' },
    ],
    limit: 1,
  });
  const current = today(ctx);
  const oldest = page.items[0]?.date ?? current;
  const from = oldest > current ? current : oldest;
  const to = dayCount(from, current) > LINK_DAYS ? shiftDay(from, LINK_DAYS - 1) : current;
  return {
    ...WAITING[reviewStatus],
    count: page.total,
    href: boardHref(from, to),
    severity: reviewStatus === 'returned' ? 'warn' : 'info',
  };
}

export const todoAction = defineAction({
  name: 'restaurant_chain.todo',
  description: label(
    '受信箱: 未提出・差戻し・確認待ち・確定待ちの日次報告の件数',
    'Inbox: missing, returned and pending daily store reports',
  ),
  input: todoInput,
  output: todoResult,
  permission: { roles: ['chain_staff', 'chain_manager', 'sales'] },
  storeAccess: true,
  tx: 'none',
  mutates: false,
  handler: async (ctx) =>
    todoItems([
      await missing(ctx),
      await waiting(ctx, 'returned'),
      await waiting(ctx, 'submitted'),
      await waiting(ctx, 'approved'),
    ]),
});
