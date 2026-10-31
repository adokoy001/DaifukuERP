import { defineWriteCapability, label, registry, withWriteCapability } from '@daifuku/kernel';
import type { IndustryJobConfig, JobEngine, OwnedWrite } from './contracts.ts';
import { createJobEntity } from './entity.ts';
import { registerJobHooks } from './hooks.ts';
import { dueDaysSchema, invoiceAction } from './invoice.ts';
import { summaryAction } from './summary.ts';
import { workflowActions } from './workflow.ts';

export function createJobEngine(config: IndustryJobConfig): JobEngine {
  const Job = createJobEntity(config);
  const capability = defineWriteCapability({
    name: `${config.name}-job-workflow`,
    entity: Job.name,
    fields: ['status', 'startedAt', 'salesInvoiceId'],
    operations: ['update'],
  });
  const owned: OwnedWrite = (ctx, work) => withWriteCapability(ctx, capability, work);
  return {
    Job,
    actions: [...workflowActions(Job, config, owned), invoiceAction(Job, config, owned), summaryAction(Job, config)],
    registerHooks: () => {
      registerJobHooks(Job, config);
      registry.registerSetting({
        key: `${config.name}.due_days`,
        label: label(`${config.label.ja}の請求後支払日数`, `${config.label.en} payment term days`),
        description: label(
          '作業から作る売上請求書の日付から支払期日までの日数（0〜365）',
          'Days from the date of the sales invoice created from a job to its due date (0-365)',
        ),
        schema: dueDaysSchema,
        default: config.dueDays,
      });
    },
  };
}
