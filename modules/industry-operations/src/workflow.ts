import {
  Conflict,
  defineAction,
  DOCSTATUS,
  isLocalDate,
  label,
  repo,
  snapshot,
  StateError,
  submitDocument,
  type Context,
} from '@daifuku/kernel';
import { z } from 'zod';
import type { IndustryJobConfig, JobDef, JobRow, OwnedWrite } from './contracts.ts';

export const jobInput = z.object({
  jobId: z.uuid().meta({ title: '案件伝票' }),
  expectedVersion: z.number().int().positive().optional().meta({ title: '読込時の版（任意）' }),
});
export const completeJobInput = jobInput.extend({
  completedDate: z.string().refine(isLocalDate, 'YYYY-MM-DD').meta({ title: '完了日', format: 'date' }),
  completedQuantity: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .meta({ title: '履行した数量（案件の単位）' }),
  completionNote: z.string().trim().min(1).max(3000).meta({ title: '履行・完了報告' }),
});
export function assertVersion(row: JobRow, expected?: number): void {
  if (expected !== undefined && row.version !== expected)
    throw new Conflict('案件が更新されています。', '再読込して現在の内容を確認してください。');
}
async function start(
  ctx: Context,
  Job: JobDef,
  config: IndustryJobConfig,
  owned: OwnedWrite,
  input: z.output<typeof jobInput>,
) {
  const row = (await repo(ctx, Job).lock(input.jobId)) as unknown as JobRow;
  assertVersion(row, input.expectedVersion);
  if (row.docstatus !== DOCSTATUS.draft || !['queued', 'in_progress'].includes(row.status))
    throw new StateError('受付中の案件だけを開始できます。', '現在の下書きを確認してください。');
  if (row.status === 'in_progress') return row;
  config.validate(row, 'start');
  return owned(ctx, (next) =>
    repo(next, Job).update(row.id, { status: 'in_progress', startedAt: ctx.now() }, { expectedVersion: row.version }),
  );
}
async function complete(ctx: Context, Job: JobDef, input: z.output<typeof completeJobInput>) {
  const row = (await repo(ctx, Job).lock(input.jobId, 'submit')) as unknown as JobRow;
  assertVersion(row, input.expectedVersion);
  if (row.docstatus !== DOCSTATUS.draft || row.status !== 'in_progress')
    throw new StateError('開始後に完了実績を記録してください。', 'start_job を実行してください。');
  const data = {
    completedDate: input.completedDate,
    completedQuantity: input.completedQuantity,
    completionNote: input.completionNote,
  };
  const changed = await repo(ctx, Job).update(row.id, data, { expectedVersion: row.version });
  return submitDocument(ctx, Job, row.id, { expectedVersion: changed.version });
}
export function workflowActions(Job: JobDef, config: IndustryJobConfig, owned: OwnedWrite) {
  return [
    defineAction({
      name: `${config.name}.start_job`,
      description: label('受付案件の対応を開始する', 'Start the accepted job'),
      input: jobInput,
      output: Job.schemas.json,
      permission: { entity: Job.name, op: 'update' },
      handler: async (ctx, input) => snapshot({ ...(await start(ctx, Job, config, owned, input)) }),
    }),
    defineAction({
      name: `${config.name}.complete_job`,
      description: label(
        '実績と業界固有の完了条件を確認して案件を確定する',
        'Validate fulfillment and confirm completion',
      ),
      input: completeJobInput,
      output: Job.schemas.json,
      permission: { entity: Job.name, op: 'submit' },
      handler: async (ctx, input) => snapshot({ ...(await complete(ctx, Job, input)) }),
    }),
  ];
}
