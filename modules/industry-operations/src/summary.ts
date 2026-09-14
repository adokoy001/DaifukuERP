import {
  column,
  Decimal,
  defineAction,
  DOCSTATUS,
  isLocalDate,
  label,
  MAX_REPORT_ROWS,
  repo,
  StateError,
  tableResult,
  type Context,
  type Domain,
  type TableResult,
} from '@daifuku/kernel';
import { z } from 'zod';
import type { IndustryJobConfig, JobDef, JobRow } from './contracts.ts';
import { invalid } from './validation.ts';
const date = z.string().refine(isLocalDate, 'YYYY-MM-DD');
const inputSchema = z.object({
  from: date.meta({ title: '完了期間の開始日', format: 'date' }),
  to: date.meta({ title: '完了期間の終了日', format: 'date' }),
  asOf: date.meta({ title: '取消判定の基準日', format: 'date' }),
});
async function rows(ctx: Context, Job: JobDef, where: Domain): Promise<JobRow[]> {
  const result: JobRow[] = [];
  for (let offset = 0; ;) {
    const page = await repo(ctx, Job).list({ where, limit: 500, offset, orderBy: [{ field: 'id', dir: 'asc' }] });
    if (page.total > MAX_REPORT_ROWS)
      throw new StateError(
        '対象案件がレポート上限を超えています。',
        '期間を狭めてください。途中までの合計は返しません。',
      );
    result.push(...(page.items as unknown as JobRow[]));
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return result;
  }
}
async function summarize(
  ctx: Context,
  Job: JobDef,
  config: IndustryJobConfig,
  input: z.output<typeof inputSchema>,
): Promise<TableResult> {
  if (input.from > input.to || input.to > input.asOf)
    invalid('to', 'from <= to <= asOf となる日付を指定してください。');
  const where: Domain = {
    docstatus: { $in: [DOCSTATUS.submitted, DOCSTATUS.cancelled] },
    $and: [{ completedDate: { $gte: input.from } }, { completedDate: { $lte: input.to } }],
  };
  const source = await rows(ctx, Job, where);
  const visible: JobRow[] = [];
  for (const row of source) {
    if (row.docstatus === DOCSTATUS.cancelled && !row.cancelledDate)
      throw new StateError('取消の有効日が不明です。', '履歴を復元してください。');
    if (row.unitCode !== config.unitCode)
      throw new StateError('数量単位が異なる案件を合算できません。', '品目と案件単位を確認してください。');
    if (row.docstatus === DOCSTATUS.submitted || String(row.cancelledDate) > input.asOf) visible.push(row);
  }
  return {
    title: label(`${config.label.ja}の完了実績`, `${config.label.en} fulfillment`),
    columns: [
      column('jobId', label('案件', 'Job'), 'ref', { ref: Job.name }),
      column('number', label('番号', 'Number'), 'text'),
      column('title', label('案件名', 'Title'), 'text'),
      column('completedDate', label('完了日', 'Completed date'), 'date'),
      column('quantity', config.quantityLabel, 'decimal'),
      column('unit', label('単位', 'Unit'), 'text'),
      column('amount', label('履行金額（税計算前・未丸め）', 'Fulfilled amount before tax / rounding'), 'decimal'),
    ],
    rows: visible.map((row) => ({
      jobId: row.id,
      number: row.number,
      title: row.title,
      completedDate: row.completedDate,
      quantity: row.completedQuantity.toString(),
      unit: row.unitCode,
      amount: row.completedAmount.toString(),
    })),
    totals: {
      quantity: Decimal.sum(visible.map((row) => row.completedQuantity)).toString(),
      amount: Decimal.sum(visible.map((row) => row.completedAmount)).toString(),
    },
    meta: { ...input, unit: config.unitCode, accountingRevenue: false, excludesDrafts: true },
  };
}
export function summaryAction(Job: JobDef, config: IndustryJobConfig) {
  return defineAction({
    name: `${config.name}.job_summary`,
    description: label(
      '完了日と取消有効日による履行実績。会計売上・利益・未入金の集計ではありません。',
      'Fulfillment by completion and cancellation dates; not accounting revenue or profit.',
    ),
    input: inputSchema,
    output: tableResult,
    permission: { entity: Job.name, op: 'read' },
    exportEntities: [Job.name],
    mutates: false,
    handler: (ctx, input) => summarize(ctx, Job, config, input),
  });
}
