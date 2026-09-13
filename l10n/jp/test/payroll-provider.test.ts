import { describe, expect, it } from 'vitest';
import { Decimal } from '@daifuku/kernel';
import { payloadHash, type PayrollRuleBundle } from '@daifuku/mod-workforce';
import { JAPAN_PAYROLL_PROVIDER, createJapanPayrollProvider } from '../src/payroll/provider.ts';
import { parseJapanPayrollRules, payrollDataSchema, type JapanPayrollRules } from '../src/payroll/schema.ts';
import { declarationDeductions } from '../src/payroll/algorithms/regular-v1/annual-deductions.ts';
import { condition, declaration } from './payroll-fixtures.ts';

const D = Decimal.from;
function legacyBundle(): PayrollRuleBundle {
  const bundle = JAPAN_PAYROLL_PROVIDER.bundles()[0];
  if (!bundle) throw new Error('Missing legacy distribution fixture');
  return structuredClone(bundle);
}

/** Deliberately fictitious. This distribution is never imported or registered by production code. */
function futureBundle(change?: (rules: JapanPayrollRules) => void): PayrollRuleBundle {
  const original = legacyBundle();
  const bundle = JSON.parse(JSON.stringify(original), (_key: string, value: unknown) => {
    if (typeof value !== 'string' || !/^202[567]-\d{2}(?:-\d{2})?$/.test(value)) return value;
    return `${Number(value.slice(0, 4)) + 11}${value.slice(4)}`;
  }) as PayrollRuleBundle;
  const data = payrollDataSchema.parse(bundle.data);
  bundle.code = data.code = bundle.manifest.packageCode = 'synthetic-2037-not-law';
  bundle.taxYear = data.taxYear = bundle.manifest.taxYear = data.annualTax.year = data.deductions.year = 2037;
  bundle.sources = ['https://example.invalid/synthetic-payroll-not-law'];
  data.monthlyMethod = 'synthetic-monthly';
  data.annualMethod = 'synthetic-annual';
  const parameters = { ...bundle.manifest.parameters };
  delete parameters.legacySnapshotSchema;
  bundle.manifest.parameters = parameters;
  bundle.data = data;
  const rules = parseJapanPayrollRules(bundle);
  change?.(rules);
  return { ...bundle, data: rules.data, manifest: rules.manifest };
}

