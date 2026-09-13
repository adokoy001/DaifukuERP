import { useLocale } from '../i18n.tsx';
import { minutesLabel } from '../lib/workforce.ts';
import { WorkforceMoney } from './workforce-shared.tsx';
import { FiscalRuleEvidence } from './fiscal-rule-evidence.tsx';
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '—');
const money = (value: unknown) => (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? value : null);
/** Render the public evidence fields without dumping personnel IDs or internal snapshots. */
export function FiscalCalculationEvidence({ calculation }: { calculation: Record<string, unknown> }) {
  const { t, locale } = useLocale();
  const statutory = object(calculation.statutory),
    input = object(statutory.input),
    evidence = object(statutory.evidence),
    withholding = object(evidence.withholding),
    social = object(evidence.social);
  const systems = Array.isArray(calculation.workSystems) ? calculation.workSystems.map(object) : [];
  return (
    <>
      {systems.map((period, i) => (
        <section className="workforce-record" key={i}>
          <h3>
            {t({ ja: '適用する勤務制度', en: 'Applicable working-time system' })}:{' '}
            {t(
              period.mode === 'flex'
                ? { ja: 'フレックス', en: 'Flex' }
                : period.mode === 'monthly_variable'
                  ? { ja: '1か月変形', en: 'One-month variable' }
                  : { ja: '通常勤務', en: 'Ordinary' },
            )}
          </h3>
          <p>
            {text(period.startsOn)} — {text(period.endsOn)} ·{' '}
            {typeof period.agreedTotalMinutes === 'number' ? minutesLabel(period.agreedTotalMinutes, locale) : '—'}
          </p>
          <p>{text(period.agreementReference)}</p>
        </section>
      ))}
      {calculation.statutory ? (
        <section className="workforce-record">
          <h3>{t({ ja: '税・保険料の算定根拠', en: 'Tax and insurance calculation evidence' })}</h3>
          <FiscalRuleEvidence selection={evidence.ruleSelection} savedRule={evidence.rule} />
          <dl className="workforce-definition">
            <div>
              <dt>{t({ ja: '給与支払日 / 保険対象月', en: 'Payment date / insurance month' })}</dt>
              <dd>
                {text(input.paymentDate)} / {text(input.insurancePeriod)}
              </dd>
            </div>
            <div>
              <dt>{t({ ja: '課税支給額', en: 'Taxable pay' })}</dt>
              <dd>
                <WorkforceMoney value={money(evidence.taxablePay)} />
              </dd>
            </div>
            <div>
              <dt>{t({ ja: '社会保険料等の合計', en: 'Social insurance premiums' })}</dt>
              <dd>
                <WorkforceMoney value={money(social.total)} />
              </dd>
            </div>
            <div>
              <dt>{t({ ja: '社会保険料等控除後の給与', en: 'Pay after social insurance' })}</dt>
              <dd>
                <WorkforceMoney value={money(withholding.afterSocialPremium)} />
              </dd>
            </div>
            <div>
              <dt>
                {t({
                  ja: '給与所得控除 / 基礎控除 / 扶養控除（月次）',
                  en: 'Salary / basic / dependent deductions (monthly)',
                })}
              </dt>
              <dd>
                <WorkforceMoney value={money(withholding.salaryDeduction)} /> /{' '}
                <WorkforceMoney value={money(withholding.basicDeduction)} /> /{' '}
                <WorkforceMoney value={money(withholding.dependentDeduction)} />
              </dd>
            </div>
            <div>
              <dt>{t({ ja: '源泉所得税の計算対象額', en: 'Withholding calculation base' })}</dt>
              <dd>
                <WorkforceMoney value={money(withholding.taxableIncome)} />
              </dd>
            </div>
          </dl>
          <p>
            {t({
              ja: '甲欄の電算機計算の特例により算定。年末調整の年間控除とは計算期間と制度表が異なります。',
              en: 'Uses the category Ko electronic-calculation exception. Monthly withholding and year-end deductions use different periods and rule tables.',
            })}
          </p>
        </section>
      ) : null}
    </>
  );
}
