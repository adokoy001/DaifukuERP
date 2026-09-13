// 滞納一覧 shaping (spec AC-4 real_estate.arrears). Pure: no DB, no clock.
// An invoice is in arrears on `asOf` when it is submitted, open (balance > 0), dated on or before asOf and its due date is
// BEFORE asOf (the due date itself is not late). Days overdue = asOf − dueDate. Only invoices generated from a contract
// (contract_billing) are rows; the caller resolves tenant / property / unit through the contract's ext.unitId.
import { Decimal, type LocalDate } from '@daifuku/kernel';
import { daysBetween } from '@daifuku/mod-sales';

export interface ArrearsInput {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: LocalDate;
  dueDate: LocalDate | null;
  balance: Decimal;
  period: string;
  contractId: string;
  contractNumber: string | null;
  partnerId: string;
  tenantName: string;
  unitId: string | null;
  propertyName: string | null;
  unitCode: string | null;
}

export interface ArrearsRow extends Record<string, unknown> {
  tenantName: string;
  propertyName: string | null;
  unitCode: string | null;
  period: string;
  invoiceNumber: string | null;
  dueDate: LocalDate;
  daysOverdue: number;
  balance: string;
  invoiceId: string;
  contractId: string;
  partnerId: string;
  unitId: string | null;
}

export function isInArrears(
  input: Pick<ArrearsInput, 'invoiceDate' | 'dueDate' | 'balance'>,
  asOf: LocalDate,
): boolean {
  return input.dueDate !== null && input.dueDate < asOf && input.invoiceDate <= asOf && input.balance.gt(0);
}

/** Property, unit code (rows without a unit last), due date, invoice number. */
function compare(a: ArrearsRow, b: ArrearsRow): number {
  const keys = [
    [a.propertyName ?? '\uffff', b.propertyName ?? '\uffff'],
    [a.unitCode ?? '\uffff', b.unitCode ?? '\uffff'],
    [a.dueDate, b.dueDate],
    [a.invoiceNumber ?? '', b.invoiceNumber ?? ''],
  ] as const;
  for (const [x, y] of keys) if (x !== y) return x < y ? -1 : 1;
  return 0;
}

/** Rows per overdue invoice (property, unit, due date order) and the total balance. */
export function arrearsRows(inputs: readonly ArrearsInput[], asOf: LocalDate): { rows: ArrearsRow[]; total: Decimal } {
  const rows: ArrearsRow[] = [];
  for (const i of inputs) {
    if (!isInArrears(i, asOf) || i.dueDate === null) continue;
    rows.push({
      tenantName: i.tenantName,
      propertyName: i.propertyName,
      unitCode: i.unitCode,
      period: i.period,
      invoiceNumber: i.invoiceNumber,
      dueDate: i.dueDate,
      daysOverdue: daysBetween(i.dueDate, asOf),
      balance: i.balance.toString(),
      invoiceId: i.invoiceId,
      contractId: i.contractId,
      partnerId: i.partnerId,
      unitId: i.unitId,
    });
  }
  rows.sort(compare);
  return { rows, total: Decimal.sum(rows.map((r) => Decimal.from(r.balance))) };
}
