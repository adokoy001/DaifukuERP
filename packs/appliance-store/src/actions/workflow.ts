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
  type LocalDate,
} from '@daifuku/kernel';
import { z } from 'zod';
import { ApplianceService } from '../entities/service.ts';
import { withServiceWrite } from '../system-write.ts';

export const serviceActionInput = z.object({
  serviceId: z.uuid().meta({ title: '受付伝票' }),
  expectedVersion: z.number().int().positive().optional().meta({ title: '読込時の版（任意）' }),
});
export const completeServiceInput = serviceActionInput.extend({
  completedDate: z.string().refine(isLocalDate, 'must be YYYY-MM-DD').meta({ title: '作業完了日', format: 'date' }),
  workReport: z.string().trim().min(1).max(3000).meta({ title: '作業報告' }),
});
export type ServiceActionInput = z.output<typeof serviceActionInput>;
export function checkVersion(version: number, expectedVersion?: number): void {
  if (expectedVersion !== undefined && version !== expectedVersion)
    throw new Conflict('The service job was changed.', 'Reload the job and retry.');
}

export async function startService(ctx: Context, input: ServiceActionInput) {
  const job = await repo(ctx, ApplianceService).lock(input.serviceId);
  checkVersion(job.version, input.expectedVersion);
  if (job.docstatus !== DOCSTATUS.draft)
    throw new StateError('Only an uncompleted job can start.', 'Open the current draft.');
  if (job.status === 'in_progress') return job;
  if (job.status !== 'queued') throw new StateError('The job is not waiting for work.', 'Reload the job.');
  return withServiceWrite(ctx, (owned) =>
    repo(owned, ApplianceService).update(job.id, { status: 'in_progress' }, { expectedVersion: job.version }),
  );
}

export async function completeService(ctx: Context, input: z.output<typeof completeServiceInput>) {
  const job = await repo(ctx, ApplianceService).lock(input.serviceId, 'submit');
  checkVersion(job.version, input.expectedVersion);
  if (job.docstatus !== DOCSTATUS.draft || job.status !== 'in_progress')
    throw new StateError(
      'Complete a job after starting work.',
      'Use appliance_store.start_service, then record the completed work.',
    );
  const updated = await repo(ctx, ApplianceService).update(
    job.id,
    { completedDate: input.completedDate as LocalDate, workReport: input.workReport },
    { expectedVersion: job.version },
  );
  return submitDocument(ctx, ApplianceService, job.id, { expectedVersion: updated.version });
}

export const startServiceAction = defineAction({
  name: 'appliance_store.start_service',
  description: label('設置・修理の作業を開始する', 'Start installation or repair work'),
  input: serviceActionInput,
  output: ApplianceService.schemas.json,
  permission: { entity: ApplianceService.name, op: 'update' },
  handler: async (ctx, input) => snapshot({ ...(await startService(ctx, input)) }),
});
export const completeServiceAction = defineAction({
  name: 'appliance_store.complete_service',
  description: label(
    '作業報告と完了日を記録し受付を確定する（請求は次の操作）',
    'Record completed work and confirm the job; invoice it separately',
  ),
  input: completeServiceInput,
  output: ApplianceService.schemas.json,
  permission: { entity: ApplianceService.name, op: 'submit' },
  handler: async (ctx, input) => snapshot({ ...(await completeService(ctx, input)) }),
});
