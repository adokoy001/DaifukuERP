// docs/specs/print-templates.md AC-6, AC-9, AC-16, AC-18: the default 給与明細 layout (golden, Japanese), English, the
// pay-month / hours formatting and what is left out (calculation evidence, basis text, registration number). Update
// the golden with `vitest -u` only for a deliberate layout change and record why in docs/log.
import { printTools } from '@daifuku/mod-print-layout';
import { describe, expect, it } from 'vitest';
import {
  defaultPayslipHtml,
  hoursMinutes,
  payMonthLabel,
  type PayslipRenderData,
} from '../src/services/payslip-html.ts';

const era = (d: string) => `令和${Number(d.slice(0, 4)) - 2018}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const ja = printTools('ja', 'both', era);
const en = printTools('en', 'western');

const data: PayslipRenderData = {
  issuer: { name: '株式会社大福', postalCode: '100-0001', address: '東京都千代田区1-1', phone: '03-0000-0000' },
  employee: { name: '山田 花子', code: 'E001', siteName: '本店' },
  payslip: {
    number: 'PAY-2026-000005',
    period: '2026-10',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    docstatus: 1,
  },
  pay: {
    basePay: '240000',
    premiumPay: '18750',
    allowances: [{ name: '通勤手当', amount: '12000' }],
    grossPay: '270750',
  },
  deductions: [
    { kind: 'income_tax', amount: '6420' },
    { kind: 'resident_tax', amount: '10000' },
    { kind: 'health_insurance', amount: '13860' },
    { kind: 'nursing_insurance', amount: '0' },
    { kind: 'pension', amount: '25620' },
    { kind: 'employment_insurance', amount: '1625' },
    { kind: 'child_support', amount: '0' },
    { kind: 'other', amount: '0' },
  ],
  deductionTotal: '57525',
  netPay: '213225',
  attendance: { workedMinutes: 10_065, paidLeaveDays: '1.5' },
  locale: 'ja',
};

describe('payslip layout (AC-16)', () => {
  it('AC-16 golden: test/golden/payslip.html', async () => {
    await expect(defaultPayslipHtml(data, ja)).toMatchFileSnapshot('./golden/payslip.html');
  });

  it('AC-16 the payslip shows month, period, employee, payments, the eight deductions, net pay and attendance', () => {
    const html = defaultPayslipHtml(data, ja);
    for (const s of [
      '>給与明細<',
      '2026年10月分',
      '2026年10月1日（令和8年10月1日） 〜 2026年10月31日（令和8年10月31日）',
      '山田 花子 様',
      '従業員コード: E001',
      '所属: 本店',
      '>通常賃金<',
      '>割増賃金<',
      '>通勤手当<',
      '>270,750<',
      '>所得税<',
      '>子ども・子育て支援金<',
      '>57,525<',
      '差引支給額',
      '213,225円',
      '>167:45<',
      '>1.5<',
      '株式会社大福',
    ])
      expect(html).toContain(s);
  });

  it('AC-9 / AC-16 no registration number, bank details or calculation basis on the payslip', () => {
    const html = defaultPayslipHtml(
      { ...data, issuer: { ...data.issuer, invoiceRegistrationNo: 'T1234567890123', bankInfo: '銀行' } },
      ja,
    );
    expect(html).not.toContain('T1234567890123');
    expect(html).not.toContain('銀行');
    expect(html).not.toContain('根拠');
  });

  it('AC-18 English: month as YYYY-MM, no 様', () => {
    const html = defaultPayslipHtml({ ...data, locale: 'en' }, en);
    expect(html).toContain('>Payslip<');
    expect(html).toContain('>2026-10<');
    expect(html).toContain('Net pay');
    expect(html).not.toContain('様');
  });

  it('AC-16 formatting helpers', () => {
    expect(payMonthLabel('2026-01', 'ja')).toBe('2026年1月分');
    expect(payMonthLabel('2026-01', 'en')).toBe('2026-01');
    expect(hoursMinutes(0)).toBe('0:00');
    expect(hoursMinutes(605)).toBe('10:05');
  });

  it('AC-6 the employee name is escaped', () => {
    const html = defaultPayslipHtml({ ...data, employee: { ...data.employee, name: '<i>x</i>' } }, ja);
    expect(html).toContain('&lt;i&gt;x&lt;/i&gt;');
    expect(html).not.toContain('<i>x</i>');
  });
});
