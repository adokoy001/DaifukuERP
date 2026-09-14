import { describe, expect, it } from 'vitest';
import type { PayrollRuleSummary } from '../api/fiscal.ts';
import {
  dateInRuleRange,
  monthEnd,
  payrollPaymentRange,
  supportedPayrollBundle,
  supportedYearEndBundle,
  withinRuleRange,
} from './payroll-rules.ts';

// Deliberately synthetic: these dates do not establish support for any real future tax year.
function testRule(status: PayrollRuleSummary['status'] = 'approved'): PayrollRuleSummary {
  return {
    packageCode: 'TEST-ONLY-2097',
    code: 'TEST-ONLY-2097',
    taxYear: 2097,
    verifiedOn: '2097-01-01',
    status,
    payloadHash: 'a'.repeat(64),
    manifestHash: 'b'.repeat(64),
    sources: [],
    ruleId: status === 'available' ? null : 'synthetic-rule',
    approvedAt: null,
    approvalBasis: null,
    manifest: {
      manifestSchema: 1,
      packageCode: 'TEST-ONLY-2097',
      revision: 1,
      country: 'JP',
      currency: 'JPY',
      regime: 'test',
      taxYear: 2097,
      dataSchema: 'test',
      algorithmVersion: 'test',
      parameters: {},
      applicability: {
        paymentDates: { from: '2097-01-01', to: '2097-12-31' },
        insuranceMonths: { from: '2096-12', to: '2097-12' },
        wageCutoffDates: { from: '2096-12-01', to: '2097-12-31' },
        adjustmentDates: { from: '2097-12-01', to: '2098-01-31' },
        yearEndFactsOn: '2097-12-31',
        requiredFinalPaymentFrom: '2097-12-01',
      },
    },
  };
}

describe('payroll rule availability in browser forms', () => {
  it('allows a prior December work month only within the selected year payment window', () => {
    const rule = testRule();
    expect(payrollPaymentRange('2096-12', rule)).toEqual({ from: '2097-01-01', to: '2097-01-31' });
    expect(payrollPaymentRange('2097-03', rule)).toEqual({ from: '2097-03-31', to: '2097-04-30' });
    expect(payrollPaymentRange('2097-12', rule)).toEqual({ from: '2097-12-31', to: '2097-12-31' });
    expect(payrollPaymentRange('2098-01', rule)).toBeUndefined();
    expect(payrollPaymentRange('2096-11', rule)).toBeUndefined();
  });
  it('does not use available or superseded data or substitute a different tax year', () => {
    const available = testRule('available');
    const old = testRule('superseded');
    const legacy = testRule('legacy');
    expect(supportedPayrollBundle([available, old], 2097, '2097-05')).toBeUndefined();
    expect(supportedPayrollBundle([legacy], 2097, '2097-05')).toBe(legacy);
    expect(supportedPayrollBundle([legacy], 2098, '2097-12')).toBeUndefined();
    expect(supportedYearEndBundle([available], 2097)).toBeUndefined();
  });
  it('refuses ambiguous installed packages instead of choosing one by array order', () => {
    const first = testRule();
    const second = { ...testRule(), packageCode: 'TEST-ONLY-CONFLICT' };
    expect(supportedPayrollBundle([first, second], 2097, '2097-05')).toBeUndefined();
    expect(supportedYearEndBundle([first, second], 2097)).toBeUndefined();
  });
  it('keeps next-January annual adjustment distinct from next-year monthly support', () => {
    const rule = testRule();
    expect(supportedYearEndBundle([rule], 2097)).toBe(rule);
    expect(withinRuleRange('2098-01-31', rule.manifest.applicability.adjustmentDates)).toBe(true);
    expect(withinRuleRange('2098-01-01', rule.manifest.applicability.paymentDates)).toBe(false);
    expect(supportedYearEndBundle([rule], 2098)).toBeUndefined();
  });
  it('clamps editable defaults to each specific date range and respects inclusive boundaries', () => {
    const range = testRule().manifest.applicability.adjustmentDates;
    expect(dateInRuleRange('2097-09-13', range)).toBe('2097-12-01');
    expect(dateInRuleRange('2097-12-25', range)).toBe('2097-12-25');
    expect(dateInRuleRange('2098-02-01', range)).toBe('2098-01-31');
    expect(withinRuleRange('2097-11-30', range)).toBe(false);
    expect(withinRuleRange('2097-12-01', range)).toBe(true);
    expect(withinRuleRange('2098-02-01', range)).toBe(false);
    expect(withinRuleRange('', range)).toBe(false);
  });
  it('handles leap-year and December boundaries without accepting malformed month controls', () => {
    expect(monthEnd('2096-02')).toBe('2096-02-29');
    expect(monthEnd('2097-02')).toBe('2097-02-28');
    expect(monthEnd('2097-12')).toBe('2097-12-31');
    for (const value of ['', '2097-13', '2097-00', '2097-2', '2097-02-01']) expect(monthEnd(value)).toBe('');
  });
});
