import { useEffect, useState } from 'react';
import { useMyFiscal } from '../api/fiscal.ts';
import { useLocale } from '../i18n.tsx';
import { canRetainData } from '../lib/read-recovery.ts';
import { ReadRecoveryProvider, ReadRefreshNotice } from './read-refresh-notice.tsx';
import { FiscalDeclaration } from './fiscal-declaration.tsx';
import { FiscalCalculation, FiscalDeclarationSummary } from './fiscal-summary.tsx';
import {
  WorkforceEmpty,
  WorkforceError,
  WorkforceMoney,
  WorkforcePanel,
  WorkforceStatus,
} from './workforce-shared.tsx';
import type { MyFiscal } from '../api/fiscal.ts';
export function EmployeeFiscal() {
  const { t } = useLocale(),
    [taxYear, setTaxYear] = useState<number>(),
    portal = useMyFiscal(true, taxYear),
    [editing, setEditing] = useState<{ taxYear: number; declaration: MyFiscal['declaration'] }>();
  useEffect(() => {
    if (taxYear === undefined && portal.data) setTaxYear(portal.data.taxYear);
  }, [portal.data, taxYear]);
  if (portal.isError && !canRetainData(portal))
    return <WorkforceError error={portal.error} onRetry={() => void portal.refetch()} />;
  if (!portal.data) return <p role="status">{t({ ja: '読込中…', en: 'Loading…' })}</p>;
  const data = portal.data,
    frozen = data.adjustments.some((row) => row.status === 'confirmed');
  return (
    <ReadRecoveryProvider sources={[portal]}>
      <div className="workforce-stack">
        <ReadRefreshNotice />
        <WorkforcePanel
          title={t({ ja: `${data.taxYear}年の年末調整`, en: `${data.taxYear} year-end adjustment` })}
          icon="document"
          note={t({
            ja: '申告から還付・追加徴収まで、自分の内容を確認できます。',
            en: 'Review your own declaration, refund and additional withholding.',
          })}
        >
          <div className="fiscal-toolbar">
            <label>
              {t({ ja: '税年', en: 'Tax year' })}
              <select
                className="input"
                aria-label={t({ ja: '税年', en: 'Tax year' })}
                value={data.taxYear}
                onChange={(event) => setTaxYear(Number(event.target.value))}
              >
                {[...new Set([data.taxYear, ...data.availableTaxYears])]
                  .sort((a, b) => b - a)
                  .map((year) => (
                    <option value={year} key={year}>
                      {year}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {!data.employeeId ? (
            <WorkforceEmpty>
              {t({ ja: '先にこの会社の従業員登録が必要です。', en: 'An employee record in this company is required.' })}
            </WorkforceEmpty>
          ) : (
            <>
              {data.declaration ? (
                <>
                  <WorkforceStatus status={data.declaration.status} />
                  {data.declaration.reviewReason ? (
                    <p className="workforce-notice">{data.declaration.reviewReason}</p>
                  ) : null}
                  <details>
                    <summary>{t({ ja: '提出した内容を確認', en: 'Review submitted declaration' })}</summary>
                    <FiscalDeclarationSummary declaration={data.declaration.declaration} />
                  </details>
                </>
              ) : (
                <p>
                  {t({
                    ja: '申告はまだ提出していません。証明書と家族の所得を確認して提出してください。',
                    en: 'No declaration submitted yet. Review your certificates and family income to begin.',
                  })}
                </p>
              )}
              <button
                className="btn btn-primary"
                disabled={frozen || !data.supportedTaxYears.includes(data.taxYear)}
                onClick={() => setEditing({ taxYear: data.taxYear, declaration: data.declaration })}
              >
                {t(
                  data.declaration
                    ? { ja: '申告を更新して再提出', en: 'Update and resubmit' }
                    : { ja: '年末調整を申告', en: 'Start declaration' },
                )}
              </button>
              {!data.supportedTaxYears.includes(data.taxYear) ? (
                <p className="workforce-notice">
                  {t({
                    ja: 'この税年の制度資料はこの会社に準備されていません。保存済みの結果は確認できます。申告の準備について給与担当へお問い合わせください。',
                    en: 'This company has no installed rules for this tax year. Saved results remain available. Contact payroll about preparing a declaration.',
                  })}
                </p>
              ) : null}
              {frozen ? (
                <p className="account-help">
                  {t({
                    ja: '確定済みです。訂正が必要な場合は給与担当へ連絡してください。',
                    en: 'This year is confirmed. Contact payroll if a correction is needed.',
                  })}
                </p>
              ) : null}
            </>
          )}
        </WorkforcePanel>
        {data.adjustments.map((row) => (
          <WorkforcePanel key={row.id} title={t({ ja: '年末調整の結果', en: 'Year-end result' })} icon="wallet">
            <WorkforceStatus status={row.status} />
            <div className="workforce-record-meta">
              <span>
                {t({ ja: '還付', en: 'Refund' })}: <WorkforceMoney value={row.refund} />
              </span>
              <span>
                {t({ ja: '追加徴収', en: 'Additional withholding' })}: <WorkforceMoney value={row.additionalTax} />
              </span>
            </div>
            {row.settledOn ? (
              <p>
                {row.settledOn} · {row.settlementReference}
              </p>
            ) : (
              <p>{t({ ja: '精算記録はまだありません。', en: 'Settlement has not been recorded yet.' })}</p>
            )}
            <details>
              <summary>{t({ ja: '計算内訳を確認', en: 'Review calculation' })}</summary>
              <FiscalCalculation row={row} />
            </details>
          </WorkforcePanel>
        ))}
        {editing ? (
          <FiscalDeclaration
            taxYear={editing.taxYear}
            readOnly={data.taxYear !== editing.taxYear || !data.supportedTaxYears.includes(editing.taxYear)}
            original={editing.declaration}
            current={data.declaration}
            onClose={() => setEditing(undefined)}
          />
        ) : null}
      </div>
    </ReadRecoveryProvider>
  );
}
