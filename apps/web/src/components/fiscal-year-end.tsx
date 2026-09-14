import { useState } from 'react';
import type { FiscalBoard, PayrollRuleSummary } from '../api/fiscal.ts';
import { formText } from '../api/workforce.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { useLocale } from '../i18n.tsx';
import { businessToday } from '../lib/operations.ts';
import { dateInRuleRange, withinRuleRange } from '../lib/payroll-rules.ts';
import { FiscalCheck } from './fiscal-fields.tsx';
import { FiscalCalculation, FiscalDeclarationSummary } from './fiscal-summary.tsx';
import { WorkforceDialog } from './workforce-dialog.tsx';
import { WorkforceEmpty, WorkforceMoney, WorkforcePanel, WorkforceStatus } from './workforce-shared.tsx';
type Declaration = FiscalBoard['declarations'][number];
type Adjustment = FiscalBoard['adjustments'][number];
type Decision = { kind: 'review'; row: Declaration } | { kind: 'confirm' | 'cancel' | 'settle'; row: Adjustment };
function YearEndDecision({
  decision,
  currentVersion,
  onClose,
}: {
  decision: Decision;
  currentVersion: number | undefined;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const task = useWorkforceTask();
  const kind = decision.kind;
  const title = t(
    kind === 'review'
      ? { ja: '申告内容と証明資料を確認', en: 'Review declaration and evidence' }
      : kind === 'confirm'
        ? { ja: '年末調整を確定', en: 'Confirm year-end adjustment' }
        : kind === 'cancel'
          ? { ja: '年末調整を取消', en: 'Cancel year-end adjustment' }
          : { ja: '還付・追加徴収を記録', en: 'Record refund / additional collection' },
  );
  return (
    <WorkforceDialog
      title={title}
      submitLabel={title}
      onClose={onClose}
      stale={currentVersion !== decision.row.version}
      onSubmit={async (data) => {
        const input =
          kind === 'review'
            ? {
                declarationId: decision.row.id,
                expectedVersion: decision.row.version,
                decision: formText(data, 'decision'),
                reason: formText(data, 'reason'),
              }
            : {
                adjustmentId: decision.row.id,
                expectedVersion: decision.row.version,
                ...(kind === 'settle'
                  ? { settledOn: formText(data, 'settledOn'), reference: formText(data, 'reason') }
                  : {
                      reason: formText(data, 'reason'),
                      ...(kind === 'confirm'
                        ? { calculationConfirmed: data.get('calculationConfirmed') === 'on' }
                        : {}),
                    }),
              };
        await task.mutateAsync({
          action: kind === 'review' ? 'workforce.review_year_end_declaration' : `workforce.${kind}_year_end_adjustment`,
          input,
        });
      }}
    >
      {decision.kind === 'review' ? (
        <>
          <FiscalDeclarationSummary declaration={decision.row.declaration} />
          <label>
            {t({ ja: '確認結果', en: 'Review outcome' })}
            <select className="input" name="decision" required>
              <option value="accept">{t({ ja: '資料を確認して受付', en: 'Accept verified declaration' })}</option>
              <option value="return">{t({ ja: '本人へ差戻し', en: 'Return to employee' })}</option>
            </select>
          </label>
        </>
      ) : (
        <FiscalCalculation row={decision.row} />
      )}
      {kind === 'settle' ? (
        <label>
          {t({ ja: '実際の精算日', en: 'Actual settlement date' })}
          <input
            className="input"
            type="date"
            name="settledOn"
            max={businessToday()}
            defaultValue={businessToday()}
            required
          />
        </label>
      ) : null}
      <label>
        {t(
          kind === 'settle'
            ? { ja: '振込・給与精算等の実行記録', en: 'Bank transfer / payroll settlement reference' }
            : { ja: '確認根拠・理由', en: 'Evidence / reason' },
        )}
        <textarea className="input" name="reason" maxLength={1000} required rows={3} />
      </label>
      {kind === 'confirm' ? (
        <FiscalCheck
          name="calculationConfirmed"
          label={{
            ja: '年間給与・本人申告・控除・税額・還付徴収額を確認しました',
            en: 'I verified annual pay, declarations, deductions, tax and refund / collection amounts',
          }}
          required
        />
      ) : null}
    </WorkforceDialog>
  );
}
function YearEndCalculate({
  taxYear,
  rule,
  employee,
  prior,
  current,
  onClose,
}: {
  taxYear: number;
  rule: PayrollRuleSummary | undefined;
  employee: FiscalBoard['employees'][number];
  prior: Adjustment | undefined;
  current: Adjustment | undefined;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const task = useWorkforceTask();
  const [reviewedRule] = useState(rule);
  const range = reviewedRule?.manifest.applicability.adjustmentDates;
  const [adjustedOn, setAdjustedOn] = useState(range ? dateInRuleRange(businessToday(), range) : '');
  const ruleChanged =
    !rule || rule.manifestHash !== reviewedRule?.manifestHash || rule.payloadHash !== reviewedRule?.payloadHash;
  const supported = Boolean(range && withinRuleRange(adjustedOn, range) && adjustedOn <= businessToday());
  return (
    <WorkforceDialog
      title={t({ ja: `${taxYear}年末調整を計算`, en: `Calculate ${taxYear} year-end adjustment` })}
      description={employee.name}
      submitLabel={t({ ja: '年間資料から計算', en: 'Calculate from annual evidence' })}
      onClose={onClose}
      stale={(prior?.version ?? 0) !== (current?.version ?? 0) || ruleChanged}
      readOnly={!supported || ruleChanged}
      onSubmit={async (data) => {
        await task.mutateAsync({
          action: 'workforce.calculate_year_end_adjustment',
          input: {
            employeeId: employee.id,
            taxYear,
            expectedVersion: prior?.version ?? 0,
            adjustedOn: formText(data, 'adjustedOn'),
            annualPayrollCompleteConfirmed: data.get('annualPayrollCompleteConfirmed') === 'on',
          },
        });
      }}
    >
      <p>
        {t({
          ja: '通常の年末調整と制度版の対応期間内の再調整を計算します。確定給与の支払証跡、前職資料、無支払月と受付済み申告が必要です。未来日・年途中退職等の例外年調は対象外です。源泉徴収票の交付状況も確認してください。',
          en: 'Calculate ordinary year-end adjustments within the supported dates. Confirmed payment evidence, previous-employer statements, unpaid months and accepted declarations are required. Future dates and exceptional mid-year adjustments are excluded. Check withholding-statement issuance too.',
        })}
      </p>
      {reviewedRule && range ? (
        <p className="account-help">
          {reviewedRule.packageCode} · {range.from} → {range.to}
        </p>
      ) : null}
      {!supported ? (
        <p className="workforce-notice" role="status">
          {t({
            ja: '制度版の対応期間内で、今日以前の年末調整日を指定してください。',
            en: 'Choose an adjustment date within the package’s supported dates and no later than today.',
          })}
        </p>
      ) : null}
      <label>
        {t({ ja: '年末調整日', en: 'Adjustment date' })}
        <input
          className="input"
          type="date"
          name="adjustedOn"
          min={range?.from}
          max={range ? (businessToday() < range.to ? businessToday() : range.to) : businessToday()}
          value={adjustedOn}
          onChange={(event) => setAdjustedOn(event.target.value)}
          required
        />
      </label>
      <FiscalCheck
        name="annualPayrollCompleteConfirmed"
        label={{
          ja: '対象年の給与支払・社会保険・税額・本人申告が揃い、年間給与の処理が完了しています',
          en: 'All annual payroll payments, premiums, withholding and declarations are complete',
        }}
        required
      />
    </WorkforceDialog>
  );
}
export function FiscalYearEnd({
  data,
  rule,
  employeeId,
  selfEmployeeId,
}: {
  data: FiscalBoard;
  rule: PayrollRuleSummary | undefined;
  employeeId: string;
  selfEmployeeId?: string;
}) {
  const { t } = useLocale();
  const [decision, setDecision] = useState<Decision>();
  const [calculate, setCalculate] = useState<{ employee: FiscalBoard['employees'][number]; prior?: Adjustment }>();
  const employees = data.employees.filter((employee) => !employeeId || employee.id === employeeId);
  const availableFrom = rule?.manifest.applicability.adjustmentDates.from;
  return (
    <WorkforcePanel
      title={t({ ja: '申告受付・年末調整・精算', en: 'Declarations, year-end calculation and settlement' })}
      icon="document"
    >
      {!employees.length ? (
        <WorkforceEmpty>{t({ ja: '従業員を登録してください。', en: 'Register an employee to begin.' })}</WorkforceEmpty>
      ) : (
        employees.map((employee) => {
          const declaration = data.declarations.find((row) => row.employeeId === employee.id);
          const adjustments = data.adjustments.filter((row) => row.employeeId === employee.id);
          const prior = adjustments.find((row) => row.status === 'draft');
          const frozen = adjustments.some((row) => row.status === 'confirmed');
          return (
            <article className="workforce-record" key={employee.id}>
              <header>
                <h3>
                  {employee.code} · {employee.name}
                </h3>
                {declaration ? (
                  <WorkforceStatus status={declaration.status} />
                ) : (
                  <span>{t({ ja: '未提出', en: 'Not submitted' })}</span>
                )}
              </header>
              {declaration ? (
                <details>
                  <summary>{t({ ja: '本人申告を見る', en: 'View employee declaration' })}</summary>
                  <FiscalDeclarationSummary declaration={declaration.declaration} />
                  {declaration.reviewReason ? <p>{declaration.reviewReason}</p> : null}
                </details>
              ) : null}
              <div className="workforce-record-actions">
                {declaration?.status === 'submitted' ? (
                  <button
                    className="btn"
                    disabled={employee.id === selfEmployeeId || frozen}
                    onClick={() => setDecision({ kind: 'review', row: declaration })}
                  >
                    {t({ ja: '申告を確認・受付', en: 'Review declaration' })}
                  </button>
                ) : null}
                <button
                  className="btn btn-primary"
                  disabled={
                    declaration?.status !== 'accepted' ||
                    frozen ||
                    employee.id === selfEmployeeId ||
                    !availableFrom ||
                    businessToday() < availableFrom
                  }
                  onClick={() => setCalculate({ employee, ...(prior ? { prior } : {}) })}
                >
                  {t({ ja: '年末調整を計算', en: 'Calculate year-end adjustment' })}
                </button>
              </div>
              {!availableFrom || businessToday() < availableFrom ? (
                <p className="account-help">
                  {t({
                    ja: availableFrom
                      ? `年末調整の計算は${availableFrom}以降に利用できます。申告と条件の準備は先に進められます。`
                      : 'この税年を計算できる導入済み制度がありません。制度の対応期間と導入状況を確認してください。',
                    en: availableFrom
                      ? `Year-end calculation opens on ${availableFrom}. Declarations and conditions can be prepared now.`
                      : 'No installed package supports this tax year. Check package periods and installation status.',
                  })}
                </p>
              ) : null}
              {adjustments.map((row) => (
                <section className="fiscal-choice-card" key={row.id}>
                  <header>
                    <WorkforceStatus status={row.status} /> {row.adjustedOn}
                  </header>
                  <div className="workforce-record-meta">
                    <span>
                      {t({ ja: '還付', en: 'Refund' })}: <WorkforceMoney value={row.refund} />
                    </span>
                    <span>
                      {t({ ja: '追加徴収', en: 'Additional collection' })}: <WorkforceMoney value={row.additionalTax} />
                    </span>
                  </div>
                  <details>
                    <summary>{t({ ja: '計算根拠を見る', en: 'Review calculation' })}</summary>
                    <FiscalCalculation row={row} />
                  </details>
                  {row.settledOn ? (
                    <p>
                      {row.settledOn} · {row.settlementReference}
                    </p>
                  ) : (
                    <div className="button-row">
                      {row.status === 'draft' ? (
                        <button
                          className="btn btn-primary"
                          disabled={employee.id === selfEmployeeId}
                          onClick={() => setDecision({ kind: 'confirm', row })}
                        >
                          {t({ ja: '年末調整を確定', en: 'Confirm adjustment' })}
                        </button>
                      ) : null}
                      {row.status === 'confirmed' ? (
                        <>
                          <button
                            className="btn"
                            disabled={employee.id === selfEmployeeId}
                            onClick={() => setDecision({ kind: 'settle', row })}
                          >
                            {t({ ja: '実際の還付・徴収を記録', en: 'Record actual settlement' })}
                          </button>
                          <button
                            className="btn"
                            disabled={employee.id === selfEmployeeId}
                            onClick={() => setDecision({ kind: 'cancel', row })}
                          >
                            {t({ ja: '取消', en: 'Cancel' })}
                          </button>
                        </>
                      ) : null}
                    </div>
                  )}
                </section>
              ))}
            </article>
          );
        })
      )}
      {decision ? (
        <YearEndDecision
          decision={decision}
          currentVersion={
            (decision.kind === 'review' ? data.declarations : data.adjustments).find(
              (row) => row.id === decision.row.id,
            )?.version
          }
          onClose={() => setDecision(undefined)}
        />
      ) : null}
      {calculate ? (
        <YearEndCalculate
          taxYear={data.taxYear}
          rule={rule}
          employee={calculate.employee}
          prior={calculate.prior}
          current={data.adjustments.find((row) => row.employeeId === calculate.employee.id && row.status === 'draft')}
          onClose={() => setCalculate(undefined)}
        />
      ) : null}
    </WorkforcePanel>
  );
}
