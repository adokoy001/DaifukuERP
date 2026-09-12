import { describe, expect, it } from 'vitest';
import { Decimal } from '@daifuku/kernel';
import { annualAdjustment, annualBasic, annualSalaryIncome } from '../src/services/annual-tax.ts';
import { monthlyWithholding } from '../src/services/monthly-tax.ts';
import { attainedAge, payrollInsuranceRound, socialInsurance } from '../src/services/social-insurance.ts';
import { declarationDeductions } from '../src/services/annual-deductions.ts';
import { FISCAL_DATA, HEALTH_GRADES, PENSION_GRADES } from '../src/services/fiscal-data.ts';
import { condition, declaration } from './fiscal-fixtures.ts';
const D = Decimal.from;
describe('2026 official regular payroll calculation', () => {
  it.each([['740999', '0'], ['741000', '1000'], ['2190999', '1450999'], ['2191000', '1451000'], ['2192999', '1451000'], ['2193000', '1453000'], ['2195999', '1453000'], ['2196000', '1456000'], ['2199999', '1456000'], ['2200000', '1460000'], ['2203999', '1460000'], ['2204000', '1462800'], ['5310000', '3806400'], ['6600001', '4840000'], ['20000000', '18050000']])('annual published table boundary %s => %s', (pay, expected) => { expect(annualSalaryIncome(D(pay)).toString()).toBe(expected); });
  it('rejects salary beyond the statutory year-end adjustment limit', () => { expect(() => annualSalaryIncome(D(20000001))).toThrow(/exceeds/); });
  it.each([['4890000', '1040000'], ['4890001', '670000'], ['6550000', '670000'], ['6550001', '620000'], ['23500001', '480000'], ['24000001', '320000'], ['24500001', '160000'], ['25000001', '0']])('December basic deduction boundary %s', (income, expected) => { expect(annualBasic(D(income)).toString()).toBe(expected); });
  it('keeps monthly old deduction distinct from the December annual amendment', () => {
    const monthly = monthlyWithholding(D(300000), D(45000), 0), annual = annualAdjustment(declaration(), D(3600000), D(600000), D(90000));
    expect(monthly.salaryDeduction.toString()).toBe('83167'); expect(monthly.basicDeduction.toString()).toBe('48334'); expect(monthly.incomeTax.toString()).toBe('6300');
    expect(annual.deductions.basic.toString()).toBe('1040000'); expect(annual.annualTax.toString()).toBe('40800'); expect(annual.refund.toString()).toBe('49200');
  });
  it.each([['66.5', '66'], ['66.500001', '67'], ['66.49', '66'], ['1279.7', '1280']])('uses wage deduction rounding %s => %s', (raw, expected) => { expect(payrollInsuranceRound(D(raw)).toString()).toBe(expected); });
  it('uses insurance months and the wage cutoff independently of the eventual payment month', () => {
    const march = socialInsurance(condition(), '2026-03', '2026-03-31', D(300000)), april = socialInsurance(condition(), '2026-04', '2026-04-30', D(300000));
    expect(march.health.toString()).toBe('14775'); expect(march.nursing.toString()).toBe('2430'); expect(march.childSupport.toString()).toBe('0'); expect(march.employment.toString()).toBe('1650');
    expect(april.childSupport.toString()).toBe('345'); expect(april.pension.toString()).toBe('27450'); expect(april.employment.toString()).toBe('1500'); expect(april.total.toString()).toBe('46500');
  });
  it('applies the age-40/65 preceding-day rule to March 1 birthdays in February', () => {
    expect(attainedAge('1986-03-01', '2026-02-28')).toBe(40);
    expect(socialInsurance(condition({ birthDate: '1986-03-01' }), '2026-01', '2026-01-31', D(300000)).nursing.toString()).toBe('0');
    expect(socialInsurance(condition({ birthDate: '1986-03-01' }), '2026-02', '2026-02-28', D(300000)).nursing.toString()).toBe('2385');
    expect(socialInsurance(condition({ birthDate: '1961-03-01' }), '2026-02', '2026-02-28', D(300000)).nursing.toString()).toBe('0');
    expect(socialInsurance(condition({ birthDate: '1961-03-02' }), '2026-02', '2026-02-28', D(300000)).nursing.toString()).toBe('2385');
  });
  it('does not invent enrollment grades or unsupported-year rates', () => {
    expect(() => socialInsurance(condition({ healthStandardMonthly: '310000' }), '2026-08', '2026-08-31', D(300000))).toThrow(/conditions/);
    expect(() => socialInsurance(condition(), '2027-01', '2027-01-31', D(300000))).toThrow(/conditions/);
    expect(HEALTH_GRADES).toHaveLength(50); expect(PENSION_GRADES).toHaveLength(32); expect(FISCAL_DATA.health.every((row) => row.percentages.length === 47)).toBe(true);
  });
  it('requires explicit exemption and keeps the agriculture employment worker rate', () => {
    const amounts = socialInsurance(condition({ healthMembership: 'exempt', healthStandardMonthly: null, pensionMembership: 'exempt', pensionStandardMonthly: null, employmentCategory: 'agriculture_sake' }), '2026-08', '2026-08-31', D(300000));
    expect(amounts.health.toString()).toBe('0'); expect(amounts.nursing.toString()).toBe('0'); expect(amounts.pension.toString()).toBe('0'); expect(amounts.employment.toString()).toBe('1800');
  });
  it('allows the shared child insurance and income-adjustment benefits without duplicating dependent deductions', () => {
    const facts = declaration({ relatives: [{ claimDependentDeduction: false, code: 'shared-child', birthDate: '2010-05-01', income: '0', cohabitingElderlyParent: false, disability: 'special', resident: true, sharedLivelihoodConfirmed: true, eligibilityConfirmed: true }], lifeNew: '120000', incomeAdjustmentEligible: true });
    const result = annualAdjustment(facts, D(8765432), D(1000000), D(500000));
    expect(result.deductions.relatives.toString()).toBe('0'); expect(result.deductions.disability.toString()).toBe('0'); expect(result.deductions.insurance.generalLife.toString()).toBe('60000'); expect(result.incomeAdjustment.toString()).toBe('26544');
  });
  it('calculates student, insurance, child and housing deductions from verified declaration facts', () => {
    expect(declarationDeductions(declaration({ student: true }), D(890000), D(0)).student.toString()).toBe('270000');
    expect(() => declarationDeductions(declaration({ student: true }), D(890001), D(0))).toThrow(/inconsistent/);
    const facts = declaration({ relatives: [{ claimDependentDeduction: true, code: 'child', birthDate: '2010-05-01', income: '0', cohabitingElderlyParent: false, disability: 'none', resident: true, sharedLivelihoodConfirmed: true, eligibilityConfirmed: true }], lifeNew: '120000', nursingLife: '80000', pensionLifeNew: '80000', housingTaxCredit: '100000' });
    const result = annualAdjustment(facts, D(3600000), D(600000), D(90000));
    expect(result.deductions.relatives.toString()).toBe('380000'); expect(result.deductions.insurance.generalLife.toString()).toBe('60000'); expect(result.deductions.life.toString()).toBe('120000'); expect(result.annualTax.toString()).toBe('0'); expect(result.refund.toString()).toBe('90000');
  });
});
