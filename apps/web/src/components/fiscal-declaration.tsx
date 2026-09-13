import { useState } from 'react';
import type { MyFiscal, YearEndDeclaration } from '../api/fiscal.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { useLocale } from '../i18n.tsx';
import { declarationFromForm } from '../lib/fiscal-form.ts';
import { WorkforceDialog } from './workforce-dialog.tsx';
import { DisabilityField, FiscalCheck, FiscalMoneyField, FiscalSection } from './fiscal-fields.tsx';
import { FiscalFamily } from './fiscal-family.tsx';
import '../fiscal.css';

const premiums = [
  ['lifeNew', { ja: '新契約の一般生命保険料', en: 'New general life premiums' }],
  ['lifeOld', { ja: '旧契約の一般生命保険料', en: 'Old general life premiums' }],
  ['nursingLife', { ja: '介護医療保険料', en: 'Nursing/medical insurance premiums' }],
  ['pensionLifeNew', { ja: '新契約の個人年金保険料', en: 'New private pension premiums' }],
  ['pensionLifeOld', { ja: '旧契約の個人年金保険料', en: 'Old private pension premiums' }],
  ['earthquakePremium', { ja: '地震保険料', en: 'Earthquake premiums' }],
  ['oldLongTermPremium', { ja: '旧長期損害保険料', en: 'Old long-term casualty premiums' }],
  [
    'personalSocialPremium',
    {
      ja: '自分で支払った社会保険料（給与控除分を除く）',
      en: 'Personally paid social premiums, excluding payroll deductions',
    },
  ],
  [
    'smallEnterpriseContributions',
    { ja: '小規模企業共済等掛金（iDeCo等）', en: 'Small enterprise / iDeCo contributions' },
  ],
  ['housingTaxCredit', { ja: '確認済みの住宅借入金等特別控除額', en: 'Verified housing loan tax credit amount' }],
] as const;

export function FiscalArrayButtons({
  count,
  max,
  onChange,
}: {
  count: number;
  max: number;
  onChange: (count: number) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="button-row">
      <button
        type="button"
        className="btn"
        data-draft-change
        disabled={count >= max}
        onClick={() => onChange(count + 1)}
      >
        {t({ ja: '追加', en: 'Add' })}
      </button>
      {count > 0 ? (
        <button type="button" className="btn" data-draft-change onClick={() => onChange(count - 1)}>
          {t({ ja: '最後の項目を除く', en: 'Remove last item' })}
        </button>
      ) : null}
    </div>
  );
}

function PreviousEmployers({ count, previous }: { count: number; previous: YearEndDeclaration | undefined }) {
  const { t } = useLocale();
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <section className="fiscal-choice-card" key={i}>
          <label>
            {t({ ja: '前職の勤務先名', en: 'Previous employer' })}
            <input
              className="input"
              name={`previous${i}.name`}
              defaultValue={previous?.previousEmployers[i]?.name}
              required
              maxLength={1000}
            />
          </label>
          <FiscalMoneyField
            name={`previous${i}.taxablePay`}
            label={{ ja: '支払金額', en: 'Taxable pay' }}
            value={previous?.previousEmployers[i]?.taxablePay ?? '0'}
          />
          <FiscalMoneyField
            name={`previous${i}.socialPremium`}
            label={{ ja: '社会保険料等の金額', en: 'Social premiums' }}
            value={previous?.previousEmployers[i]?.socialPremium ?? '0'}
          />
          <FiscalMoneyField
            name={`previous${i}.incomeTax`}
            label={{ ja: '源泉徴収税額', en: 'Income tax withheld' }}
            value={previous?.previousEmployers[i]?.incomeTax ?? '0'}
          />
          <label>
            {t({ ja: '源泉徴収票の資料番号・確認記録', en: 'Withholding statement reference and verification' })}
            <textarea
              className="input"
              name={`previous${i}.evidence`}
              defaultValue={previous?.previousEmployers[i]?.evidence}
              required
              maxLength={1000}
            />
          </label>
        </section>
      ))}
    </>
  );
}

