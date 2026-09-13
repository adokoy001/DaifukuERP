import {
  cancelDocument,
  DOCSTATUS,
  registry,
  repo,
  StateError,
  todayLocal,
  type Context,
  type HookArgs,
} from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { Product, Uom } from '@daifuku/mod-product';
import { SalesInvoice } from '@daifuku/mod-sales';
import type { IndustryJobConfig, JobDef, JobRow } from './contracts.ts';
import { amount, businessDate, invalid, requiredText } from './validation.ts';

function values(ctx: Context, Job: JobDef, { row, previous }: HookArgs): Record<string, unknown> {
  const merged = { ...previous, ...row };
  for (const [name, field] of Object.entries(Job.config.fields)) {
    if (merged[name] === undefined && field.hasDefault && 'default' in field.opts) {
      merged[name] =
        field.kind === 'date' && field.opts.default === 'today' ? todayLocal(ctx.now()) : field.opts.default;
    }
  }
  return merged;
}
async function validateDraft(ctx: Context, Job: JobDef, config: IndustryJobConfig, args: HookArgs) {
  if (args.previous && args.previous.docstatus !== DOCSTATUS.draft) return;
  const value = values(ctx, Job, args);
  const ordered = amount(value.orderedQuantity, 'orderedQuantity'),
    completed = amount(value.completedQuantity, 'completedQuantity');
  const price = amount(value.unitPrice, 'unitPrice');
  if (!ordered.gt(0)) invalid('orderedQuantity', '受注数量は0より大きい値にしてください。');
  if (completed.lt(0) || completed.gt(ordered))
    invalid('completedQuantity', '実績数量は0以上・受注数量以内にしてください。');
  if (!price.gt(0)) invalid('unitPrice', '有償案件の単価は0より大きい値にしてください。');
  const date = businessDate(value.date, 'date');
  for (const key of ['plannedDate', 'completedDate'])
    if (value[key] && businessDate(value[key], key) < date) invalid(key, '受付日より前の日付は指定できません。');
  const partner = await repo(ctx, Partner).get(String(value.partnerId));
  if (!partner.isCustomer) invalid('partnerId', '請求先として有効な顧客を選択してください。');
  const product = await repo(ctx, Product).get(String(value.productId));
  if (!product.isActive || !product.isSold || product.kind !== config.productKind)
    invalid('productId', `有効な販売対象の ${config.productKind} 品目を選択してください。`);
  const unit = product.uomId ? await repo(ctx, Uom).get(product.uomId) : null;
  if (!unit || unit.code !== config.unitCode)
    invalid('productId', `この案件は単位 ${config.unitCode} の品目だけを扱います。`);
  config.validate(value, 'draft');
  args.row.quotedAmount = ordered.times(price);
  args.row.completedAmount = completed.times(price);
  args.row.unitCode = unit.code;
}
async function beforeCancel(ctx: Context, args: HookArgs): Promise<void> {
  const row = args.row as unknown as JobRow;
  const date = businessDate(args.correctionDate ?? row.completedDate ?? row.date, 'correctionDate');
  if (row.completedDate && date < row.completedDate) invalid('correctionDate', '取消日は完了日以降にしてください。');
  if (row.salesInvoiceId) {
    const invoice = await repo(ctx, SalesInvoice).lock(row.salesInvoiceId, 'read');
    if (date < invoice.date || (invoice.cancelledDate && date < invoice.cancelledDate))
      invalid('correctionDate', '請求日・請求取消日より前に案件を取り消すことはできません。');
  }
  args.row.status = 'cancelled';
  args.row.cancelledDate = date;
}
async function afterCancel(ctx: Context, { row }: HookArgs): Promise<void> {
  if (typeof row.salesInvoiceId !== 'string') return;
  const invoice = await repo(ctx, SalesInvoice).get(row.salesInvoiceId);
  if (invoice.docstatus === DOCSTATUS.submitted)
    await cancelDocument(ctx, SalesInvoice, invoice.id, {
      correctionDate: businessDate(row.cancelledDate, 'cancelledDate'),
    });
}
export function registerJobHooks(Job: JobDef, config: IndustryJobConfig): void {
  registry.registerHook(Job.name, 'before_validate', (ctx, args) => validateDraft(ctx, Job, config, args));
  registry.registerHook(Job.name, 'before_submit', (_ctx, { row }) => {
    if (row.status !== 'in_progress')
      throw new StateError('開始済みの案件だけを完了できます。', `${config.name}.start_job を実行してください。`);
    businessDate(row.completedDate, 'completedDate');
    requiredText(row, 'completionNote');
    if (!amount(row.completedQuantity, 'completedQuantity').gt(0))
      invalid('completedQuantity', '完了する数量は0より大きい値にしてください。');
    config.validate(row, 'complete');
    row.status = 'completed';
  });
  registry.registerHook(Job.name, 'before_cancel', beforeCancel);
  registry.registerHook(Job.name, 'after_cancel', afterCancel);
}
