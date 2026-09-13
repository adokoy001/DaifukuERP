import type { YearEndDeclaration } from '../api/fiscal.ts';
import { useLocale } from '../i18n.tsx';
import { DisabilityField, FiscalCheck, FiscalMoneyField } from './fiscal-fields.tsx';
export function FiscalFamily({
  prefix,
  value,
  spouse = false,
}: {
  prefix: string;
  value?: YearEndDeclaration['relatives'][number] | NonNullable<YearEndDeclaration['spouse']>;
  spouse?: boolean;
}) {
  const { t } = useLocale();
  return (
    <section className="fiscal-choice-card">
      {!spouse ? (
        <label>
          {t({ ja: '家族の識別名（例：子1）', en: 'Family reference (for example Child 1)' })}
          <input
            className="input"
            name={prefix + '.code'}
            defaultValue={value && 'code' in value ? value.code : ''}
            required
            maxLength={80}
          />
        </label>
      ) : null}
      <div className="workforce-form-row">
        <label>
          {t({ ja: '生年月日', en: 'Date of birth' })}
          <input className="input" type="date" name={prefix + '.birthDate'} defaultValue={value?.birthDate} required />
        </label>
        <FiscalMoneyField
          name={prefix + '.income'}
          label={{
            ja: '年間の合計所得金額（収入ではありません）',
            en: 'Total annual income after expenses/deductions',
          }}
          value={value?.income ?? '0'}
        />
      </div>
      <DisabilityField name={prefix + '.disability'} value={value?.disability ?? 'none'} />
      <FiscalCheck
        name={prefix + '.sharedLivelihoodConfirmed'}
        label={{ ja: '生計を一にする要件を確認しました', en: 'I confirmed the shared-livelihood requirement' }}
        required
      />
      <FiscalCheck
        name={prefix + '.eligibilityConfirmed'}
        label={{
          ja: '続柄・所得・年齢・重複申告がないこと等の適用要件を確認しました',
          en: 'I confirmed relationship, income, age and no duplicate claims',
        }}
        required
      />
      {spouse ? (
        <FiscalCheck
          name={prefix + '.specialDeductionNotDuplicated'}
          label={{
            ja: '配偶者特別控除を夫婦双方で重複申告していません',
            en: 'The spousal special deduction is not claimed by both spouses',
          }}
          required
        />
      ) : (
        <>
          <FiscalCheck
            name={prefix + '.claimDependentDeduction'}
            label={{
              ja: 'この本人が扶養・特定親族・障害者の控除を申告します（他の家族との重複不可）',
              en: 'I claim dependent, specified-relative or disability deductions for this person (no duplicate family claims)',
            }}
            checked={value && 'claimDependentDeduction' in value ? value.claimDependentDeduction : false}
          />
          <p className="field-hint">
            {t({
              ja: '控除を他の家族が申告する場合はチェックを外してください。生計同一の子の情報は、生命保険料控除の特例と所得金額調整の判定にも使います。',
              en: 'Leave unchecked if another family member claims these deductions. Shared-livelihood children may still count toward life insurance and income-adjustment eligibility.',
            })}
          </p>
          <FiscalCheck
            name={prefix + '.resident'}
            label={{ ja: 'この家族は日本の居住者です', en: 'This family member is a Japanese tax resident' }}
            required
          />
          <FiscalCheck
            name={prefix + '.cohabitingElderlyParent'}
            label={{ ja: '同居老親等の要件を満たします', en: 'Qualifies as a cohabiting elderly parent' }}
            checked={value && 'cohabitingElderlyParent' in value ? value.cohabitingElderlyParent : false}
          />
        </>
      )}
    </section>
  );
}
