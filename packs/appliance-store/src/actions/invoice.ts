import { defineAction, DOCSTATUS, getLines, isLocalDate, label, repo, saveLines, snapshot, StateError, submitDocument, type Context, type LocalDate } from '@daifuku/kernel';
import { SalesInvoice, SalesInvoiceLine } from '@daifuku/mod-sales';
import { z } from 'zod';
import { ApplianceService } from '../entities/service.ts';
import { ApplianceServiceLine } from '../entities/service-line.ts';
import { withServiceWrite } from '../system-write.ts';
import { checkVersion, serviceActionInput } from './workflow.ts';

export const invoiceServiceInput = serviceActionInput.extend({ date: z.string().refine(isLocalDate, 'must be YYYY-MM-DD').optional().meta({ title: '請求日（省略時は作業完了日）', format: 'date' }) });

export async function invoiceService(ctx: Context, input: z.output<typeof invoiceServiceInput>) {
  const job = await repo(ctx, ApplianceService).lock(input.serviceId);
  checkVersion(job.version, input.expectedVersion);
  if (job.docstatus !== DOCSTATUS.submitted || job.status !== 'completed') throw new StateError('Only a completed job can be invoiced.', 'Complete the service job first.');
  if (job.billing !== 'billable') throw new StateError('No-charge jobs cannot be invoiced.', 'Cancel and amend the job if its billing decision was incorrect.');
  if (job.salesInvoiceId) return repo(ctx, SalesInvoice).get(job.salesInvoiceId);
  const date = (input.date ?? job.completedDate) as LocalDate;
  if (!isLocalDate(date) || (job.completedDate && date < job.completedDate)) throw new StateError('Invoice date must be on or after service completion.', 'Select the completion date or a later invoice date.');
  const lines = (await getLines(ctx, ApplianceService, job.id))[ApplianceServiceLine.name] ?? [];
  const invoice = await repo(ctx, SalesInvoice).create({ partnerId: job.partnerId, date, priceIncludesTax: false, note: `設置・修理 ${job.number ?? job.reference ?? job.id} ${job.title}` });
  await saveLines(ctx, SalesInvoice, invoice.id, { [SalesInvoiceLine.name]: lines.map(({ productId, description, quantity, unitPrice, taxCategory }) => ({ productId, description, quantity, unitPrice, taxCategory })) });
  const submitted = await submitDocument(ctx, SalesInvoice, invoice.id);
  await withServiceWrite(ctx, (owned) => repo(owned, ApplianceService).update(job.id, { salesInvoiceId: submitted.id }, { expectedVersion: job.version }));
  return submitted;
}

export const invoiceServiceAction = defineAction({
  name: 'appliance_store.invoice_service', description: label('有償の完了受付から請求書を作成・確定する（再実行しても同じ請求書）', 'Create and submit the completed job invoice; retries return the same invoice'),
  input: invoiceServiceInput, output: SalesInvoice.schemas.json, permission: { entity: ApplianceService.name, op: 'update' },
  handler: async (ctx, input) => snapshot({ ...await invoiceService(ctx, input) }),
});
