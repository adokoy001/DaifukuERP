// accounting.close_period / reopen_period (spec AC-10). Both go through repo.update, so the audit log records
// who closed or reopened the period (fiscal_period audit is 'full').
import { defineAction, label, repo, StateError, withLock, type Context } from '@daifuku/kernel';
import { z } from 'zod';
import { FiscalPeriod } from '../entities/fiscal-period.ts';
import { json } from './helpers.ts';

const PERIOD_ROLES = ['accounting', 'admin'] as const;

async function setClosed(ctx: Context, periodId: string, closed: boolean): Promise<Record<string, unknown>> {
  await withLock(ctx, 'accounting-periods', async () => undefined);
  const r = repo(ctx, FiscalPeriod);
  const period = await r.lock(periodId);
  if (period.isClosed === closed) {
    throw new StateError(`fiscal period ${period.code} is already ${closed ? 'closed' : 'open'}`, closed ? 'Nothing to do; use accounting.reopen_period to reopen it.' : 'Nothing to do; use accounting.close_period to close it.', { periodId, code: period.code });
  }
  return json(await r.update(periodId, { isClosed: closed }));
}

export const closePeriodAction = defineAction({
  name: 'accounting.close_period',
  description: label('会計期間を締めます。以後、その期間の日付の仕訳は転記できません（監査ログに記録）。', 'Close a fiscal period: submits dated in it are refused from now on (audited).'),
  input: z.object({ periodId: z.uuid() }),
  output: FiscalPeriod.schemas.json,
  permission: { roles: PERIOD_ROLES },
  handler: (ctx, { periodId }) => setClosed(ctx, periodId, true),
});

export const reopenPeriodAction = defineAction({
  name: 'accounting.reopen_period',
  description: label('締め済みの会計期間を再開します（監査ログに記録）。', 'Reopen a closed fiscal period (audited).'),
  input: z.object({ periodId: z.uuid() }),
  output: FiscalPeriod.schemas.json,
  permission: { roles: PERIOD_ROLES },
  handler: (ctx, { periodId }) => setClosed(ctx, periodId, false),
});
