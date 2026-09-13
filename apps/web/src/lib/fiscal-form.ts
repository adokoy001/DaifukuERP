import type { YearEndDeclaration } from '../api/fiscal.ts';
import { formText } from '../api/workforce.ts';
const amount = (data: FormData, key: string) => formText(data, key);
const checked = (data: FormData, key: string) => data.get(key) === 'on';
export const yearEndMoneyFields = [
  'otherIncome',
  'studentNonSalaryIncome',
  'lifeNew',
  'lifeOld',
  'nursingLife',
  'pensionLifeNew',
  'pensionLifeOld',
  'earthquakePremium',
  'oldLongTermPremium',
  'personalSocialPremium',
  'smallEnterpriseContributions',
  'housingTaxCredit',
] as const;
export function declarationFromForm(
  data: FormData,
  counts: { spouse: boolean; relatives: number; previousEmployers: number; unpaidMonths: number },
): Record<string, unknown> {
  const relative = (prefix: string) => ({
    birthDate: formText(data, prefix + '.birthDate'),
    income: amount(data, prefix + '.income'),
    disability: formText(data, prefix + '.disability'),
    sharedLivelihoodConfirmed: checked(data, prefix + '.sharedLivelihoodConfirmed'),
    eligibilityConfirmed: checked(data, prefix + '.eligibilityConfirmed'),
  });
  return {
    taxYear: 2026,
    resident: checked(data, 'resident'),
    mainEmployer: checked(data, 'mainEmployer'),
    factsConfirmed: checked(data, 'factsConfirmed'),
    ...Object.fromEntries(yearEndMoneyFields.map((key) => [key, amount(data, key)])),
    spouse: counts.spouse
      ? { ...relative('spouse'), specialDeductionNotDuplicated: checked(data, 'spouse.specialDeductionNotDuplicated') }
      : null,
    relatives: Array.from({ length: counts.relatives }, (_, i) => ({
      ...relative(`relative${i}`),
      code: formText(data, `relative${i}.code`),
      resident: checked(data, `relative${i}.resident`),
      claimDependentDeduction: checked(data, `relative${i}.claimDependentDeduction`),
      cohabitingElderlyParent: checked(data, `relative${i}.cohabitingElderlyParent`),
    })),
    taxpayerDisability: formText(data, 'taxpayerDisability'),
    ...Object.fromEntries(
      [
        'widow',
        'singleParent',
        'student',
        'incomeAdjustmentEligible',
        'distinctEarthquakeContractsConfirmed',
        'housingEligibilityConfirmed',
      ].map((key) => [key, checked(data, key)]),
    ),
    previousEmployers: Array.from({ length: counts.previousEmployers }, (_, i) =>
      Object.fromEntries(
        ['name', 'taxablePay', 'socialPremium', 'incomeTax', 'evidence'].map((key) => [
          key,
          formText(data, `previous${i}.${key}`),
        ]),
      ),
    ),
    unpaidMonths: Array.from({ length: counts.unpaidMonths }, (_, i) => ({
      period: formText(data, `unpaid${i}.period`),
      reason: formText(data, `unpaid${i}.reason`),
    })),
    evidence: formText(data, 'evidence'),
  };
}
export type DeclarationRelative = YearEndDeclaration['relatives'][number];
