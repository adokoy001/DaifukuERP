// workforce.render_payslip_html (docs/specs/print-templates.md AC-16, AC-19, AC-21, D-11): a confirmed payroll as a
// payslip. Read through the caller's Context with the workforce row rules (ADR-0019): employees, managers and HR see
// only their own confirmed payslips; payroll sees the company's. A draft (unconfirmed deductions) is refused. The
// issuer is the company (company.profile), never `sales.issuer`, and carries no registration number or bank details.
import { defineAction, DOCSTATUS, getCompany, label, registry, repo, StateError, type Context } from '@daifuku/kernel';
import { issuerFromCompanyProfile, loadPrintTools, statusBanner, withStatusBanner } from '@daifuku/mod-print-layout';
import { z } from 'zod';
import { deductionKinds } from '../contract.ts';
import { WorkforceEmployee, WorkforceSite } from '../entities/employee.ts';
import { WorkforcePayroll } from '../entities/payroll.ts';
import {
  defaultPayslipHtml,
  type DeductionKind,
  type PayslipHtmlRenderer,
  type PayslipRenderData,
} from '../services/payslip-html.ts';

/** Override point (ADR-0008). */
export const PAYSLIP_HTML_OVERRIDE = 'workforce.payslip_html';

function items(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

export async function buildPayslipRenderData(ctx: Context, id: string): Promise<PayslipRenderData> {
  const row = await repo(ctx, WorkforcePayroll).get(id);
  if (row.docstatus === DOCSTATUS.draft)
    throw new StateError(
      'A draft payroll cannot be printed as a payslip',
      'Review and confirm the deductions first; a payslip shows confirmed amounts only.',
    );
  const employee = await repo(ctx, WorkforceEmployee).get(row.employeeId);
  const site = await repo(ctx, WorkforceSite).get(row.siteId);
  const company = await getCompany(ctx);
  const stored = items(row.deductions);
  const deductions = deductionKinds
    .map((kind) => stored.find((d) => d.kind === kind))
    .filter((d): d is Record<string, unknown> => d !== undefined)
    .map((d) => ({ kind: d.kind as DeductionKind, amount: String(d.amount) }));
  return {
    issuer: issuerFromCompanyProfile(company, { registrationNo: false, email: false }),
    employee: { name: employee.name, code: employee.code, siteName: site.name },
    payslip: {
      number: row.number ?? '',
      period: row.period,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      docstatus: row.docstatus,
    },
    pay: {
      basePay: row.basePay.toString(),
      premiumPay: row.premiumPay.toString(),
      allowances: items(row.allowances).map((a) => ({ name: String(a.name), amount: String(a.amount) })),
      grossPay: row.grossPay.toString(),
    },
    deductions,
    deductionTotal: row.deductionTotal.toString(),
    netPay: row.netPay.toString(),
    attendance: { workedMinutes: Math.floor(row.workedMs / 60_000), paidLeaveDays: row.paidLeaveDays.toString() },
    locale: ctx.locale,
  };
}

export const renderPayslipHtmlAction = defineAction({
  name: 'workforce.render_payslip_html',
  description: label(
    '確定済みの給与を給与明細の HTML として描画します（支給・控除・差引支給額・勤怠。計算根拠は出さない）。本人は自分の明細だけ。レイアウトは差し替え点 workforce.payslip_html で置き換えられます。',
    'Render a confirmed payroll as an HTML payslip (payments, deductions, net pay, attendance; no calculation evidence). Employees see their own only. The layout is replaceable at override point workforce.payslip_html.',
  ),
  input: z.object({ id: z.uuid() }),
  output: z.object({ html: z.string() }),
  permission: { entity: WorkforcePayroll.name, op: 'read' },
  siteAccess: true,
  tx: 'none',
  mutates: false,
  print: { entity: WorkforcePayroll.name, label: label('給与明細を表示', 'View payslip') },
  handler: async (ctx, { id }) => {
    const data = await buildPayslipRenderData(ctx, id);
    const tools = await loadPrintTools(ctx);
    const render = registry.override<PayslipHtmlRenderer>(PAYSLIP_HTML_OVERRIDE, defaultPayslipHtml);
    return {
      html: withStatusBanner(
        render(data, tools),
        data.payslip.docstatus === DOCSTATUS.cancelled ? statusBanner('cancelled') : '',
      ),
    };
  },
});
