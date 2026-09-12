// real_estate.arrears (spec AC-4): 滞納一覧 as of a date. Invoices come from sales (submitted, open, dated on or before asOf,
// due before asOf); only those generated from a contract count — the contract module links them through its
// contract_billing ledger (contractId, period, invoiceId), not through a field on the invoice. Tenant, property and unit
// come from the contract (partnerId, ext.unitId). One row per overdue invoice; days overdue from its due date.
import { defineAction, DOCSTATUS, label, MAX_REPORT_ROWS, column, repo, tableResult, todayLocal, type Context, type LocalDate, type TableResult } from '@daifuku/kernel';
import { Contract, ContractBilling } from '@daifuku/mod-contract';
import { Partner } from '@daifuku/mod-partner';
import { SalesInvoice, invoiceBalancesAsOf } from '@daifuku/mod-sales';
import { z } from 'zod';
import { RealEstateUnit } from '../entities/unit.ts';
import { allPages, byIds, inChunks, partnerNames, propertiesById, unitIdOf, unitsById } from '../load.ts';
import { arrearsRows, type ArrearsInput } from '../services/arrears.ts';
import { localDate } from './receive-deposit.ts';

export const ARREARS_COLUMNS = [
  column('tenantName', label('入居者', 'Tenant'), 'text'),
  column('propertyName', label('物件', 'Property'), 'text'),
  column('unitCode', label('部屋', 'Unit'), 'text'),
  column('period', label('対象月', 'Period'), 'text'),
  column('invoiceNumber', label('請求番号', 'Invoice'), 'text'),
  column('dueDate', label('期日', 'Due date'), 'date'),
  column('daysOverdue', label('延滞日数', 'Days overdue'), 'int'),
  column('balance', label('残高', 'Balance'), 'decimal'),
  column('invoiceId', label('請求書', 'Invoice id'), 'ref', { ref: SalesInvoice.name }),
  column('contractId', label('契約', 'Lease'), 'ref', { ref: Contract.name }),
  column('partnerId', label('入居者ID', 'Tenant id'), 'ref', { ref: Partner.name }),
  column('unitId', label('部屋ID', 'Unit id'), 'ref', { ref: RealEstateUnit.name }),
];

async function arrearsInputs(ctx: Context, asOf: LocalDate): Promise<ArrearsInput[]> {
  const ir = repo(ctx, SalesInvoice);
  const where = { date: { $lte: asOf }, dueDate: { $lt: asOf }, $or: [{ docstatus: DOCSTATUS.submitted }, { docstatus: DOCSTATUS.cancelled, cancelledDate: { $gt: asOf } }] };
  const invoices = await allPages((offset) => ir.list({ where, orderBy: [{ field: 'dueDate', dir: 'asc' }], limit: 500, offset }));
  const balances = await invoiceBalancesAsOf(ctx, invoices, asOf);
  const br = repo(ctx, ContractBilling);
  const billings = await inChunks(
    invoices.map((i) => i.id),
    (chunk) => allPages((offset) => br.list({ where: { invoiceId: { $in: chunk } }, limit: 500, offset })),
  );
  const cr = repo(ctx, Contract);
  const contracts = await byIds(
    billings.map((b) => b.contractId),
    (chunk) => cr.list({ where: { id: { $in: chunk } }, limit: chunk.length }),
  );
  const units = await unitsById(ctx, [...contracts.values()].map(unitIdOf).filter((id): id is string => id !== null));
  const properties = await propertiesById(
    ctx,
    [...units.values()].map((u) => u.propertyId),
  );
  const names = await partnerNames(
    ctx,
    [...contracts.values()].map((c) => c.partnerId),
  );
  const byInvoice = new Map(invoices.map((i) => [i.id, i]));
  return billings.flatMap((b): ArrearsInput[] => {
    const invoice = byInvoice.get(b.invoiceId);
    const contract = contracts.get(b.contractId);
    if (!invoice || !contract) return [];
    const unit = units.get(unitIdOf(contract) ?? '');
    const propertyName = unit ? (properties.get(unit.propertyId)?.name ?? null) : null;
    return [
      {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        invoiceDate: invoice.date,
        dueDate: invoice.dueDate,
        balance: balances.get(invoice.id) ?? invoice.total,
        period: b.period,
        contractId: contract.id,
        contractNumber: contract.number,
        partnerId: contract.partnerId,
        tenantName: names.get(contract.partnerId) ?? contract.partnerId,
        unitId: unit?.id ?? null,
        propertyName,
        unitCode: unit?.code ?? null,
      },
    ];
  });
}

export async function arrearsReport(ctx: Context, asOf: LocalDate): Promise<TableResult> {
  const { rows, total } = arrearsRows(await arrearsInputs(ctx, asOf), asOf);
  return {
    title: label(`滞納一覧 ${asOf} 現在`, `Rent arrears as of ${asOf}`),
    columns: ARREARS_COLUMNS,
    rows: rows.slice(0, MAX_REPORT_ROWS),
    totals: { balance: total.toString() },
    meta: { asOf, count: rows.length, truncated: rows.length > MAX_REPORT_ROWS },
  };
}

export const arrearsAction = defineAction({
  name: 'real_estate.arrears',
  description: label(
    '滞納一覧: asOf（省略時は今日）時点で支払期日を過ぎて未入金（残高あり）の、契約から作った家賃請求書を 1 行ずつ（入居者・物件・部屋・対象月・請求番号・期日・延滞日数・残高）。期日当日と期日前の請求書は含まない。',
    'Rent arrears as of asOf (default today): one row per contract-generated invoice that is still open after its due date (tenant, property, unit, period, invoice number, due date, days overdue, balance). Invoices due on or after asOf are not in arrears.',
  ),
  input: z.object({ asOf: localDate.optional() }),
  output: tableResult,
  exportEntities: ['sales_invoice', 'sales_settlement', 'contract_billing', 'contract', 'real_estate_unit', 'real_estate_property', 'partner'],
  permission: { entity: SalesInvoice.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: (ctx, { asOf }) => arrearsReport(ctx, asOf ?? todayLocal(ctx.now())),
});
