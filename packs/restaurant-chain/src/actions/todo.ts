// restaurant_chain.todo inbox provider (docs/specs/inbox.md AC-1/AC-2), only callable when the pack is applied:
// unsubmitted reports for planned trading days of the last seven days (through yesterday), returned reports, and
// reports awaiting store review or headquarters posting. Every read is the caller's Repository read (count, list or the
// grouped `aggregate` report port), so the store boundary of chain staff and managers applies unchanged. The missing
// count uses the operations board's rule (a planned open day without a submitted, approved or posted report) but reads
// only grouped store-days of those seven days, not the board's full rows and comparison period.
import {
  can,
  canRunAction,
  defineAction,
  label,
  MAX_REPORT_ROWS,
  repo,
  todoInput,
  todoItems,
  todoResult,
  type Context,
  type Domain,
  type EntityDef,
  type TodoCandidate,
} from '@daifuku/kernel';
import { RestaurantClosing } from '../entities/closing.ts';
import { RestaurantDayPlan } from '../entities/day-plan.ts';
import { dayCount, shiftDay, today } from '../services/operation-dates.ts';
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

export interface TodoLimits {
  /** Largest number of store-days the missing count reads (the operations board's own limit by default). */
  storeDays: number;
}
const LIMITS: TodoLimits = { storeDays: MAX_REPORT_ROWS };

/** `storeId/date` of every group an aggregate returned. */
async function storeDays(ctx: Context, entity: EntityDef, where: Domain): Promise<Set<string>> {
  const rows = await repo(ctx, entity).aggregate({
    where,
    groupBy: ['storeId', 'date'],
    metrics: { n: { count: true } },
  });
  return new Set(rows.map((row) => `${String(row.storeId)}/${String(row.date)}`));
}

/**
 * Planned open store-days of the window without a submitted, approved, returned or posted report (returned days are
 * counted by `returned_reports`). Null, so the other items still render, when the window holds more store-days than
 * the limit: the operations board refuses such a range too, and an inbox count must not fail the whole provider.
 */
async function missing(ctx: Context, limits: TodoLimits): Promise<TodoCandidate | null> {
  const current = today(ctx);
  const from = shiftDay(current, -MISSING_WINDOW_DAYS);
  const to = shiftDay(current, -1);
  const days: Domain = { $and: [{ date: { $gte: from } }, { date: { $lte: to } }] };
  const planned: Domain = { ...days, docstatus: 1, expectedOpen: true };
  const filed: Domain = {
    ...days,
    $or: [{ docstatus: 1 }, { docstatus: 0, reviewStatus: { $in: ['submitted', 'approved', 'returned'] } }],
  };
  if ((await repo(ctx, RestaurantDayPlan).count(planned)) > limits.storeDays) return null;
  if ((await repo(ctx, RestaurantClosing).count(filed)) > limits.storeDays) return null;
  const open = await storeDays(ctx, RestaurantDayPlan, planned);
  const reported = await storeDays(ctx, RestaurantClosing, filed);
  return {
    key: 'missing_reports',
    label: label('未提出の日次報告（直近7日の営業予定日）', 'Missing daily reports (planned days, last 7 days)'),
    count: [...open].filter((key) => !reported.has(key)).length,
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
  handler: (ctx) => restaurantTodo(ctx),
});

/** The provider's items; `limits` exists so tests can exercise the size guard without ten thousand store-days. */
export async function restaurantTodo(ctx: Context, limits: TodoLimits = LIMITS) {
  return todoItems([
    await missing(ctx, limits),
    await waiting(ctx, 'returned'),
    await waiting(ctx, 'submitted'),
    await waiting(ctx, 'approved'),
  ]);
}
