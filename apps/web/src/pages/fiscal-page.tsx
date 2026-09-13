import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getUser } from '../api/client.ts';
import { useFiscalBoard, usePayrollRuleCatalog, type FiscalBoard } from '../api/fiscal.ts';
import { useMeta } from '../api/queries.ts';
import { useManagementPortal, type PayrollSummary } from '../api/workforce.ts';
import { FiscalConditions } from '../components/fiscal-conditions.tsx';
import { FiscalPayrollCalculate, FiscalPayrollEvidence } from '../components/fiscal-payroll.tsx';
import { FiscalYearEnd } from '../components/fiscal-year-end.tsx';
import { PayrollRuleManager } from '../components/payroll-rule-manager.tsx';
import { WorkforcePayroll } from '../components/workforce-payroll.tsx';
import { ReadRecoveryProvider, ReadRefreshNotice } from '../components/read-refresh-notice.tsx';
import { WorkforceHero, WorkforceTabs } from '../components/workforce-shell.tsx';
import { WorkforceEmpty, WorkforceError, WorkforcePanel } from '../components/workforce-shared.tsx';
import { useLocale } from '../i18n.tsx';
import { businessToday } from '../lib/operations.ts';
import { canRetainData } from '../lib/read-recovery.ts';
import { supportedPayrollBundle, supportedYearEndBundle } from '../lib/payroll-rules.ts';
import { LoadingView } from './status-views.tsx';
import '../fiscal.css';
const lastMonth = () => {
  const date = new Date(businessToday() + 'T00:00:00Z');
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
};
const tabs = [
  { id: 'conditions', label: { ja: '税・保険の条件', en: 'Tax and insurance' }, icon: 'people' as const },
  { id: 'payroll', label: { ja: '給与の算定', en: 'Payroll' }, icon: 'wallet' as const },
  { id: 'year-end', label: { ja: '年末調整', en: 'Year-end' }, icon: 'document' as const },
  { id: 'evidence', label: { ja: '支払の証跡', en: 'Payment evidence' }, icon: 'check' as const },
];
export function FiscalPage() {
  const { t } = useLocale(),
    meta = useMeta();
  const [tab, setTab] = useState('conditions'),
    [taxYear, setTaxYear] = useState<number>(),
    [period, setPeriod] = useState(lastMonth),
    [employeeId, setEmployeeId] = useState('');
  const [calculate, setCalculate] = useState<{
      employee: FiscalBoard['employees'][number];
      original?: PayrollSummary;
    }>(),
    [evidence, setEvidence] = useState<PayrollSummary>();
  const actions = meta.data?.actions.map((action) => action.name) ?? [],
    allowed = actions.includes('workforce.fiscal_board'),
    canViewRules = actions.includes('workforce.payroll_rule_catalog'),
    catalog = usePayrollRuleCatalog(canViewRules),
    fiscal = useFiscalBoard(allowed, taxYear),
    payroll = useManagementPortal(period, allowed);
  useEffect(() => {
    if (taxYear === undefined && fiscal.data) setTaxYear(fiscal.data.taxYear);
  }, [fiscal.data, taxYear]);
  if (!meta.data && !meta.isError) return <LoadingView />;
  const requiredSources = [meta, fiscal, payroll],
    sources = [...requiredSources, ...(canViewRules ? [catalog] : [])];
  const failed = requiredSources.find((source) => source.isError && !canRetainData(source));
  if (failed)
    return (
      <div className="workspace-page workforce-page">
        <WorkforceError
          error={failed.error}
          onRetry={() => {
            void meta.refetch();
            void fiscal.refetch();
            void payroll.refetch();
            if (canViewRules) void catalog.refetch();
          }}
        />
      </div>
    );
  if (!allowed)
    return (
      <div className="workspace-page workforce-page">
        <p role="alert">
          {t({
            ja: '税・保険と年末調整は給与本部の権限が必要です。',
            en: 'Payroll headquarters permission is required for tax, insurance and year-end adjustment.',
          })}
        </p>
      </div>
    );
  if (!fiscal.data || !payroll.data) return <LoadingView />;
  const data = fiscal.data,
    payrolls = payroll.data.payrolls,
    selected = data.employees.find((employee) => employee.id === employeeId),
    visible = payrolls.filter((row) => !selected || row.employeeId === selected.id),
    selfEmployeeId = payroll.data.employees.find((employee) => employee.userId === getUser()?.id)?.id;
  const selectedYear = data.taxYear,
    bundles = canViewRules && !catalog.isError ? (catalog.data?.bundles ?? []) : [],
    payrollRule = supportedPayrollBundle(bundles, selectedYear, period),
    yearEndRule = supportedYearEndBundle(bundles, selectedYear),
    years = [...new Set([selectedYear, ...data.availableTaxYears, ...bundles.map((bundle) => bundle.taxYear)])].sort(
      (a, b) => b - a,
    );
  const prior = selected
    ? payrolls.find((row) => row.employeeId === selected.id && row.status !== 'cancelled')
    : undefined;
  return (
    <ReadRecoveryProvider sources={sources}>
      <div className="workspace-page workforce-page" data-testid="fiscal-management">
        <ReadRefreshNotice />
        <WorkforceHero
          title={t({ ja: '給与の根拠を、ひとつにつなぐ。', en: 'Payroll with a clear chain of evidence.' })}
          description={t({
            ja: '本人条件、月次の税・保険、年末調整と実精算。確認する場所がわかる給与本部のワークスペース。',
            en: 'Employee conditions, monthly tax and insurance, annual adjustment and settlement. A payroll workspace that makes each review clear.',
          })}
          management
          side={
            <>
              <strong>{selectedYear}</strong>
              <span>{t({ ja: '国内給与・年末調整', en: 'Japanese payroll and year-end' })}</span>
            </>
          }
        />
        <div className="fiscal-toolbar">
          <label>
            {t({ ja: '税年', en: 'Tax year' })}
            <select
              className="input"
              aria-label={t({ ja: '税年', en: 'Tax year' })}
              value={selectedYear}
              onChange={(event) => setTaxYear(Number(event.target.value))}
            >
              {years.map((year) => (
                <option value={year} key={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t({ ja: '従業員', en: 'Employee' })}
            <select
              aria-label={t({ ja: '従業員', en: 'Employee' })}
              className="input"
              value={selected?.id ?? ''}
              onChange={(event) => setEmployeeId(event.target.value)}
            >
              <option value="">{t({ ja: '全従業員', en: 'All employees' })}</option>
              {data.employees.map((employee) => (
                <option value={employee.id} key={employee.id}>
                  {employee.code} · {employee.name}
                </option>
              ))}
            </select>
          </label>
          <Link className="btn" to="/workforce">
            {t({ ja: '勤怠・従業員管理へ', en: 'Attendance and people' })}
          </Link>
          {actions.includes('workforce.work_system_board') ? (
            <Link className="btn" to="/workforce/systems">
              {t({ ja: '勤務制度を確認', en: 'Review working-time systems' })}
            </Link>
          ) : null}
        </div>
        {canViewRules && catalog.isError ? (
          <WorkforcePanel title={t({ ja: '制度の版と出典', en: 'Rule versions and sources' })} icon="document">
            <p>
              {t({
                ja: '制度情報を確認できないため、新しい自動算定と導入を停止しています。保存済みの記録は引き続き閲覧できます。',
                en: 'Rule information is unavailable, so new automatic calculations and installation are paused. Saved records remain readable.',
              })}
            </p>
            <WorkforceError error={catalog.error} onRetry={() => void catalog.refetch()} />
          </WorkforcePanel>
        ) : canViewRules && catalog.data ? (
          <PayrollRuleManager key={selectedYear} catalog={catalog.data} taxYear={selectedYear} actions={actions} />
        ) : null}
        <WorkforceTabs tabs={tabs} selected={tab} onSelect={setTab} />
        {tab === 'conditions' ? <FiscalConditions data={data} employeeId={selected?.id ?? ''} /> : null}
        {tab === 'year-end' ? (
          <FiscalYearEnd
            key={selectedYear}
            data={data}
            rule={yearEndRule}
            employeeId={selected?.id ?? ''}
            {...(selfEmployeeId ? { selfEmployeeId } : {})}
          />
        ) : null}
        {['payroll', 'evidence'].includes(tab) ? (
          <>
            <div className="fiscal-toolbar">
              <label>
                {t({ ja: '給与対象月', en: 'Payroll month' })}
                <input
                  className="input"
                  type="month"
                  value={period}
                  onChange={(event) => {
                    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setPeriod(event.target.value);
                  }}
                />
              </label>
              {tab === 'payroll' ? (
                <button
                  className="btn btn-primary"
                  disabled={!selected || !payrollRule || prior?.status === 'confirmed'}
                  onClick={() => {
                    if (selected) setCalculate({ employee: selected, ...(prior ? { original: prior } : {}) });
                  }}
                >
                  {t({
                    ja: '選択した従業員の税・保険込みで算定',
                    en: 'Calculate selected employee with tax and insurance',
                  })}
                </button>
              ) : null}
            </div>
            {tab === 'payroll' && !payrollRule ? (
              <p className="workforce-notice" role="status">
                {t({
                  ja: 'この給与対象月と税年を計算できる導入済み制度がありません。制度の対応期間と導入状況を確認してください。保存済みの給与は閲覧できます。',
                  en: 'No installed package supports this payroll month and tax year. Review package periods and installation status. Saved payroll remains readable.',
                })}
              </p>
            ) : null}
            {tab === 'payroll' ? (
              <WorkforcePayroll rows={visible} actions={actions} {...(selfEmployeeId ? { selfEmployeeId } : {})} />
            ) : (
              <WorkforcePanel
                title={t({ ja: '確定給与の支払証跡', en: 'Confirmed payroll payment evidence' })}
                icon="document"
              >
                {visible
                  .filter((row) => row.status === 'confirmed')
                  .map((row) => {
                    const found = data.taxEvidence.find((item) => item.payrollId === row.id);
                    return (
                      <article className="workforce-record" key={row.id}>
                        <h3>
                          {row.employeeName} · {row.period}
                        </h3>
                        {found ? (
                          <>
                            <p>
                              {found.paymentDate} · {t({ ja: '課税支給', en: 'Taxable pay' })}: {found.taxablePay}
                            </p>
                            <p>{found.basis}</p>
                          </>
                        ) : (
                          <button
                            className="btn"
                            disabled={row.employeeId === selfEmployeeId || Boolean(row.calculation.statutory)}
                            onClick={() => setEvidence(row)}
                          >
                            {t({ ja: '原資料から支払証跡を登録', en: 'Add payment evidence from source records' })}
                          </button>
                        )}
                      </article>
                    );
                  })}
                {!visible.some((row) => row.status === 'confirmed') ? (
                  <WorkforceEmpty>
                    {t({ ja: '対象月に確定給与がありません。', en: 'No confirmed payroll for this month.' })}
                  </WorkforceEmpty>
                ) : null}
              </WorkforcePanel>
            )}
          </>
        ) : null}
        {calculate ? (
          <FiscalPayrollCalculate
            employee={calculate.employee}
            period={period}
            original={calculate.original}
            current={payrolls.find((row) => row.employeeId === calculate.employee.id && row.status !== 'cancelled')}
            rule={payrollRule}
            onClose={() => setCalculate(undefined)}
          />
        ) : null}
        {evidence ? <FiscalPayrollEvidence row={evidence} onClose={() => setEvidence(undefined)} /> : null}
      </div>
    </ReadRecoveryProvider>
  );
}
