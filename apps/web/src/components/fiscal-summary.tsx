import type { FiscalBoard, YearEndDeclaration } from '../api/fiscal.ts';
import { useLocale } from '../i18n.tsx';
import { WorkforceMoney } from './workforce-shared.tsx';
import type { FiscalLabel } from './fiscal-fields.tsx';
import { FiscalRuleEvidence } from './fiscal-rule-evidence.tsx';
const amountLabels: Record<string, FiscalLabel> = {
  taxablePay: { ja: '年間課税支給額', en: 'Annual taxable pay' },
  salaryBeforeAdjustment: { ja: '給与所得金額（調整前）', en: 'Salary income before adjustment' },
  incomeAdjustment: { ja: '所得金額調整控除', en: 'Salary income adjustment' },
  salaryIncome: { ja: '給与所得金額', en: 'Salary income' },
  totalIncome: { ja: '合計所得金額', en: 'Total income' },
  taxableIncome: { ja: '課税給与所得金額', en: 'Taxable salary income' },
  beforeCredit: { ja: '住宅控除前の税額', en: 'Tax before housing credit' },
  housingTaxCredit: { ja: '住宅控除額', en: 'Housing credit' },
  afterCredit: { ja: '住宅控除後の税額', en: 'Tax after housing credit' },
  annualTax: { ja: '年調年税額（復興特別所得税込）', en: 'Annual tax including reconstruction surtax' },
  withheldTax: { ja: '源泉徴収済み税額', en: 'Tax already withheld' },
  refund: { ja: '還付額', en: 'Refund' },
  additionalTax: { ja: '追加徴収額', en: 'Additional withholding' },
  basic: { ja: '基礎控除', en: 'Basic deduction' },
  spouse: { ja: '配偶者（特別）控除', en: 'Spouse deduction' },
  relatives: { ja: '扶養・特定親族特別控除', en: 'Dependant deductions' },
  disability: { ja: '障害者控除', en: 'Disability deduction' },
  widowOrSingleParent: { ja: '寡婦・ひとり親控除', en: 'Widow / single-parent deduction' },
  student: { ja: '勤労学生控除', en: 'Working-student deduction' },
  social: { ja: '社会保険料控除', en: 'Social premium deduction' },
  smallEnterprise: { ja: '小規模企業共済等掛金控除', en: 'Small enterprise contribution deduction' },
  life: { ja: '生命保険料控除', en: 'Life premium deduction' },
  earthquake: { ja: '地震保険料控除', en: 'Earthquake premium deduction' },
  total: { ja: '所得控除合計', en: 'Total income deductions' },
};
export function FiscalCalculation({ row }: { row: FiscalBoard['adjustments'][number] }) {
  const { t } = useLocale();
  const calculation = row.calculation;
  const deductions =
    typeof calculation.deductions === 'object' && calculation.deductions !== null
      ? (calculation.deductions as Record<string, unknown>)
      : {};
  const source =
    calculation.source && typeof calculation.source === 'object' ? (calculation.source as Record<string, unknown>) : {};
  const values = (source: Record<string, unknown>) =>
    Object.entries(source)
      .filter(([key, value]) => amountLabels[key] && typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value))
      .map(([key, value]) => (
        <div key={key}>
          <dt>{t(amountLabels[key] as FiscalLabel)}</dt>
          <dd>
            <WorkforceMoney value={String(value)} />
          </dd>
        </div>
      ));
  return (
    <div className="fiscal-evidence">
      <p>
        {t({
          ja: `${row.taxYear}年分の年末調整。確定給与・本人申告・源泉徴収票と、計算時に保存した制度資料に基づく結果です。`,
          en: `Year-end adjustment for ${row.taxYear}, using saved confirmed payroll, declarations, withholding statements and the rules saved at calculation time.`,
        })}
      </p>
      <FiscalRuleEvidence selection={source.ruleSelection} savedRule={source.rules} annual />
      <dl className="workforce-definition">{values(calculation)}</dl>
      <h4>{t({ ja: '所得控除の内訳', en: 'Income deduction breakdown' })}</h4>
      <dl className="workforce-definition">{values(deductions)}</dl>
    </div>
  );
}
const factsLabels: Record<string, FiscalLabel> = {
  otherIncome: { ja: '給与以外の所得', en: 'Other income' },
  studentNonSalaryIncome: { ja: '勤労によらない所得', en: 'Non-earned income' },
  lifeNew: { ja: '新一般生命保険料', en: 'New life premium' },
  lifeOld: { ja: '旧一般生命保険料', en: 'Old life premium' },
  nursingLife: { ja: '介護医療保険料', en: 'Medical premium' },
  pensionLifeNew: { ja: '新個人年金保険料', en: 'New pension premium' },
  pensionLifeOld: { ja: '旧個人年金保険料', en: 'Old pension premium' },
  earthquakePremium: { ja: '地震保険料', en: 'Earthquake premium' },
  oldLongTermPremium: { ja: '旧長期損害保険料', en: 'Old long-term premium' },
  personalSocialPremium: { ja: '本人支払社会保険料', en: 'Personal social premiums' },
  smallEnterpriseContributions: { ja: '小規模企業共済等掛金', en: 'Small enterprise contributions' },
  housingTaxCredit: { ja: '住宅控除額', en: 'Housing credit' },
  resident: { ja: '居住者', en: 'Resident' },
  mainEmployer: { ja: '主たる勤務先', en: 'Main employer' },
  factsConfirmed: { ja: '資料確認済み', en: 'Facts verified' },
  widow: { ja: '寡婦', en: 'Widow' },
  singleParent: { ja: 'ひとり親', en: 'Single parent' },
  student: { ja: '勤労学生', en: 'Working student' },
  incomeAdjustmentEligible: { ja: '所得金額調整の適用確認', en: 'Income adjustment eligible' },
  distinctEarthquakeContractsConfirmed: { ja: '保険契約の非重複確認', en: 'No duplicate insurance contracts' },
  housingEligibilityConfirmed: { ja: '住宅控除要件確認', en: 'Housing eligibility verified' },
};
const disabilityLabels: Record<string, FiscalLabel> = {
  none: { ja: '該当なし', en: 'None' },
  ordinary: { ja: '一般障害者', en: 'Disability' },
  special: { ja: '特別障害者', en: 'Special disability' },
  cohabiting_special: { ja: '同居特別障害者', en: 'Cohabiting special disability' },
};
export function FiscalDeclarationSummary({ declaration }: { declaration: YearEndDeclaration }) {
  const { t } = useLocale();
  return (
    <div className="fiscal-evidence">
      <dl className="workforce-definition">
        {Object.entries(factsLabels).map(([key, label]) => {
          const value = declaration[key as keyof YearEndDeclaration];
          return (
            <div key={key}>
              <dt>{t(label)}</dt>
              <dd>
                {typeof value === 'boolean' ? (
                  t(value ? { ja: 'はい', en: 'Yes' } : { ja: 'いいえ', en: 'No' })
                ) : (
                  <WorkforceMoney value={String(value)} />
                )}
              </dd>
            </div>
          );
        })}
        <div>
          <dt>{t({ ja: '本人の障害者区分', en: 'Taxpayer disability' })}</dt>
          <dd>{t(disabilityLabels[declaration.taxpayerDisability] as FiscalLabel)}</dd>
        </div>
      </dl>
      <div className="fiscal-rows">
        {[
          ...(declaration.spouse ? [{ ...declaration.spouse, code: t({ ja: '配偶者', en: 'Spouse' }) }] : []),
          ...declaration.relatives,
        ].map((relative, i) => (
          <article className="workforce-record" key={i}>
            <h4>
              {relative.code} · {relative.birthDate}
            </h4>
            <p>
              {t({ ja: '所得', en: 'Income' })}: <WorkforceMoney value={relative.income} /> ·{' '}
              {t(disabilityLabels[relative.disability] as FiscalLabel)}
            </p>
            {'claimDependentDeduction' in relative ? (
              <p>
                {t(
                  relative.claimDependentDeduction
                    ? {
                        ja: 'この本人が扶養・特定親族・障害者控除を申告',
                        en: 'This taxpayer claims dependent, specified-relative or disability deductions',
                      }
                    : {
                        ja: 'この本人は扶養等の控除を申告しない（子の特例判定には使用）',
                        en: 'This taxpayer does not claim dependent deductions; children may still count for special eligibility',
                      },
                )}
              </p>
            ) : null}
            {'cohabitingElderlyParent' in relative && relative.cohabitingElderlyParent ? (
              <p>{t({ ja: '同居老親等', en: 'Cohabiting elderly parent' })}</p>
            ) : null}
          </article>
        ))}
      </div>
      {declaration.previousEmployers.map((employer, i) => (
        <article className="workforce-record" key={i}>
          <h4>{employer.name}</h4>
          <p>
            {t({ ja: '前職支払額 / 社会保険料 / 源泉徴収額', en: 'Previous pay / social premiums / withholding' })}:{' '}
            {employer.taxablePay} / {employer.socialPremium} / {employer.incomeTax}
          </p>
          <p>{employer.evidence}</p>
        </article>
      ))}
      {declaration.unpaidMonths.map((month) => (
        <p key={month.period}>
          {month.period} · {t({ ja: '無支払', en: 'No payment' })} · {month.reason}
        </p>
      ))}
      <p>{declaration.evidence}</p>
    </div>
  );
}
