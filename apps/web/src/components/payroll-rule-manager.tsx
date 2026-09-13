import { useState } from 'react';
import {
  usePayrollRulePreview,
  type PayrollRuleCatalog,
  type PayrollRulePreview,
  type PayrollRuleSummary,
} from '../api/fiscal.ts';
import { formText } from '../api/workforce.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { useLocale } from '../i18n.tsx';
import { canRetainData } from '../lib/read-recovery.ts';
import { FiscalCheck } from './fiscal-fields.tsx';
import { ReadRecoveryProvider } from './read-refresh-notice.tsx';
import { WorkforceDialog } from './workforce-dialog.tsx';
import { WorkforceEmpty, WorkforceError, WorkforcePanel } from './workforce-shared.tsx';

const statuses = {
  available: { ja: '未導入', en: 'Available' },
  legacy: { ja: '既存の制度資料', en: 'Existing rule data' },
  approved: { ja: '導入済み', en: 'Installed' },
  superseded: { ja: '後継版へ移行済み', en: 'Superseded' },
};

export function PayrollRuleDetails({ rule }: { rule: PayrollRuleSummary }) {
  const { t } = useLocale();
  const applicability = rule.manifest.applicability;
  const periods = [
    [{ ja: '月次給与の支払日', en: 'Monthly payroll payment dates' }, applicability.paymentDates],
    [{ ja: '健康保険・厚生年金の対象月', en: 'Health / pension insurance months' }, applicability.insuranceMonths],
    [{ ja: '賃金締日（雇用保険）', en: 'Wage cutoff dates (employment insurance)' }, applicability.wageCutoffDates],
    [{ ja: '年末調整の実施日', en: 'Year-end adjustment dates' }, applicability.adjustmentDates],
  ] as const;
  return (
    <div className="fiscal-evidence payroll-rule-details">
      <dl>
        <dt>{t({ ja: '制度版', en: 'Rule package' })}</dt>
        <dd>{rule.packageCode}</dd>
        <dt>{t({ ja: '税年', en: 'Tax year' })}</dt>
        <dd>{rule.taxYear}</dd>
        <dt>{t({ ja: '状態', en: 'Status' })}</dt>
        <dd>{t(statuses[rule.status])}</dd>
        <dt>{t({ ja: '資料確認日', en: 'Source verification date' })}</dt>
        <dd>{rule.verifiedOn}</dd>
        <dt>{t({ ja: '国・通貨', en: 'Country / currency' })}</dt>
        <dd>
          {rule.manifest.country} / {rule.manifest.currency}
        </dd>
        <dt>{t({ ja: '計算方式', en: 'Calculation method' })}</dt>
        <dd>{rule.manifest.algorithmVersion}</dd>
        {periods.map(([label, range]) => (
          <div className="payroll-rule-period" key={label.en}>
            <dt>{t(label)}</dt>
            <dd>
              {range.from} → {range.to}
            </dd>
          </div>
        ))}
        <dt>{t({ ja: '税年の年末基準日', en: 'Tax-year end reference date' })}</dt>
        <dd>{applicability.yearEndFactsOn}</dd>
        <dt>{t({ ja: '通常年調に必要な最終給与の期間開始', en: 'Earliest final payment for ordinary adjustment' })}</dt>
        <dd>{applicability.requiredFinalPaymentFrom}</dd>
        {rule.approvedAt ? (
          <>
            <dt>{t({ ja: '導入記録日時', en: 'Installed at' })}</dt>
            <dd>{rule.approvedAt}</dd>
          </>
        ) : null}
        {rule.approvalBasis ? (
          <>
            <dt>{t({ ja: '導入の確認記録', en: 'Installation review' })}</dt>
            <dd>{rule.approvalBasis}</dd>
          </>
        ) : null}
      </dl>
      <p className="account-help">
        {t({
          ja: '表示はこの制度版の対応期間です。給与対象月・所定の支給日・保険対象月を区別してください。翌年1月の再調整には源泉徴収票の交付状況等の確認も必要です。',
          en: 'These are the supported periods of this package. Distinguish the work month, scheduled payment date and insurance month. January re-adjustments also require checking whether withholding statements have been issued.',
        })}
      </p>
      <details>
        <summary>{t({ ja: '内容の識別情報', en: 'Content identifiers' })}</summary>
        <p>
          {t({ ja: '制度データのhash', en: 'Payload hash' })}: <code>{rule.payloadHash}</code>
        </p>
        <p>
          {t({ ja: '版情報のhash', en: 'Manifest hash' })}: <code>{rule.manifestHash}</code>
        </p>
        <p className="account-help">
          {t({
            ja: 'hashは内容の同一性を確認する値で、公式機関の認証ではありません。',
            en: 'Hashes identify the content; they are not certification by an official authority.',
          })}
        </p>
      </details>
      <details>
        <summary>
          {t({ ja: '公式の出典を確認', en: 'Review primary sources' })} ({rule.sources.length})
        </summary>
        <ul>
          {rule.sources
            .filter((url) => url.startsWith('https://'))
            .map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </li>
            ))}
        </ul>
      </details>
    </div>
  );
}

