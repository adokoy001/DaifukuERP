import {
  column,
  defineAction,
  isLocalDate,
  label,
  MAX_REPORT_ROWS,
  repo,
  tableResult,
  todayLocal,
  type Context,
  type Infer,
  type LocalDate,
  type TableResult,
} from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { z } from 'zod';
import { ApplianceDevice } from '../entities/device.ts';
import { ApplianceService, SERVICE_STATUS_LABELS } from '../entities/service.ts';

export const OPEN_SERVICE_COLUMNS = [
  column('serviceId', label('受付', 'Job'), 'ref', { ref: ApplianceService.name }),
  column('title', label('依頼名', 'Title'), 'text'),
  column('customer', label('お客様', 'Customer'), 'text'),
  column('device', label('機器・型番', 'Device / model'), 'text'),
  column('scheduledDate', label('予定日', 'Scheduled'), 'date'),
  column('assignee', label('担当', 'Technician'), 'text'),
  column('status', label('進捗', 'Status'), 'text'),
  column('overdue', label('予定超過', 'Overdue'), 'bool'),
];

async function pendingJobs(ctx: Context) {
  const jobs: Infer<typeof ApplianceService>[] = [];
  let total = 0;
  do {
    const page = await repo(ctx, ApplianceService).list({
      where: { $or: [{ docstatus: 0 }, { docstatus: 1, billing: 'billable', salesInvoiceId: null }] },
      orderBy: [
        { field: 'scheduledDate', dir: 'asc' },
        { field: 'id', dir: 'asc' },
      ],
      limit: Math.min(500, MAX_REPORT_ROWS - jobs.length),
      offset: jobs.length,
    });
    total = page.total;
    jobs.push(...page.items);
    if (!page.items.length) break;
  } while (jobs.length < total && jobs.length < MAX_REPORT_ROWS);
  return { jobs, total };
}

export async function openServices(ctx: Context, asOf: LocalDate = todayLocal(ctx.now())): Promise<TableResult> {
  const { jobs, total } = await pendingJobs(ctx);
  const customerNames = new Map<string, string>();
  const deviceNames = new Map<string, string>();
  const rows: TableResult['rows'] = [];
  for (const job of jobs) {
    if (!customerNames.has(job.partnerId))
      customerNames.set(job.partnerId, (await repo(ctx, Partner).get(job.partnerId)).name);
    if (!deviceNames.has(job.deviceId)) {
      const device = await repo(ctx, ApplianceDevice).get(job.deviceId);
      deviceNames.set(job.deviceId, `${device.name} ${device.model}`);
    }
    rows.push({
      serviceId: job.id,
      title: job.title,
      customer: customerNames.get(job.partnerId) ?? '',
      device: deviceNames.get(job.deviceId) ?? '',
      scheduledDate: job.scheduledDate,
      assignee: job.assignee,
      status:
        job.docstatus === 1
          ? ctx.locale === 'en'
            ? 'Awaiting invoice'
            : '請求待ち'
          : SERVICE_STATUS_LABELS[job.status][ctx.locale === 'en' ? 'en' : 'ja'],
      overdue: job.docstatus === 0 && job.scheduledDate !== null && job.scheduledDate < asOf,
    });
  }
  return {
    title: label('設置・修理の未完了・請求待ち', 'Open service jobs and uninvoiced work'),
    columns: OPEN_SERVICE_COLUMNS,
    rows,
    meta: { asOf, total, truncated: total > rows.length },
  };
}

export const openServicesAction = defineAction({
  name: 'appliance_store.open_services',
  description: label(
    '未完了の受付と有償の請求待ちを確認する',
    'List unfinished jobs and completed billable jobs awaiting invoice',
  ),
  input: z.object({
    asOf: z
      .string()
      .refine(isLocalDate, 'must be YYYY-MM-DD')
      .optional()
      .meta({ title: '予定超過の判定日', format: 'date' }),
  }),
  output: tableResult,
  exportEntities: [ApplianceService.name, ApplianceDevice.name, Partner.name],
  permission: { entity: ApplianceService.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, input) => openServices(ctx, input.asOf as LocalDate | undefined),
});
