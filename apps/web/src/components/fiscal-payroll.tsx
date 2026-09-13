import { useState, type ReactNode } from 'react';
import type { FiscalBoard, PayrollRuleSummary, StatutoryPayrollInput } from '../api/fiscal.ts';
import type { PayrollSummary } from '../api/workforce.ts';
import { formText } from '../api/workforce.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { useLocale } from '../i18n.tsx';
import { businessToday } from '../lib/operations.ts';
import { dateInRuleRange, monthEnd, payrollPaymentRange, withinRuleRange } from '../lib/payroll-rules.ts';
import { WorkforceDialog } from './workforce-dialog.tsx';
import { FiscalCheck, FiscalMoneyField, FiscalSection } from './fiscal-fields.tsx';
import { FiscalArrayButtons } from './fiscal-declaration.tsx';
import { WorkforceMoney } from './workforce-shared.tsx';
function AllowanceFields({
  prefix,
  count,
  previous = [],
}: {
  prefix: string;
  count: number;
  previous?: StatutoryPayrollInput['taxableAllowances'];
}) {
  const { t } = useLocale();
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="fiscal-choice-card" key={i}>
          <label>
            {t({ ja: '手当の名称', en: 'Allowance name' })}
            <input
              className="input"
              name={`${prefix}${i}.name`}
              defaultValue={previous[i]?.name}
              required
              maxLength={100}
            />
          </label>
          <FiscalMoneyField
            name={`${prefix}${i}.amount`}
            label={{ ja: '金額（円）', en: 'Amount (JPY)' }}
            value={previous[i]?.amount ?? '0'}
          />
          <label>
            {t({ ja: '課税区分と支給の根拠', en: 'Tax treatment and payment basis' })}
            <input
              className="input"
              name={`${prefix}${i}.basis`}
              defaultValue={previous[i]?.basis}
              required
              maxLength={1000}
            />
          </label>
        </div>
      ))}
    </>
  );
}
export function FiscalPayrollCalculate({
  employee,
  period,
  original,
  current,
  rule,
  onClose,
}: {
  employee: FiscalBoard['employees'][number];
  period: string;
  original: PayrollSummary | undefined;
  current: PayrollSummary | undefined;
  rule: PayrollRuleSummary | undefined;
  onClose: () => void;
}) {
  const prior = (original?.calculation.statutory as { input?: StatutoryPayrollInput } | undefined)?.input;
  const { t } = useLocale(),
    task = useWorkforceTask(),
    [taxable, setTaxable] = useState(prior?.taxableAllowances.length ?? 0),
    [nonTaxable, setNonTaxable] = useState(prior?.nonTaxableAllowances.length ?? 0),
    [reviewedRule] = useState(rule);
  const range = reviewedRule && payrollPaymentRange(period, reviewedRule);
  const [paymentDate, setPaymentDate] = useState(
      prior?.paymentDate ?? (range ? dateInRuleRange(businessToday(), range) : ''),
    ),
    [insurancePeriod, setInsurancePeriod] = useState(prior?.insurancePeriod ?? period);
  const previousMonth = new Date(paymentDate.slice(0, 7) + '-01T00:00:00Z');
  previousMonth.setUTCDate(0);
  const datesSupported = Boolean(
    range &&
    reviewedRule &&
    withinRuleRange(paymentDate, range) &&
    withinRuleRange(insurancePeriod, reviewedRule.manifest.applicability.insuranceMonths) &&
    !Number.isNaN(previousMonth.getTime()) &&
    insurancePeriod >= previousMonth.toISOString().slice(0, 7) &&
    insurancePeriod <= paymentDate.slice(0, 7),
  );
  const ruleChanged =
    !rule || rule.manifestHash !== reviewedRule?.manifestHash || rule.payloadHash !== reviewedRule?.payloadHash;
  return (
    <WorkforceDialog
      title={t({ ja: '給与・税・保険料を自動算定', en: 'Calculate payroll, tax and insurance' })}
      description={employee.name + ' · ' + period}
      submitLabel={t({ ja: '根拠を確認して算定', en: 'Calculate with verified inputs' })}
      stale={(original?.version ?? 0) !== (current?.version ?? 0) || ruleChanged}
      readOnly={!datesSupported || ruleChanged}
      onClose={onClose}
      onSubmit={async (data) => {
        const allowances = (prefix: string, count: number) =>
          Array.from({ length: count }, (_, i) => ({
            name: formText(data, `${prefix}${i}.name`),
            amount: formText(data, `${prefix}${i}.amount`),
            basis: formText(data, `${prefix}${i}.basis`),
          }));
        await task.mutateAsync({
          action: 'workforce.calculate_statutory_payroll',
          input: {
            employeeId: employee.id,
            period,
            expectedVersion: original?.version ?? 0,
            paymentDate: formText(data, 'paymentDate'),
            insurancePeriod: formText(data, 'insurancePeriod'),
            taxableAllowances: allowances('taxable', taxable),
            nonTaxableAllowances: allowances('nonTaxable', nonTaxable),
            otherDeduction: { amount: formText(data, 'otherAmount'), basis: formText(data, 'otherBasis') },
            attendanceCompleteConfirmed: data.get('attendanceCompleteConfirmed') === 'on',
          },
        });
      }}
    >
      <p className="workforce-notice">
        {t({
          ja: '通常月額給与・居住者の甲欄・協会けんぽの対応範囲で計算します。賞与、乙欄、複数月の保険控除は対象外です。再算定では入力した手当・その他控除を今回の内容へ更新します。',
          en: 'Supported: regular monthly pay, resident category Ko, and Kyokai Kenpo. Bonuses, category Otsu and multi-month insurance deductions are excluded. Recalculation replaces allowances and other deductions with these inputs.',
        })}
      </p>
      {reviewedRule ? (
        <p className="account-help">
          {t({ ja: '使用する制度版', en: 'Rule package used' })}: {reviewedRule.packageCode} ·{' '}
          {t({ ja: '賃金締日は給与対象月の末日です。', en: 'The wage cutoff is the final day of the payroll month.' })}
        </p>
      ) : null}
      {!datesSupported ? (
        <p className="workforce-notice" role="status">
          {t({
            ja: '支払日または保険対象月がこの制度版の対応期間外です。対象日を確認してください。保険対象月は支払月かその前月を指定します。',
            en: 'The payment date or insurance month is outside this package’s supported periods. Use the payment month or its preceding month for insurance.',
          })}
        </p>
      ) : null}
      <div className="workforce-form-row">
        <label>
          {t({ ja: '給与支払日', en: 'Payment date' })}
          <input
            className="input"
            name="paymentDate"
            type="date"
            min={range?.from}
            max={range?.to}
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
            required
          />
        </label>
        <label>
          {t({ ja: '健康保険・厚生年金の対象月', en: 'Health / pension insurance month' })}
          <input
            className="input"
            name="insurancePeriod"
            type="month"
            value={insurancePeriod}
            min={reviewedRule?.manifest.applicability.insuranceMonths.from}
            max={reviewedRule?.manifest.applicability.insuranceMonths.to}
            onChange={(event) => setInsurancePeriod(event.target.value)}
            required
          />
        </label>
      </div>
      <FiscalSection title={{ ja: '課税手当', en: 'Taxable allowances' }}>
        <AllowanceFields prefix="taxable" count={taxable} previous={prior?.taxableAllowances ?? []} />
        <FiscalArrayButtons count={taxable} max={30 - nonTaxable} onChange={setTaxable} />
      </FiscalSection>
      <FiscalSection title={{ ja: '非課税手当', en: 'Non-taxable allowances' }}>
        <p>
          {t({
            ja: '通勤手当等の非課税要件と限度額を資料で確認してください。雇用保険の賃金基礎には含めます。',
            en: 'Verify non-taxable eligibility and limits against evidence. These amounts are included in the employment-insurance wage basis.',
          })}
        </p>
        <AllowanceFields prefix="nonTaxable" count={nonTaxable} previous={prior?.nonTaxableAllowances ?? []} />
        <FiscalArrayButtons count={nonTaxable} max={30 - taxable} onChange={setNonTaxable} />
      </FiscalSection>
      <FiscalMoneyField
        name="otherAmount"
        label={{ ja: 'その他控除（円）', en: 'Other deductions (JPY)' }}
        value={prior?.otherDeduction.amount ?? '0'}
      />
      <label>
        {t({ ja: 'その他控除の根拠（該当なしも明記）', en: 'Other deduction evidence, including none' })}
        <input
          className="input"
          name="otherBasis"
          defaultValue={prior?.otherDeduction.basis}
          required
          maxLength={1000}
        />
      </label>
      <FiscalCheck
        name="attendanceCompleteConfirmed"
        label={{
          ja: '対象期間の勤怠・有給・訂正・賃金条件と手当をすべて確認しました',
          en: 'I verified all attendance, leave, corrections, pay terms and allowances for the period',
        }}
        required
      />
    </WorkforceDialog>
  );
}
export function StatutoryPayrollConfirm({
  row,
  current,
  onClose,
  children,
}: {
  row: PayrollSummary;
  current: PayrollSummary | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useLocale(),
    task = useWorkforceTask();
  return (
    <WorkforceDialog
      title={t({ ja: '自動算定した給与を確定', en: 'Confirm automatically calculated payroll' })}
      description={row.employeeName + ' · ' + row.period}
      submitLabel={t({ ja: '根拠を確認して給与を確定', en: 'Verify evidence and confirm payroll' })}
      stale={current?.version !== row.version}
      onClose={onClose}
      onSubmit={async (data) => {
        await task.mutateAsync({
          action: 'workforce.confirm_payroll',
          input: {
            payrollId: row.id,
            expectedVersion: row.version,
            deductions: row.deductions,
            allowances: row.allowances,
            calculationConfirmed: data.get('calculationConfirmed') === 'on',
            reason: formText(data, 'reason'),
          },
        });
      }}
    >
      <p className="workforce-notice">
        {t({
          ja: '税・保険は保存済みの条件と制度値で計算されています。訂正が必要な場合は条件を確認し、給与を再計算してください。',
          en: 'Tax and insurance use saved conditions and rule values. To correct them, review conditions and recalculate payroll.',
        })}
      </p>
      {children}
      <div className="workforce-pay-total">
        <span>{t({ ja: '確定予定の差引支給額', en: 'Net pay to confirm' })}</span>
        <WorkforceMoney value={row.netPay} />
      </div>
      <label>
        {t({ ja: '確認記録', en: 'Review evidence' })}
        <textarea className="input" name="reason" maxLength={1000} required />
      </label>
      <FiscalCheck
        name="calculationConfirmed"
        label={{
          ja: '本人条件・支払日・保険月・税保険・手当と計算根拠を確認しました',
          en: 'I verified conditions, payment date, insurance month, tax, premiums, allowances and calculation evidence',
        }}
        required
      />
    </WorkforceDialog>
  );
}
export function FiscalPayrollEvidence({ row, onClose }: { row: PayrollSummary; onClose: () => void }) {
  const { t } = useLocale(),
    task = useWorkforceTask();
  return (
    <WorkforceDialog
      title={t({ ja: '既存給与の支払・課税証跡', en: 'Payment and tax evidence for existing payroll' })}
      description={row.employeeName + ' · ' + row.period}
      submitLabel={t({ ja: '確認済み証跡を登録', en: 'Register verified evidence' })}
      onClose={onClose}
      onSubmit={async (data) => {
        await task.mutateAsync({
          action: 'workforce.record_payroll_tax_evidence',
          input: {
            payrollId: row.id,
            paymentDate: formText(data, 'paymentDate'),
            taxablePay: formText(data, 'taxablePay'),
            basis: formText(data, 'basis'),
            verified: data.get('verified') === 'on',
          },
        });
      }}
    >
      <p>
        {t({
          ja: '手動確認した既存給与を年末調整へ集計するため、支払日と課税支給額を補足します。登録後の証跡訂正は元給与の取消・再確定が必要です。',
          en: 'Add payment date and taxable pay to include legacy payroll in year-end adjustment. Corrections later require cancelling and reconfirming the original payroll.',
        })}
      </p>
      <label>
        {t({ ja: '実際の支払日', en: 'Actual payment date' })}
        <input className="input" type="date" name="paymentDate" min={monthEnd(row.period)} required />
      </label>
      <FiscalMoneyField name="taxablePay" label={{ ja: '課税支給額', en: 'Taxable pay' }} value={row.grossPay} />
      <label>
        {t({ ja: '資料番号・確認根拠', en: 'Document references and evidence' })}
        <textarea className="input" name="basis" required maxLength={1000} />
      </label>
      <FiscalCheck
        name="verified"
        label={{ ja: '元資料と支払記録を確認しました', en: 'I verified the source documents and payment records' }}
        required
      />
    </WorkforceDialog>
  );
}