function PayrollRuleInstallReview({
  initial,
  current,
  canManage,
  onClose,
}: {
  initial: PayrollRulePreview;
  current: ReturnType<typeof usePayrollRulePreview>;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const task = useWorkforceTask();
  const [reviewed] = useState(initial);
  const stale =
    !current.data ||
    current.data.manifestHash !== reviewed.manifestHash ||
    current.data.payloadHash !== reviewed.payloadHash;
  const blocked = !canManage || !reviewed.canInstall || !current.data?.canInstall || current.isError;
  const applicability = current.data ?? reviewed;
  return (
    <WorkforceDialog
      title={t({ ja: '制度の内容と導入を確認', en: 'Review rule package and installation' })}
      submitLabel={t({ ja: '確認した制度版をこの会社に導入', en: 'Install reviewed package for this company' })}
      onClose={onClose}
      stale={stale}
      readOnly={blocked}
      onSubmit={async (data) => {
        await task.mutateAsync({
          action: 'workforce.install_payroll_rule',
          input: {
            packageCode: reviewed.packageCode,
            expectedManifestHash: reviewed.manifestHash,
            expectedPayloadHash: reviewed.payloadHash,
            sourcesReviewed: data.get('sourcesReviewed') === 'on',
            basis: formText(data, 'basis'),
          },
        });
      }}
    >
      <PayrollRuleDetails rule={reviewed} />
      <p className="workforce-notice">
        {t({
          ja: '導入はこの会社だけに適用されます。確定済みの給与や年末調整を再計算・上書きしません。既存の資料は保持し、導入記録を追加します。',
          en: 'Installation applies only to this company. Confirmed payroll and year-end adjustments are not recalculated or overwritten. Existing data is retained with a new installation record.',
        })}
      </p>
      {reviewed.changes.length ? (
        <ul>
          {reviewed.changes.map((change, index) => (
            <li key={index}>{change}</li>
          ))}
        </ul>
      ) : null}
      <p>
        {t({ ja: '確認対象の下書き', en: 'Drafts to review' })}: {t({ ja: '給与', en: 'Payroll' })}{' '}
        {applicability.affectedDrafts.payroll} / {t({ ja: '年末調整', en: 'Year-end' })}{' '}
        {applicability.affectedDrafts.yearEnd}
      </p>
      {current.isError ? <WorkforceError error={current.error} onRetry={() => void current.refetch()} /> : null}
      {applicability.issues.length ? (
        <ul role="status">
          {applicability.issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {canManage && reviewed.canInstall ? (
        <>
          <label>
            {t({ ja: '導入の確認記録', en: 'Installation review notes' })}
            <textarea className="input" name="basis" required minLength={5} maxLength={2000} rows={3} />
          </label>
          <FiscalCheck
            name="sourcesReviewed"
            required
            label={{
              ja: '出典・対応期間・計算方式と、この会社への適用を確認しました',
              en: 'I reviewed the sources, supported periods, calculation method and applicability to this company',
            }}
          />
        </>
      ) : null}
    </WorkforceDialog>
  );
}

function PayrollRuleInstall({
  packageCode,
  canManage,
  onClose,
}: {
  packageCode: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const preview = usePayrollRulePreview(packageCode, true);
  if (preview.isError && !canRetainData(preview))
    return (
      <div role="alert">
        <WorkforceError error={preview.error} onRetry={() => void preview.refetch()} />
        <button className="btn" onClick={onClose}>
          {t({ ja: '閉じる', en: 'Close' })}
        </button>
      </div>
    );
  if (!preview.data)
    return <p role="status">{t({ ja: '制度の適用内容を確認しています…', en: 'Checking package applicability…' })}</p>;
  return (
    <ReadRecoveryProvider sources={[preview]}>
      <PayrollRuleInstallReview initial={preview.data} current={preview} canManage={canManage} onClose={onClose} />
    </ReadRecoveryProvider>
  );
}

export function PayrollRuleManager({
  catalog,
  taxYear,
  actions,
}: {
  catalog: PayrollRuleCatalog;
  taxYear: number;
  actions: string[];
}) {
  const { t } = useLocale();
  const [reviewing, setReviewing] = useState('');
  const bundles = catalog.bundles.filter((bundle) => bundle.taxYear === taxYear);
  return (
    <WorkforcePanel title={t({ ja: '制度の版と出典', en: 'Rule versions and sources' })} icon="document">
      <p>
        {t({
          ja: '対応する年度の資料を確認し、この会社へ導入します。未収録年度への自動更新や前年の率による代用は行いません。',
          en: 'Review a supported tax year and install its rules for this company. Unsupported years are not updated automatically or calculated using prior-year rates.',
        })}
      </p>
      {!bundles.length ? (
        <WorkforceEmpty>
          {t({
            ja: 'この税年の制度版は収録されていません。保存済みの記録は閲覧できます。',
            en: 'No package is available for this tax year. Existing records remain readable.',
          })}
        </WorkforceEmpty>
      ) : null}
      {bundles.map((rule) => (
        <article className="workforce-record" key={rule.packageCode}>
          <header>
            <h3>
              {rule.taxYear} · {rule.packageCode}
            </h3>
            <span>{t(statuses[rule.status])}</span>
          </header>
          <details>
            <summary>{t({ ja: '対応期間・出典を表示', en: 'Show periods and sources' })}</summary>
            <PayrollRuleDetails rule={rule} />
          </details>
          {actions.includes('workforce.preview_payroll_rule') ? (
            <button className="btn btn-primary" onClick={() => setReviewing(rule.packageCode)}>
              {t({ ja: '制度の詳細・導入', en: 'Review / install package' })}
            </button>
          ) : null}
        </article>
      ))}
      {reviewing ? (
        <PayrollRuleInstall
          key={reviewing}
          packageCode={reviewing}
          canManage={actions.includes('workforce.install_payroll_rule')}
          onClose={() => setReviewing('')}
        />
      ) : null}
    </WorkforcePanel>
  );
}