export function FiscalDeclaration({
  taxYear,
  readOnly,
  original,
  current,
  onClose,
}: {
  taxYear: number;
  readOnly: boolean;
  original: MyFiscal['declaration'];
  current: MyFiscal['declaration'];
  onClose: () => void;
}) {
  const { t } = useLocale(),
    task = useWorkforceTask(),
    previous = original?.declaration;
  const [spouse, setSpouse] = useState(Boolean(previous?.spouse)),
    [relatives, setRelatives] = useState(previous?.relatives.length ?? 0),
    [previousEmployers, setPreviousEmployers] = useState(previous?.previousEmployers.length ?? 0),
    [unpaidMonths, setUnpaidMonths] = useState(previous?.unpaidMonths.length ?? 0);
  return (
    <WorkforceDialog
      title={t({ ja: `${taxYear}年 年末調整の申告`, en: `${taxYear} year-end declaration` })}
      description={t({
        ja: '証明書を手元に、12月31日時点の対象となる事実を入力してください。金額は円単位、該当しない項目は0です。所得金額は収入から必要経費・給与所得控除などを引いた金額です。',
        en: 'Use supporting certificates and eligible facts as of December 31. Enter whole yen, or 0 where not applicable. Income means income after applicable expenses or salary deductions.',
      })}
      submitLabel={t({ ja: '確認して本部へ提出', en: 'Submit to payroll for review' })}
      stale={(original?.version ?? 0) !== (current?.version ?? 0)}
      readOnly={readOnly}
      onClose={onClose}
      onSubmit={async (data) => {
        await task.mutateAsync({
          action: 'workforce.submit_year_end_declaration',
          input: {
            ...declarationFromForm(data, { spouse, relatives, previousEmployers, unpaidMonths }, taxYear),
            expectedVersion: original?.version ?? 0,
          },
        });
      }}
    >
      {readOnly ? (
        <p className="workforce-notice" role="status">
          {t({
            ja: 'この税年の制度の利用状況が変わりました。入力を確認して閉じ、制度の準備後に開き直してください。',
            en: 'Rule availability for this tax year has changed. Review your input, close this dialog and reopen it after the rules are ready.',
          })}
        </p>
      ) : null}
      <FiscalSection title={{ ja: '1. 本人の申告条件', en: '1. Personal eligibility' }}>
        <FiscalCheck name="resident" label={{ ja: '日本の居住者です', en: 'I am a Japanese tax resident' }} required />
        <FiscalCheck
          name="mainEmployer"
          label={{ ja: 'この会社が主たる給与の支払者です', en: 'This company is my main employer' }}
          required
        />
        <FiscalMoneyField
          name="otherIncome"
          label={{ ja: '給与以外の年間所得', en: 'Annual income other than salary' }}
          value={previous?.otherIncome ?? '0'}
        />
        <DisabilityField name="taxpayerDisability" taxpayer value={previous?.taxpayerDisability ?? 'none'} />
        <FiscalCheck
          name="widow"
          label={{ ja: '寡婦控除の要件を満たします', en: 'I meet the widow deduction requirements' }}
          checked={previous?.widow ?? false}
        />
        <FiscalCheck
          name="singleParent"
          label={{ ja: 'ひとり親控除の要件を満たします', en: 'I meet the single-parent deduction requirements' }}
          checked={previous?.singleParent ?? false}
        />
        <FiscalCheck
          name="student"
          label={{ ja: '勤労学生控除の要件を満たします', en: 'I meet the working-student deduction requirements' }}
          checked={previous?.student ?? false}
        />
        <FiscalMoneyField
          name="studentNonSalaryIncome"
          label={{ ja: '勤労学生判定用：勤労によらない所得', en: 'Non-earned income for working-student eligibility' }}
          value={previous?.studentNonSalaryIncome ?? '0'}
        />
        <FiscalCheck
          name="incomeAdjustmentEligible"
          label={{
            ja: '給与所得金額調整控除の要件を証明書等で確認しました',
            en: 'I verified salary-income adjustment deduction eligibility with evidence',
          }}
          checked={previous?.incomeAdjustmentEligible ?? false}
        />
      </FiscalSection>
      <FiscalSection title={{ ja: '2. 配偶者と扶養親族', en: '2. Spouse and dependants' }}>
        <label className="workforce-checkbox">
          <input type="checkbox" checked={spouse} onChange={(event) => setSpouse(event.target.checked)} />
          {t({ ja: '配偶者の控除を申告する', en: 'Declare a spouse deduction' })}
        </label>
        {spouse ? (
          <FiscalFamily prefix="spouse" spouse {...(previous?.spouse ? { value: previous.spouse } : {})} />
        ) : null}
        <h4>
          {t({
            ja: '家族（子の特例判定には、他の家族が控除を申告する子も入力）',
            en: 'Family members, including children claimed by another parent for special eligibility',
          })}
        </h4>
        {Array.from({ length: relatives }, (_, i) => (
          <FiscalFamily
            key={i}
            prefix={`relative${i}`}
            {...(previous?.relatives[i] ? { value: previous.relatives[i] } : {})}
          />
        ))}
        <FiscalArrayButtons count={relatives} max={30} onChange={setRelatives} />
      </FiscalSection>
      <FiscalSection title={{ ja: '3. 保険料・住宅控除', en: '3. Insurance and housing deductions' }}>
        <p>
          {t({
            ja: '証明書の保険料等を入力します。同じ契約の重複計上を避け、住宅控除は年末調整可能な要件と金額を確認してください。',
            en: 'Enter amounts from certificates. Avoid duplicate contract claims and verify housing credit eligibility for year-end adjustment.',
          })}
        </p>
        {premiums.map(([key, label]) => (
          <FiscalMoneyField key={key} name={key} label={label} value={previous?.[key] ?? '0'} />
        ))}
        <FiscalCheck
          name="distinctEarthquakeContractsConfirmed"
          label={{
            ja: '地震保険と旧長期保険の同一契約を重複計上していません（該当なしを含む）',
            en: 'Earthquake and old long-term claims do not duplicate one contract (including no claims)',
          }}
          required
        />
        <FiscalCheck
          name="housingEligibilityConfirmed"
          label={{
            ja: '住宅控除の要件・金額・資料を確認しました（該当なしを含む）',
            en: 'Housing credit eligibility, amount and evidence are verified (including no claim)',
          }}
          required
        />
      </FiscalSection>
      <FiscalSection title={{ ja: '4. 前職の源泉徴収票', en: '4. Previous-employer withholding statements' }}>
        <PreviousEmployers count={previousEmployers} previous={previous} />
        <FiscalArrayButtons count={previousEmployers} max={10} onChange={setPreviousEmployers} />
      </FiscalSection>
      <FiscalSection title={{ ja: '5. 給与支払のない月と確認資料', en: '5. Unpaid months and supporting evidence' }}>
        <p>
          {t({
            ja: '対象年に給与支払のない月があれば、入社前・休職等の理由を記録します。',
            en: 'Explain any months without salary payments, such as before joining or leave of absence.',
          })}
        </p>
        {Array.from({ length: unpaidMonths }, (_, i) => (
          <div className="workforce-form-row" key={i}>
            <label>
              {t({ ja: '給与支払のない月', en: 'Month without payment' })}
              <input
                className="input"
                name={`unpaid${i}.period`}
                type="month"
                min={`${taxYear}-01`}
                max={`${taxYear}-12`}
                defaultValue={previous?.unpaidMonths[i]?.period}
                required
              />
            </label>
            <label>
              {t({ ja: '理由', en: 'Reason' })}
              <input
                className="input"
                name={`unpaid${i}.reason`}
                defaultValue={previous?.unpaidMonths[i]?.reason}
                required
                maxLength={1000}
              />
            </label>
          </div>
        ))}
        <FiscalArrayButtons count={unpaidMonths} max={12} onChange={setUnpaidMonths} />
        <label>
          {t({ ja: '申告全体の資料番号・確認記録', en: 'Declaration evidence references and review notes' })}
          <textarea
            className="input"
            name="evidence"
            defaultValue={previous?.evidence}
            required
            maxLength={1000}
            rows={4}
          />
        </label>
        <FiscalCheck
          name="factsConfirmed"
          label={{
            ja: '0・該当なしを含め、所得と家族・保険・控除の申告内容を資料に基づいて確認しました',
            en: 'I verified income, family, insurance and deduction declarations against evidence, including zeros and no claims',
          }}
          required
        />
      </FiscalSection>
    </WorkforceDialog>
  );
}
