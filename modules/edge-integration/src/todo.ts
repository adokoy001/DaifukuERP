// edge.todo inbox provider (docs/specs/inbox.md AC-1/AC-2): device jobs whose physical result must be confirmed —
// `uncertain`, or still `executing` past their lease or expiry (edge.board marks those uncertain when it is opened).
// Read-only: unlike edge.board this never changes job state. Repository.count in the caller's context keeps the
// gateway site boundary (EdgeJob inherits the gateway's siteId). The action is manager-only because only edge.resolve
// (manager) clears such a job; operators can still see the jobs on edge.board.
import { label, repo, todoItems, type Context } from '@daifuku/kernel';
import { EdgeJob } from './entities.ts';
export async function edgeTodo(ctx: Context) {
  const now = ctx.now().toISOString();
  const count = await repo(ctx, EdgeJob).count({
    $or: [
      { state: 'uncertain' },
      { state: 'executing', $or: [{ leaseUntil: { $lte: now } }, { expiresAt: { $lte: now } }] },
    ],
  });
  return todoItems([
    {
      key: 'uncertain_jobs',
      label: label('結果の確認が必要な機器処理', 'Device jobs whose result needs confirmation'),
      count,
      href: '/operations/devices',
      severity: 'warn',
    },
  ]);
}
