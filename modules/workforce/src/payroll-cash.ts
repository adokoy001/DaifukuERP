// Payroll payments for the cash forecast (docs/specs/cash-forecast.md D-4 `payroll`, AC-8). Only confirmed payroll
// (docstatus 1) whose published tax evidence records a payment date from today to `to` is scheduled, summed per
// payment date: no employee, name or per-person amount leaves this function. Confirmed payroll of the previous month
// through the month of `to` without evidence is only counted (no payment date is guessed). Payroll paid before today
// is treated as paid. Reads go through the caller's repository; a caller without payroll access gets PERMISSION_DENIED
// (the banking forecast checks access before calling and leaves payroll out instead).
import { Decimal, DOCSTATUS, type Context, type LocalDate } from '@daifuku/kernel';
import { allRows } from './common.ts';
import { WorkforcePayroll, WorkforcePayrollTaxEvidence } from './entities/index.ts';

export interface PayrollCashDay {
  paymentDate: LocalDate;
  count: number;
  netPay: Decimal;
}

export interface PayrollCashSchedule {
  /** Per payment date, ascending. */
  days: PayrollCashDay[];
  /** Confirmed payroll of the previous month .. the month of `to` with no payment evidence. */
  unscheduled: { count: number; netPay: Decimal };
}

const ID_CHUNK = 200;

function previousMonth(today: LocalDate): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

async function confirmedPayroll(ctx: Context, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const out = new Map<string, Decimal>();
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const rows = await allRows(ctx, WorkforcePayroll, {
      id: { $in: unique.slice(i, i + ID_CHUNK) },
      docstatus: DOCSTATUS.submitted,
    });
    for (const row of rows) out.set(row.id, row.netPay);
  }
  return out;
}

async function evidencePayrollIds(ctx: Context, ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const rows = await allRows(ctx, WorkforcePayrollTaxEvidence, { payrollId: { $in: ids.slice(i, i + ID_CHUNK) } });
    for (const row of rows) out.add(row.payrollId);
  }
  return out;
}

export async function payrollCashSchedule(
  ctx: Context,
  input: { today: LocalDate; to: LocalDate },
): Promise<PayrollCashSchedule> {
  const days = new Map<LocalDate, PayrollCashDay>();
  if (input.today <= input.to) {
    const evidence = await allRows(
      ctx,
      WorkforcePayrollTaxEvidence,
      { $and: [{ paymentDate: { $gte: input.today } }, { paymentDate: { $lte: input.to } }] },
      [{ field: 'paymentDate', dir: 'asc' }],
    );
    const confirmed = await confirmedPayroll(
      ctx,
      evidence.map((e) => e.payrollId),
    );
    for (const e of evidence) {
      const netPay = confirmed.get(e.payrollId);
      if (netPay === undefined) continue; // cancelled payroll keeps its evidence row
      const day = days.get(e.paymentDate) ?? { paymentDate: e.paymentDate, count: 0, netPay: Decimal.zero() };
      day.count += 1;
      day.netPay = day.netPay.plus(netPay);
      days.set(e.paymentDate, day);
    }
  }
  const unscheduled = { count: 0, netPay: Decimal.zero() };
  const fromPeriod = previousMonth(input.today);
  const toPeriod = input.to.slice(0, 7);
  if (fromPeriod <= toPeriod) {
    const payroll = await allRows(ctx, WorkforcePayroll, {
      docstatus: DOCSTATUS.submitted,
      $and: [{ period: { $gte: fromPeriod } }, { period: { $lte: toPeriod } }],
    });
    const withEvidence = await evidencePayrollIds(
      ctx,
      payroll.map((p) => p.id),
    );
    for (const p of payroll) {
      if (withEvidence.has(p.id)) continue;
      unscheduled.count += 1;
      unscheduled.netPay = unscheduled.netPay.plus(p.netPay);
    }
  }
  return {
    days: [...days.values()].sort((a, b) => (a.paymentDate < b.paymentDate ? -1 : 1)),
    unscheduled,
  };
}
