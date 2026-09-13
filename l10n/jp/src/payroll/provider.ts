import { registry, ValidationError } from '@daifuku/kernel';
import {
  PAYROLL_RULE_PROVIDERS_OVERRIDE,
  payloadHash,
  manifestHash,
  type CountryPayrollProvider,
  type PayrollRuleBundle,
  type PayrollRuleProviders,
} from '@daifuku/mod-workforce';
import { JAPAN_PAYROLL_BUNDLES } from './catalog.ts';
import { parseJapanPayrollRules } from './schema.ts';
import { monthlyWithholding } from './algorithms/regular-v1/monthly-tax.ts';
import { socialInsurance, validateCondition } from './algorithms/regular-v1/social-insurance.ts';
import { annualAdjustment } from './algorithms/regular-v1/annual-tax.ts';

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** A closed distribution allowlist. Tests can construct an isolated synthetic distribution without registering it. */
export function createJapanPayrollProvider(distribution: readonly PayrollRuleBundle[]): CountryPayrollProvider {
  const bundles = freeze(structuredClone(distribution));
  const allowed = bundles.map((bundle) => {
    parseJapanPayrollRules(bundle);
    return { code: bundle.code, payloadHash: payloadHash(bundle), manifestHash: manifestHash(bundle.manifest) };
  });
  if (new Set(allowed.map((entry) => entry.code)).size !== allowed.length)
    throw new ValidationError('Duplicate Japan payroll package code', [
      { path: 'rules', message: 'A distribution code must identify exactly one release.' },
    ]);

  function checked(bundle: PayrollRuleBundle) {
    const rules = parseJapanPayrollRules(bundle);
    const release = allowed.find((entry) => entry.code === bundle.code);
    if (
      !release ||
      release.payloadHash !== payloadHash(bundle) ||
      release.manifestHash !== manifestHash(bundle.manifest)
    )
      throw new ValidationError('Japan payroll package is not in the verified distribution', [
        { path: 'rules', message: 'Install a supported package with its original payload and manifest.' },
      ]);
    return rules;
  }

  return Object.freeze({
    id: 'jp-regular',
    country: 'JP',
    currency: 'JPY',
    bundles: () => bundles,
    validate: (bundle) => {
      checked(bundle);
    },
    validateCondition: (bundle, condition) => validateCondition(checked(bundle), condition),
    monthly: (bundle, pay, social, dependents) => monthlyWithholding(checked(bundle), pay, social, dependents),
    insurance: (bundle, condition, insurancePeriod, wageCutoff, wage) =>
      socialInsurance(checked(bundle), condition, insurancePeriod, wageCutoff, wage),
    annual: (bundle, declaration, pay, social, withheldTax) =>
      annualAdjustment(checked(bundle), declaration, pay, social, withheldTax),
  } satisfies CountryPayrollProvider);
}

export const JAPAN_PAYROLL_PROVIDER = createJapanPayrollProvider(JAPAN_PAYROLL_BUNDLES);

export function registerJapanPayrollProvider(): void {
  const providers: PayrollRuleProviders = () => [JAPAN_PAYROLL_PROVIDER];
  registry.registerOverride(PAYROLL_RULE_PROVIDERS_OVERRIDE, providers);
}