describe('Japan payroll distribution and database payload boundary', () => {
  it('keeps the legacy payload identity including string rates, source order and verification date', () => {
    // Captured from the old fiscal-data.ts exports before their removal, using canonical payload hashing.
    expect(payloadHash(legacyBundle())).toBe('f4ec1efa802b83420efd08b7315884af5fc7da541900542e73ddb3c0a7800f65');
    expect(JAPAN_PAYROLL_PROVIDER.bundles().map((bundle) => bundle.taxYear)).toEqual([2026]);
    expect(legacyBundle().manifest.parameters.legacySnapshotSchema).toBe(1);
  });

  it('protects the distribution from mutations through a returned catalog', () => {
    expect(Object.isFrozen(JAPAN_PAYROLL_PROVIDER.bundles())).toBe(true);
    const bundle = JAPAN_PAYROLL_PROVIDER.bundles()[0];
    expect(Object.isFrozen(bundle?.data)).toBe(true);
    expect(Object.isFrozen(bundle?.manifest.parameters)).toBe(true);
  });

  it('uses another year and its age fact date without changing the regular algorithm', () => {
    const bundle = futureBundle();
    const provider = createJapanPayrollProvider([bundle]);
    const databaseBundle = structuredClone(bundle);
    const facts = declaration({
      taxYear: 2037,
      relatives: [
        {
          code: 'synthetic-child',
          birthDate: '2021-05-01',
          income: '0',
          claimDependentDeduction: true,
          cohabitingElderlyParent: false,
          disability: 'none',
          resident: true,
          sharedLivelihoodConfirmed: true,
          eligibilityConfirmed: true,
        },
      ],
    });
    const result = provider.annual(databaseBundle, facts, D(3600000), D(600000), D(90000));
    expect(result.deductions.relatives.toString()).toBe('380000');
    expect(result.annualTax.toString()).toBe('21400');
    expect(result.method).toBe('synthetic-annual');
    expect(databaseBundle.manifest.parameters.legacySnapshotSchema).toBeUndefined();
    expect(() => JAPAN_PAYROLL_PROVIDER.validate(databaseBundle)).toThrow(/distribution/);
  });

  it('passes changed monthly, insurance and annual data through the same algorithms', () => {
    const bundle = futureBundle(({ data, manifest }) => {
      data.monthlyTax.dependent = 100000;
      for (const row of data.health) row.percentages = row.percentages.map(() => '8.00');
      for (const row of data.employment) row.general = '0.009';
      data.pensionPercent = '12';
      data.annualTax.basic = data.annualTax.basic.map(([upper]) => [upper, 1200000]);
      manifest.parameters.insurance.nursingAgeFrom = 60;
    });
    const provider = createJapanPayrollProvider([bundle]);
    const databaseBundle = structuredClone(bundle);
    expect(provider.monthly(databaseBundle, D(300000), D(45000), 1).incomeTax.toString()).toBe('1200');
    const insurance = provider.insurance(
      databaseBundle,
      condition({ validTo: '2037-12-31' }),
      '2037-08',
      '2037-08-31',
      D(300000),
    );
    expect(insurance.health.toString()).toBe('12000');
    expect(insurance.nursing.toString()).toBe('0');
    expect(insurance.pension.toString()).toBe('18000');
    expect(insurance.employment.toString()).toBe('2700');
    expect(insurance.total.toString()).toBe('33045');
    const annual = provider.annual(databaseBundle, declaration({ taxYear: 2037 }), D(3600000), D(600000), D(90000));
    expect(annual.deductions.basic.toString()).toBe('1200000');
    expect(annual.annualTax.toString()).toBe('32600');
  });

  it('takes life coefficients and the old earthquake divisor from manifest parameters', () => {
    const bundle = futureBundle(({ manifest }) => {
      manifest.parameters.life.secondDivisor = '4';
      manifest.parameters.oldEarthquakeDivisor = '4';
    });
    const result = declarationDeductions(
      parseJapanPayrollRules(bundle),
      declaration({ taxYear: 2037, lifeNew: '30000', oldLongTermPremium: '15000' }),
      D(1000000),
      D(0),
    );
    expect(result.insurance.generalLife.toString()).toBe('17500');
    expect(result.earthquake.toString()).toBe('8750');
  });

  it('uses the installed insurance sharing and rounding parameters', () => {
    const bundle = futureBundle(({ manifest }) => {
      manifest.parameters.insurance.employeePercentDivisor = '400';
      manifest.parameters.insurance.roundingThreshold = '0.1';
    });
    const provider = createJapanPayrollProvider([bundle]);
    const result = provider.insurance(bundle, condition({ validTo: '2037-12-31' }), '2037-08', '2037-08-31', D(300100));
    expect(result.health.toString()).toBe('7388');
    expect(result.employment.toString()).toBe('1501');
  });

  it('rejects declaration facts for another tax year', () => {
    expect(() =>
      JAPAN_PAYROLL_PROVIDER.annual(legacyBundle(), declaration({ taxYear: 2037 }), D(3600000), D(600000), D(90000)),
    ).toThrow(/selected tax year/);
  });

  it('rejects a changed database payload or manifest even when it remains structurally valid', () => {
    const bundle = legacyBundle();
    const data = payrollDataSchema.parse(bundle.data);
    data.monthlyTax.dependent += 1;
    bundle.data = data;
    expect(() => JAPAN_PAYROLL_PROVIDER.monthly(bundle, D(300000), D(45000), 1)).toThrow(/distribution/);
    const changedManifest = legacyBundle();
    changedManifest.manifest.revision += 1;
    expect(() => JAPAN_PAYROLL_PROVIDER.validate(changedManifest)).toThrow(/distribution/);
  });

  it.each([
    'algorithm',
    'rounding',
    'schema',
    'missing',
    'grade-order',
    'band-order',
    'overlap',
    'gap',
    'period',
    'year',
    'numeric-rate',
  ])('rejects %s in a proposed distribution', (fault) => {
    const bundle = futureBundle();
    const rules = parseJapanPayrollRules(bundle);
    const data = rules.data;
    if (fault === 'algorithm') bundle.manifest.algorithmVersion = 'unknown';
    if (fault === 'schema') bundle.manifest.dataSchema = 'unknown';
    if (fault === 'rounding') bundle.manifest.parameters = { ...bundle.manifest.parameters, rounding: {} };
    if (fault === 'missing') data.health = [];
    if (fault === 'grade-order') data.healthGrades.reverse();
    if (fault === 'band-order') data.monthlyTax.tax.reverse();
    if (fault === 'overlap' && data.health[1]) data.health[1].from = '2037-02';
    if (fault === 'gap' && data.health[1]) data.health[1].from = '2037-04';
    if (fault === 'period') bundle.manifest.applicability.paymentDates.to = '2038-01-01';
    if (fault === 'year') data.deductions.year -= 1;
    if (fault === 'numeric-rate') bundle.data = { ...data, pensionPercent: 12 };
    else bundle.data = data;
    expect(() => createJapanPayrollProvider([bundle])).toThrow(/Invalid Japan payroll rules/);
  });
});
