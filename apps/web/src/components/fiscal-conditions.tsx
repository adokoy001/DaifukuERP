import { useState } from 'react';
import type { FiscalBoard } from '../api/fiscal.ts';
import { formText } from '../api/workforce.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { businessToday } from '../lib/operations.ts';
import { useLocale } from '../i18n.tsx';
import { FiscalCheck, FiscalMoneyField, FiscalSection } from './fiscal-fields.tsx';
import { WorkforceDialog } from './workforce-dialog.tsx';
import { WorkforceEmpty, WorkforcePanel } from './workforce-shared.tsx';
const branches = [
  '北海道',
  '青森',
  '岩手',
  '宮城',
  '秋田',
  '山形',
  '福島',
  '茨城',
  '栃木',
  '群馬',
  '埼玉',
  '千葉',
  '東京',
  '神奈川',
  '新潟',
  '富山',
  '石川',
  '福井',
  '山梨',
  '長野',
  '岐阜',
  '静岡',
  '愛知',
  '三重',
  '滋賀',
  '京都',
  '大阪',
  '兵庫',
  '奈良',
  '和歌山',
  '鳥取',
  '島根',
  '岡山',
  '広島',
  '山口',
  '徳島',
  '香川',
  '愛媛',
  '高知',
  '福岡',
  '佐賀',
  '長崎',
  '熊本',
  '大分',
  '宮崎',
  '鹿児島',
  '沖縄',
];
type Condition = FiscalBoard['conditions'][number];
function MembershipField({
  name,
  value = 'enrolled',
  exempt = true,
}: {
  name: string;
  value?: string;
  exempt?: boolean;
}) {
  const { t } = useLocale();
  return (
    <label>
      {t({ ja: '加入・免除状態', en: 'Enrollment / exemption' })}
      <select className="input" name={name} defaultValue={value}>
        <option value="enrolled">{t({ ja: '加入', en: 'Enrolled' })}</option>
        <option value="not_enrolled">{t({ ja: '非加入（確認済み）', en: 'Not enrolled (verified)' })}</option>
        {exempt ? <option value="exempt">{t({ ja: '免除（確認済み）', en: 'Exempt (verified)' })}</option> : null}
      </select>
    </label>
  );
}
function ConditionDialog({
  taxYear,
  employee,
  original,
  current,
  future = false,
  onClose,
}: {
  taxYear: number;
  employee: FiscalBoard['employees'][number];
  original?: Condition;
  current?: Condition | undefined;
  future?: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale(),
    task = useWorkforceTask();
  return (
    <WorkforceDialog
      title={t({ ja: '税・保険の本人条件', en: 'Employee tax and insurance conditions' })}
      description={
        employee.name +
        ' / ' +
        t({
          ja: '適用期間・加入要件・標準報酬決定通知・住民税通知を原資料で確認してください。標準報酬は給与実額ではなく、決定された等級の金額です。',
          en: 'Verify effective dates, enrollment and official remuneration and resident-tax notices. Standard remuneration is the officially determined grade, not actual salary.',
        })
      }
      submitLabel={t({ ja: '確認済みの条件を保存', en: 'Save verified conditions' })}
      stale={original ? current?.version !== original.version : false}
      onClose={onClose}
      onSubmit={async (data) => {
        const healthMembership = formText(data, 'healthMembership'),
          pensionMembership = formText(data, 'pensionMembership');
        await task.mutateAsync({
          action: future ? 'workforce.supersede_payroll_condition' : 'workforce.save_payroll_condition',
          input: {
            employeeId: employee.id,
            ...(original ? { conditionId: original.id } : {}),
            expectedVersion: original?.version ?? 0,
            ...Object.fromEntries(
              [
                'validFrom',
                'validTo',
                'birthDate',
                'healthBranch',
                'employmentMembership',
                'employmentCategory',
                'residentTaxAmount',
                'residentTaxBasis',
                'membershipBasis',
                'basis',
              ].map((key) => [key, formText(data, key)]),
            ),
            taxCategory: 'ko',
            sourceDependentCount: Number(formText(data, 'sourceDependentCount')),
            healthMembership,
            pensionMembership,
            healthStandardMonthly: healthMembership === 'enrolled' ? formText(data, 'healthStandardMonthly') : null,
            pensionStandardMonthly: pensionMembership === 'enrolled' ? formText(data, 'pensionStandardMonthly') : null,
            ...Object.fromEntries(
              ['resident', 'declarationReceived', 'verified'].map((key) => [key, data.get(key) === 'on']),
            ),
          },
        });
      }}
    >
      {future ? (
        <p className="workforce-notice">
          {t({
            ja: '切替元の条件を新開始日の前日までにし、新しい条件を追加します。確定給与で使用した日を変える切替はできません。',
            en: 'The prior condition ends one day before the new start. A new record is added; dates used by confirmed payroll remain protected.',
          })}
        </p>
      ) : null}
      <FiscalSection title={{ ja: '適用期間と本人', en: 'Effective dates and employee' }}>
        <div className="workforce-form-row">
          <label>
            {t({ ja: '適用開始日', en: 'Valid from' })}
            <input
              className="input"
              type="date"
              name="validFrom"
              defaultValue={future ? businessToday() : (original?.validFrom ?? `${taxYear}-01-01`)}
              required
            />
          </label>
          <label>
            {t({ ja: '適用終了日', en: 'Valid until' })}
            <input
              className="input"
              type="date"
              name="validTo"
              readOnly={future}
              defaultValue={original?.validTo ?? `${taxYear}-12-31`}
              required
            />
          </label>
        </div>
        <label>
          {t({ ja: '生年月日', en: 'Date of birth' })}
          <input className="input" type="date" name="birthDate" defaultValue={original?.birthDate} required />
        </label>
        <FiscalCheck
          name="resident"
          label={{ ja: '日本の居住者であることを確認', en: 'Japanese tax residence verified' }}
          required
        />
        <FiscalCheck
          name="declarationReceived"
          label={{
            ja: '扶養控除等申告書を受領し、月額表甲欄を適用',
            en: 'Declaration received; monthly category Ko applies',
          }}
          required
        />
        <label>
          {t({
            ja: '源泉徴収上の扶養親族等の数（控除申告書で確認）',
            en: 'Withholding dependant count verified on declaration',
          })}
          <input
            className="input"
            type="number"
            name="sourceDependentCount"
            min={0}
            max={20}
            step={1}
            defaultValue={original?.sourceDependentCount ?? 0}
            required
          />
        </label>
      </FiscalSection>
      <FiscalSection title={{ ja: '健康保険・厚生年金', en: 'Health insurance and pension' }}>
        <label>
          {t({ ja: '協会けんぽ支部', en: 'Kyokai Kenpo branch' })}
          <select className="input" name="healthBranch" defaultValue={original?.healthBranch ?? '13'}>
            {branches.map((name, i) => (
              <option key={i} value={String(i + 1).padStart(2, '0')}>
                {String(i + 1).padStart(2, '0')} · {name}
              </option>
            ))}
          </select>
        </label>
        <h4>{t({ ja: '健康保険', en: 'Health insurance' })}</h4>
        <MembershipField name="healthMembership" value={original?.healthMembership ?? 'enrolled'} />
        <label>
          {t({
            ja: '健康保険の標準報酬月額（加入時必須）',
            en: 'Standard health remuneration (required when enrolled)',
          })}
          <input
            className="input"
            name="healthStandardMonthly"
            inputMode="numeric"
            pattern="[0-9]{1,12}"
            defaultValue={original?.healthStandardMonthly ?? ''}
          />
        </label>
        <h4>{t({ ja: '厚生年金', en: 'Employees pension' })}</h4>
        <MembershipField name="pensionMembership" value={original?.pensionMembership ?? 'enrolled'} />
        <label>
          {t({
            ja: '厚生年金の標準報酬月額（加入時必須）',
            en: 'Standard pension remuneration (required when enrolled)',
          })}
          <input
            className="input"
            name="pensionStandardMonthly"
            inputMode="numeric"
            pattern="[0-9]{1,12}"
            defaultValue={original?.pensionStandardMonthly ?? ''}
          />
        </label>
        <p className="account-help">
          {t({
            ja: '介護保険は生年月日と保険対象月で判定します。健康保険組合独自の率・賞与・遡及控除は別途確認が必要です。',
            en: 'Nursing care is determined by birth date and insurance month. Society-specific rates, bonuses and retroactive deductions require separate handling.',
          })}
        </p>
      </FiscalSection>
      <FiscalSection title={{ ja: '雇用保険・住民税', en: 'Employment insurance and resident tax' }}>
        <MembershipField
          name="employmentMembership"
          value={original?.employmentMembership ?? 'enrolled'}
          exempt={false}
        />
        <label>
          {t({ ja: '雇用保険の事業区分', en: 'Employment insurance business category' })}
          <select className="input" name="employmentCategory" defaultValue={original?.employmentCategory ?? 'general'}>
            <option value="general">{t({ ja: '一般の事業', en: 'General' })}</option>
            <option value="agriculture_sake">
              {t({ ja: '農林水産・清酒製造', en: 'Agriculture, fisheries, forestry and sake' })}
            </option>
            <option value="construction">{t({ ja: '建設', en: 'Construction' })}</option>
          </select>
        </label>
        <FiscalMoneyField
          name="residentTaxAmount"
          label={{ ja: '住民税の通知月額', en: 'Notified monthly resident tax' }}
          value={original?.residentTaxAmount ?? '0'}
        />
        <label>
          {t({ ja: '住民税通知の資料番号・根拠', en: 'Resident-tax notice reference' })}
          <textarea
            className="input"
            name="residentTaxBasis"
            defaultValue={original?.residentTaxBasis}
            required
            maxLength={1000}
          />
        </label>
      </FiscalSection>
      <FiscalSection title={{ ja: '確認記録', en: 'Verification evidence' }}>
        <label>
          {t({ ja: '加入・非加入・免除の根拠', en: 'Enrollment / non-enrollment / exemption evidence' })}
          <textarea
            className="input"
            name="membershipBasis"
            defaultValue={original?.membershipBasis}
            required
            maxLength={1000}
          />
        </label>
        <label>
          {t({ ja: '全体の確認記録・資料番号', en: 'Overall verification and document references' })}
          <textarea className="input" name="basis" defaultValue={original?.basis} required maxLength={1000} />
        </label>
        <FiscalCheck
          name="verified"
          label={{
            ja: '本人条件と適用要件を原資料で確認しました',
            en: 'I verified these conditions and eligibility against source documents',
          }}
          required
        />
      </FiscalSection>
    </WorkforceDialog>
  );
}
export function FiscalConditions({ data, employeeId }: { data: FiscalBoard; employeeId: string }) {
  const { t } = useLocale(),
    [editing, setEditing] = useState<{
      employee: FiscalBoard['employees'][number];
      original?: Condition;
      future?: boolean;
    }>();
  const employees = data.employees.filter((employee) => !employeeId || employee.id === employeeId);
  return (
    <WorkforcePanel title={t({ ja: '税・保険の本人条件', en: 'Employee tax and insurance conditions' })} icon="people">
      {employees.length ? (
        employees.map((employee) => (
          <article className="workforce-record" key={employee.id}>
            <header>
              <h3>
                {employee.code} · {employee.name}
              </h3>
              <button className="btn" onClick={() => setEditing({ employee })}>
                {t({ ja: '適用期間を追加', en: 'Add effective period' })}
              </button>
            </header>
            {data.conditions
              .filter((condition) => condition.employeeId === employee.id)
              .map((condition) => (
                <div key={condition.id} className="identity-provider">
                  <div>
                    <strong>
                      {condition.validFrom} — {condition.validTo}
                    </strong>
                    <small>
                      {t({ ja: '扶養数', en: 'Dependants' })}: {condition.sourceDependentCount} ·{' '}
                      {t({ ja: '協会けんぽ', en: 'Health branch' })}: {branches[Number(condition.healthBranch) - 1]}
                    </small>
                    <p>{condition.basis}</p>
                  </div>
                  <button className="btn" onClick={() => setEditing({ employee, original: condition })}>
                    {t({ ja: '確認・編集', en: 'Review / edit' })}
                  </button>
                  <button className="btn" onClick={() => setEditing({ employee, original: condition, future: true })}>
                    {t({ ja: '将来の条件へ切替', en: 'Change future conditions' })}
                  </button>
                </div>
              ))}
          </article>
        ))
      ) : (
        <WorkforceEmpty>{t({ ja: '従業員を登録してください。', en: 'Register an employee to begin.' })}</WorkforceEmpty>
      )}
      {editing ? (
        <ConditionDialog
          taxYear={data.taxYear}
          employee={editing.employee}
          future={editing.future ?? false}
          {...(editing.original
            ? {
                original: editing.original,
                current: data.conditions.find((condition) => condition.id === editing.original?.id),
              }
            : {})}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </WorkforcePanel>
  );
}
