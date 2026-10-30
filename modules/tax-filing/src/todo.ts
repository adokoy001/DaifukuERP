// tax_filing.todo inbox provider (docs/specs/inbox.md AC-1/AC-2): draft preparation versions another person prepared,
// which the caller may confirm (changeState refuses the preparer). Each kind is counted only when the caller passes
// that kind's company-wide check (requireKind), through Repository.count in the caller's context.
import { isUuid, label, PermissionDenied, repo, todoItems, type Context, type TodoCandidate } from '@daifuku/kernel';
import { actorId, requireKind } from './common.ts';
import type { FilingKind } from './contract.ts';
import { FilingAccountingPack, FilingPayrollPack } from './entities.ts';

function allowed(ctx: Context, kind: FilingKind): boolean {
  try {
    requireKind(ctx, kind);
    return true;
  } catch (error) {
    if (error instanceof PermissionDenied) return false;
    throw error;
  }
}

async function drafts(ctx: Context, kind: FilingKind): Promise<TodoCandidate | null> {
  if (!allowed(ctx, kind)) return null;
  const self = actorId(ctx);
  const where = { status: 'draft', ...(isUuid(self) ? { preparedBy: { $ne: self } } : {}) };
  const accounting = kind === 'accounting';
  return {
    key: accounting ? 'accounting_review' : 'payroll_review',
    label: accounting
      ? label('確認待ちの財務諸表の準備資料', 'Financial statement preparations awaiting review')
      : label('確認待ちの給与申告の準備資料', 'Payroll filing preparations awaiting review'),
    count: accounting
      ? await repo(ctx, FilingAccountingPack).count(where)
      : await repo(ctx, FilingPayrollPack).count(where),
    href: '/finance/filing',
    severity: 'info',
  };
}

export async function filingTodo(ctx: Context) {
  return todoItems([await drafts(ctx, 'accounting'), await drafts(ctx, 'payroll')]);
}
