import {
  defineAction,
  DOCSTATUS,
  getSetting,
  isLocalDate,
  label,
  repo,
  saveLines,
  snapshot,
  StateError,
  submitDocument,
  type Context,
  type LocalDate,
} from '@daifuku/kernel';
import { SalesInvoice, SalesInvoiceLine } from '@daifuku/mod-sales';
import { z } from 'zod';
import type { IndustryJobConfig, JobDef, JobRow, OwnedWrite } from './contracts.ts';
import { addDays } from './validation.ts';
import { assertVersion, jobInput } from './workflow.ts';

export const dueDaysSchema = z.number().int().min(0).max(365);
const inputSchema = jobInput.extend({
  date: z
    .string()
    .refine(isLocalDate, 'YYYY-MM-DD')
    .optional()
    .meta({ title: '請求日（省略時は完了日）', format: 'date' }),
});
async function invoice(
  ctx: Context,
  Job: JobDef,
  config: IndustryJobConfig,
  owned: OwnedWrite,
  input: z.output<typeof inputSchema>,
) {
  const row = (await repo(ctx, Job).lock(input.jobId)) as unknown as JobRow;
  assertVersion(row, input.expectedVersion);
  if (row.docstatus !== DOCSTATUS.submitted || row.status !== 'completed' || !row.completedDate)
    throw new StateError('完了した案件だけを請求できます。', '先に完了実績を確定してください。');
  if (row.salesInvoiceId) {
    const existing = await repo(ctx, SalesInvoice).get(row.salesInvoiceId);
    if (existing.docstatus !== DOCSTATUS.submitted)
      throw new StateError(
        '連動請求書は取消済みです。再請求はできません。',
        '案件を取消・改訂して新しい案件で請求してください。',
      );
    return existing;
  }
  const date = (input.date ?? row.completedDate) as LocalDate;
  if (date < row.completedDate)
    throw new StateError('請求日は完了日以降にしてください。', '実際の請求日を指定してください。');
  const dueDays = await getSetting(ctx, `${config.name}.due_days`, dueDaysSchema, config.dueDays);
  const created = await repo(ctx, SalesInvoice).create({
    partnerId: row.partnerId,
    date,
    dueDate: addDays(date, dueDays),
    priceIncludesTax: false,
    note: `${config.label.ja}: ${row.number ?? row.reference ?? row.id} ${row.title}`,
  });
  await saveLines(ctx, SalesInvoice, created.id, {
    [SalesInvoiceLine.name]: [
      {
        productId: row.productId,
        description: row.title,
        quantity: row.completedQuantity,
        unitPrice: row.unitPrice,
        taxCategory: row.taxCategory,
      },
    ],
  });
  const posted = await submitDocument(ctx, SalesInvoice, created.id);
  await owned(ctx, (next) =>
    repo(next, Job).update(row.id, { salesInvoiceId: posted.id }, { expectedVersion: row.version }),
  );
  return posted;
}
export function invoiceAction(Job: JobDef, config: IndustryJobConfig, owned: OwnedWrite) {
  return defineAction({
    name: `${config.name}.invoice_job`,
    description: label(
      '完了数量で請求を作成・確定する（再実行は同じ請求）',
      'Invoice completed quantities once; retries return the same invoice',
    ),
    input: inputSchema,
    output: SalesInvoice.schemas.json,
    permission: { entity: Job.name, op: 'update' },
    handler: async (ctx, input) => snapshot({ ...(await invoice(ctx, Job, config, owned, input)) }),
  });
}
