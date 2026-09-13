// contract.schedule (spec AC-5): the billing schedule of a period as a TableResult — one row per contract in scope
// (active, or ended with endDate on or after the period start) with partner, title, billing date, the expected amount
// (税抜, prorated: exactly what contract.generate_invoices puts or put on the invoice, from the same planPeriod) and
// status due | generated | not_due (+ the reason). Read-only, outside the request transaction.
import {
  Decimal,
  defineAction,
  label,
  MAX_REPORT_ROWS,
  tableResult,
  column,
  type Context,
  type TableResult,
} from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { SalesInvoice } from '@daifuku/mod-sales';
import { z } from 'zod';
import { Contract } from '../entities/contract.ts';
import { billingsForPeriod } from '../ledger.ts';
import { companyScale, invoicesById, linesByContract, loadCandidates, partnerNames, termsOf } from '../load.ts';
import type { Period } from '../services/periods.ts';
import { planPeriod, PLAN_STATUSES, type PlanStatus, type SkipReason } from '../services/plan.ts';
import { formatFraction } from '../services/proration.ts';
import { periodInput } from './generate-invoices.ts';

export const scheduleInput = z.object({ period: periodInput });
export type ScheduleInput = z.output<typeof scheduleInput>;

export const SCHEDULE_COLUMNS = [
  column('contractNumber', label('契約番号', 'Contract'), 'text'),
  column('partnerName', label('取引先', 'Customer'), 'text'),
  column('title', label('件名', 'Title'), 'text'),
  column('billingDate', label('請求日', 'Billing date'), 'date'),
  column('expectedAmount', label('請求予定額（税抜）', 'Expected amount (excl. tax)'), 'decimal'),
  column('factor', label('日割り係数', 'Proration factor'), 'text'),
  column('status', label('状態', 'Status'), 'text'),
  column('reason', label('対象外の理由', 'Reason'), 'text'),
  column('invoiceNumber', label('請求書番号', 'Invoice number'), 'text'),
  column('contractId', label('契約', 'Contract id'), 'ref', { ref: Contract.name }),
  column('partnerId', label('取引先ID', 'Partner id'), 'ref', { ref: Partner.name }),
  column('invoiceId', label('請求書', 'Invoice id'), 'ref', { ref: SalesInvoice.name }),
];

export interface ScheduleRow extends Record<string, unknown> {
  contractId: string;
  contractNumber: string | null;
  partnerId: string;
  partnerName: string;
  title: string;
  billingDate: string | null;
  expectedAmount: string;
  factor: string | null;
  status: PlanStatus;
  reason: SkipReason | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

function compareRows(a: ScheduleRow, b: ScheduleRow): number {
  if (a.billingDate !== b.billingDate) {
    if (a.billingDate === null) return 1;
    if (b.billingDate === null) return -1;
    return a.billingDate < b.billingDate ? -1 : 1;
  }
  return (a.contractNumber ?? '') < (b.contractNumber ?? '') ? -1 : 1;
}

export async function contractSchedule(ctx: Context, period: Period): Promise<TableResult> {
  const contracts = await loadCandidates(ctx, period);
  const ids = contracts.map((c) => c.id);
  const billings = await billingsForPeriod(ctx, ids, period);
  const lines = await linesByContract(ctx, ids);
  const scale = await companyScale(ctx);
  const names = await partnerNames(
    ctx,
    contracts.map((c) => c.partnerId),
  );
  const invoices = await invoicesById(
    ctx,
    [...billings.values()].map((b) => b.invoiceId),
  );
  const planned = contracts.map((c) => {
    const billing = billings.get(c.id);
    const plan = planPeriod({
      terms: termsOf(c),
      lines: lines.get(c.id) ?? [],
      period,
      alreadyGenerated: billing !== undefined,
      scale,
    });
    const row: ScheduleRow = {
      contractId: c.id,
      contractNumber: c.number,
      partnerId: c.partnerId,
      partnerName: names.get(c.partnerId) ?? c.partnerId,
      title: c.title,
      billingDate: plan.billingDate,
      expectedAmount: plan.subtotal.toString(),
      factor: plan.status === 'not_due' ? null : formatFraction(plan.factor),
      status: plan.status,
      reason: plan.reason,
      invoiceId: billing?.invoiceId ?? null,
      invoiceNumber: billing ? (invoices.get(billing.invoiceId)?.number ?? null) : null,
    };
    return { row, subtotal: plan.subtotal };
  });
  const rows = planned.map((p) => p.row).sort(compareRows);
  const counts = Object.fromEntries(PLAN_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  return {
    title: label(`請求予定 ${period}`, `Billing schedule ${period}`),
    columns: SCHEDULE_COLUMNS,
    rows: rows.slice(0, MAX_REPORT_ROWS),
    totals: { expectedAmount: Decimal.sum(planned.map((p) => p.subtotal)).toString() },
    meta: { period, counts, truncated: rows.length > MAX_REPORT_ROWS },
  };
}

export const scheduleAction = defineAction({
  name: 'contract.schedule',
  description: label(
    '対象月（period, YYYY-MM）の請求予定: 契約ごとに取引先・件名・請求日・請求予定額（税抜、日割り後）・状態（due = 未作成で請求対象、generated = 作成済み、not_due = 対象外と理由）を返します。',
    'Billing schedule of a period (YYYY-MM): per contract the customer, title, billing date, expected amount (excl. tax, prorated) and status (due = to be generated, generated = invoice exists, not_due = not billed, with the reason).',
  ),
  input: scheduleInput,
  output: tableResult,
  exportEntities: ['contract', 'contract_line', 'contract_billing', 'partner', 'sales_invoice'],
  permission: { entity: Contract.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, input) => contractSchedule(ctx, input.period),
});
