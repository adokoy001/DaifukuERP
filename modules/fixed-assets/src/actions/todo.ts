// fixed_assets.todo inbox provider (docs/specs/fixed-assets.md AC-31; docs/specs/inbox.md AC-1): depreciation not yet
// run for the last period that ended before today (same arithmetic as the preview), and draft disposals. Company-wide
// accounting contexts only; zero counts are dropped. Unusable rules are reported by the setup-health check instead.
import {
  can,
  defineAction,
  DOCSTATUS,
  getCompany,
  label,
  PermissionDenied,
  repo,
  todayLocal,
  todoInput,
  todoItems,
  todoResult,
  type Context,
  type TodoCandidate,
} from '@daifuku/kernel';
import { FixedAssetDisposal } from '../entities/disposal.ts';
import { FixedAsset } from '../entities/fixed-asset.ts';
import { checkRules, registeredRules, rulesConfirmation } from '../rules.ts';
import { lastEndedPeriod } from '../services/periods.ts';
import { loadCalendar, planForPeriod } from '../services/plan.ts';

function assertCompanyAccounting(ctx: Context): void {
  if (!ctx.companyId || (ctx.accessScope && ctx.accessScope !== 'all'))
    throw new PermissionDenied('fixed_assets.todo', 'company-wide', ctx.roles);
}

async function notRun(ctx: Context): Promise<TodoCandidate | null> {
  if (!can(ctx, FixedAsset, 'read')) return null;
  const found = checkRules(registeredRules(), await getCompany(ctx));
  if (!found.ok) return null;
  if (!(await rulesConfirmation(ctx, found.rules)).usable) return null;
  const calendar = await loadCalendar(ctx);
  const period = lastEndedPeriod(calendar.periods, todayLocal(ctx.now()));
  const year = period ? calendar.years.find((y) => y.id === period.fiscalYearId) : undefined;
  if (!period || !year || period.isClosed || year.isClosed) return null;
  const plan = await planForPeriod(ctx, found.rules, calendar, period, { withPriorYear: false });
  return {
    key: 'depreciation_not_run',
    label: label(`償却が未実行の資産（${period.code}）`, `Assets not yet depreciated for ${period.code}`),
    count: plan.lines.length,
    href: `/finance/depreciation?periodId=${period.id}`,
    severity: 'warn',
  };
}

async function drafts(ctx: Context): Promise<TodoCandidate | null> {
  if (!can(ctx, FixedAssetDisposal, 'read')) return null;
  return {
    key: 'disposal_drafts',
    label: label('下書きの除却・売却', 'Draft fixed asset disposals'),
    count: await repo(ctx, FixedAssetDisposal).count({ docstatus: DOCSTATUS.draft }),
    href: `/e/${FixedAssetDisposal.name}`,
    severity: 'info',
  };
}

export async function fixedAssetsTodo(ctx: Context) {
  assertCompanyAccounting(ctx);
  return todoItems([await notRun(ctx), await drafts(ctx)]);
}

export const todoAction = defineAction({
  name: 'fixed_assets.todo',
  description: label(
    '受信箱: 前月までの償却が未実行の資産と、下書きの除却・売却の件数',
    'Inbox: assets whose depreciation for the last ended period is not booked, and draft disposals',
  ),
  input: todoInput,
  output: todoResult,
  permission: { roles: ['accounting'] },
  tx: 'none',
  mutates: false,
  handler: fixedAssetsTodo,
});
