// Default 給与明細 (payslip) layout (docs/specs/print-templates.md AC-16, AC-18). Pure: PayslipRenderData + PrintTools
// -> a complete HTML document. Every amount is the confirmed payroll's stored value; the calculation evidence and the
// basis text of each deduction / allowance are not printed. No statutory wording is printed (the statutory items of a
// 給与等の支払明細書 are not confirmed from a primary source; spec open question 2). Replaceable at workforce.payslip_html.
import type { Label } from '@daifuku/kernel';
import {
  addresseeBlock,
  amountBlock,
  dataTable,
  documentHeader,
  formatMoney,
  issuerBlock,
  partiesSection,
  printDocument,
  type PrintIssuer,
  type PrintTools,
} from '@daifuku/mod-print-layout';
import type { deductionKinds } from '../contract.ts';

export type DeductionKind = (typeof deductionKinds)[number];

/** The eight named deductions in ja and en (same names as the workforce screens). */
export const DEDUCTION_LABELS: Record<DeductionKind, Label> = {
  income_tax: { ja: '所得税', en: 'Income tax' },
  resident_tax: { ja: '住民税', en: 'Resident tax' },
  health_insurance: { ja: '健康保険', en: 'Health insurance' },
  nursing_insurance: { ja: '介護保険', en: 'Nursing care insurance' },
  pension: { ja: '厚生年金', en: 'Employees pension' },
  employment_insurance: { ja: '雇用保険', en: 'Employment insurance' },
  child_support: { ja: '子ども・子育て支援金', en: 'Child support contribution' },
  other: { ja: 'その他控除', en: 'Other deductions' },
};

export interface PayslipRenderData {
  issuer: PrintIssuer;
  employee: { name: string; code: string; siteName: string };
  payslip: {
    number: string;
    /** YYYY-MM */
    period: string;
    periodStart: string;
    periodEnd: string;
    docstatus: number;
  };
  pay: { basePay: string; premiumPay: string; allowances: Array<{ name: string; amount: string }>; grossPay: string };
  deductions: Array<{ kind: DeductionKind; amount: string }>;
  deductionTotal: string;
  netPay: string;
  attendance: { workedMinutes: number; paidLeaveDays: string };
  locale: 'ja' | 'en';
}
export type PayslipHtmlRenderer = (data: PayslipRenderData, tools: PrintTools) => string;

const L = {
  title: { ja: '給与明細', en: 'Payslip' },
  number: { ja: '番号', en: 'No.' },
  month: { ja: '対象月', en: 'Pay month' },
  period: { ja: '計算期間', en: 'Calculation period' },
  honorific: { ja: ' 様', en: '' },
  code: { ja: '従業員コード', en: 'Employee code' },
  site: { ja: '所属', en: 'Site' },
  payments: { ja: '支給', en: 'Payments' },
  deductions: { ja: '控除', en: 'Deductions' },
  attendance: { ja: '勤怠', en: 'Attendance' },
  item: { ja: '項目', en: 'Item' },
  amount: { ja: '金額', en: 'Amount' },
  actual: { ja: '実績', en: 'Actual' },
  basePay: { ja: '通常賃金', en: 'Base pay' },
  premiumPay: { ja: '割増賃金', en: 'Premium pay' },
  grossPay: { ja: '総支給額', en: 'Gross pay' },
  deductionTotal: { ja: '控除合計', en: 'Total deductions' },
  netPay: { ja: '差引支給額', en: 'Net pay' },
  worked: { ja: '労働時間', en: 'Hours worked' },
  paidLeave: { ja: '有給取得日数', en: 'Paid leave taken (days)' },
} satisfies Record<string, Label>;

/** 'YYYY-MM' -> '2026年10月分' / '2026-10'. */
export function payMonthLabel(period: string, locale: 'ja' | 'en'): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m || locale !== 'ja') return period;
  return `${m[1]}年${Number(m[2])}月分`;
}

/** Minutes -> 'H:MM'. */
export function hoursMinutes(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const defaultPayslipHtml: PayslipHtmlRenderer = (d, tools) => {
  const t = tools.t;
  const p = d.payslip;
  const meta: Array<readonly [string, string]> = [
    [t(L.number), p.number],
    [t(L.month), payMonthLabel(p.period, d.locale)],
    [t(L.period), `${tools.date(p.periodStart)} 〜 ${tools.date(p.periodEnd)}`],
  ];
  const item = [{ label: t(L.item) }, { label: t(L.amount), align: 'right' as const }];
  const payments = dataTable(
    item,
    [
      [t(L.basePay), formatMoney(d.pay.basePay)],
      [t(L.premiumPay), formatMoney(d.pay.premiumPay)],
      ...d.pay.allowances.map((a) => [a.name, formatMoney(a.amount)]),
    ],
    { className: 'payments', caption: t(L.payments), foot: [t(L.grossPay), formatMoney(d.pay.grossPay)] },
  );
  const deductions = dataTable(
    item,
    d.deductions.map((x) => [t(DEDUCTION_LABELS[x.kind]), formatMoney(x.amount)]),
    { className: 'deductions', caption: t(L.deductions), foot: [t(L.deductionTotal), formatMoney(d.deductionTotal)] },
  );
  const attendance = dataTable(
    [{ label: t(L.item) }, { label: t(L.actual), align: 'right' }],
    [
      [t(L.worked), hoursMinutes(d.attendance.workedMinutes)],
      [t(L.paidLeave), formatMoney(d.attendance.paidLeaveDays)],
    ],
    { className: 'attendance', caption: t(L.attendance) },
  );
  const body = [
    documentHeader(t(L.title), meta),
    partiesSection(
      addresseeBlock(
        {
          name: d.employee.name,
          lines: [`${t(L.code)}: ${d.employee.code}`, `${t(L.site)}: ${d.employee.siteName}`],
        },
        d.locale,
        L.honorific,
      ),
      issuerBlock(d.issuer, d.locale, { registrationNo: false }),
    ),
    amountBlock(t(L.netPay), d.netPay, d.locale),
    payments,
    deductions,
    attendance,
  ];
  return printDocument({
    title: `${t(L.title)} ${payMonthLabel(p.period, d.locale)} ${d.employee.name}`,
    locale: d.locale,
    body: body.join('\n'),
    className: 'payslip',
  });
};
