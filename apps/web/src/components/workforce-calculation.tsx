import type { PayrollSummary } from '../api/workforce.ts';
import { useLocale } from '../i18n.tsx';
import { formatDecimal } from '../lib/format.ts';
import { minutesLabel } from '../lib/workforce.ts';
import { FiscalCalculationEvidence } from './fiscal-calculation-evidence.tsx';
import { WorkforceMoney } from './workforce-shared.tsx';

const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r)) : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '—';
const amount = (value: unknown): string | null => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? value : null;

/** Render only documented calculation fields; employee/account/internal identifiers are never dumped as JSON. */
export function WorkforceCalculation({ row }: { row: PayrollSummary }) {
  const { t, locale } = useLocale(), calculation = row.calculation;
  const terms = records(calculation.terms), days = records(calculation.details), policies = records(calculation.policies);
  const duration = (value: unknown) => typeof value === 'number' ? minutesLabel(value / 60000, locale) : '—';
  return <details className="workforce-calculation"><summary>{t({ ja: '賃金条件・日別の計算根拠', en: 'Pay terms and daily calculation evidence' })}</summary>
    <p className="workforce-notice">{t({ ja: '保存された通常・変形・フレックスの勤務制度と日本円に基づく計算です。実時間で集計し、通常賃金と割増賃金の合計をそれぞれ1円単位で切り上げます。月給の期間按分は暦日数です。欠勤の調整は根拠を付けた明示的な控除で扱います。', en: 'Uses the saved ordinary, variable or flex working-time periods, in JPY. Exact time is aggregated before base and premium totals are each rounded up to whole yen. Monthly salary uses calendar-day proration. Absence adjustments need an explicit deduction and evidence.' })}</p>
    <FiscalCalculationEvidence calculation={calculation} /><div className="workforce-record-list">{terms.map((term, i) => <section className="workforce-record" key={i}><h3>{text(term.validFrom)} — {text(term.validTo)}</h3><p>{t(term.payType === 'monthly' ? { ja: '月給', en: 'Monthly salary' } : { ja: '時給', en: 'Hourly rate' })}: <WorkforceMoney value={amount(term.payType === 'monthly' ? term.monthlySalary : term.hourlyRate)} /></p><p>{text(term.basis)}</p></section>)}</div>
    {policies.map((policy, i) => <div className="workforce-record" key={i}><h3>{text(policy.name)}</h3><p>{t({ ja: '時間外・高率時間外・法定休日・深夜の加算率', en: 'Overtime / high overtime / statutory holiday / night premium rates' })}: {[policy.overtimePremiumRate, policy.highOvertimePremiumRate, policy.holidayPremiumRate, policy.nightPremiumRate].map((value) => amount(value) === null ? '—' : formatDecimal(String(value))).join(' / ')}</p><p>{text(policy.basis)}</p></div>)}
    <dl className="workforce-definition"><div><dt>{t({ ja: '対象の在籍期間', en: 'Employment interval' })}</dt><dd>{text(calculation.employmentStart)} — {text(calculation.employmentEnd)}</dd></div><div><dt>{t({ ja: '有給分の賃金', en: 'Paid leave pay' })}</dt><dd><WorkforceMoney value={amount(calculation.paidLeavePay)} /></dd></div></dl>
    <div className="workforce-record-list">{days.map((day, i) => <section className="workforce-record" key={i}><h3>{text(day.date)}</h3><p>{t(day.workSystem === 'flex' ? { ja: 'フレックス', en: 'Flex' } : day.workSystem === 'monthly_variable' ? { ja: '1か月変形', en: 'One-month variable' } : { ja: '通常勤務', en: 'Ordinary working time' })}</p><dl className="workforce-definition"><div><dt>{t({ ja: '労働時間', en: 'Worked time' })}</dt><dd>{duration(day.workedMs)}</dd></div><div><dt>{t({ ja: '時間外 / うち高率', en: 'Overtime / high rate' })}</dt><dd>{duration(day.overtimeMs)} / {duration(day.highOvertimeMs)}</dd></div><div><dt>{t({ ja: '法定休日 / 深夜', en: 'Statutory holiday / night' })}</dt><dd>{duration(day.holidayMs)} / {duration(day.nightMs)}</dd></div><div><dt>{t({ ja: '割増の時給基礎', en: 'Hourly premium basis' })}</dt><dd><WorkforceMoney value={amount(day.hourlyBasis)} /></dd></div><div><dt>{t({ ja: '通常賃金（集計前）', en: 'Base before aggregation' })}</dt><dd><WorkforceMoney value={amount(day.baseAmount)} /></dd></div><div><dt>{t({ ja: '割増賃金（集計前）', en: 'Premium before aggregation' })}</dt><dd><WorkforceMoney value={amount(day.premiumAmount)} /></dd></div></dl></section>)}</div>
  </details>;
}
