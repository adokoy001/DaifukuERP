import { useState } from 'react';
import { getUser } from '../api/client.ts';
import { useMeta } from '../api/queries.ts';
import { useManagementPortal } from '../api/workforce.ts';
import { WorkforceCalculate, WorkforcePeople } from '../components/workforce-people.tsx';
import { WorkforcePayroll } from '../components/workforce-payroll.tsx';
import { WorkforceReceipts } from '../components/workforce-receipts.tsx';
import { WorkforceReviews } from '../components/workforce-reviews.tsx';
import { WorkforceHero, WorkforceMetric, WorkforceTabs, type WorkforceTab } from '../components/workforce-shell.tsx';
import { WorkforceEmpty, WorkforceError, WorkforceMoney, WorkforcePanel, WorkforceStatus } from '../components/workforce-shared.tsx';
import { useLocale } from '../i18n.tsx';
import { businessToday } from '../lib/operations.ts';
import { minutesLabel, timeLabel } from '../lib/workforce.ts';
import { LoadingView } from './status-views.tsx';

const tabs: WorkforceTab[] = [
  { id: 'overview', label: { ja: '確認待ち', en: 'Review' }, icon: 'check' },
  { id: 'attendance', label: { ja: '勤怠', en: 'Attendance' }, icon: 'clock' },
  { id: 'expenses', label: { ja: '経費', en: 'Expenses' }, icon: 'wallet' },
  { id: 'people', label: { ja: '従業員', en: 'People' }, icon: 'people' },
  { id: 'payroll', label: { ja: '給与', en: 'Payroll' }, icon: 'document' },
];

export function WorkforcePage() {
  const { t, locale } = useLocale(), meta = useMeta();
  const [period, setPeriod] = useState(() => businessToday().slice(0, 7)), [siteId, setSiteId] = useState(''), [tab, setTab] = useState('overview'), [receiptId, setReceiptId] = useState<string>();
  const actions = meta.data?.actions.map((a) => a.name) ?? [], allowed = actions.includes('workforce.management_portal');
  const portal = useManagementPortal(period, allowed);
  if (!meta.data && !meta.isError) return <LoadingView />;
  if (meta.isError || portal.isError) return <div className="workspace-page workforce-page"><WorkforceError error={meta.error ?? portal.error} onRetry={() => { void meta.refetch(); void portal.refetch(); }} /></div>;
  if (!allowed) return <div className="workspace-page workforce-page"><p className="workforce-notice">{t({ ja: 'この会社で従業員を管理する権限がありません。', en: 'Workforce management is unavailable in this company.' })}</p></div>;
  if (!portal.data) return <LoadingView />;
  const source = portal.data, selectedSite = source.sites.some((s) => s.id === siteId) ? siteId : '';
  const employees = source.employees.filter((e) => !selectedSite || e.siteId === selectedSite), ids = new Set(employees.map((e) => e.id));
  const data = { ...source, employees, attendances: source.attendances.filter((r) => ids.has(r.employeeId)), corrections: source.corrections.filter((r) => ids.has(r.employeeId)), leaveRequests: source.leaveRequests.filter((r) => ids.has(r.employeeId)), expenses: source.expenses.filter((r) => ids.has(r.employeeId)), payrolls: source.payrolls.filter((r) => ids.has(r.employeeId)) };
  const selfEmployeeId = source.employees.find((e) => e.userId === getUser()?.id)?.id;
  const selfProps = selfEmployeeId ? { selfEmployeeId } : {};
  const canPayroll = ['workforce.calculate_payroll', 'workforce.confirm_payroll', 'workforce.cancel_payroll'].some((action) => actions.includes(action));
  const visibleTabs = tabs.filter((item) => item.id !== 'payroll' || canPayroll), selectedTab = visibleTabs.some((item) => item.id === tab) ? tab : 'overview';
  const receipt = data.expenses.find((r) => r.id === receiptId);
  return <div className="workspace-page workforce-page" data-testid="workforce-management">
    <WorkforceHero title={t({ ja: '人と仕事の、いまが見える。', en: 'People and work, in view.' })} description={t({ ja: '拠点の勤怠、申請、本部の給与業務。確認が必要な仕事から、ひとつずつ。', en: 'Attendance, requests and payroll. Start with the work awaiting your review.' })} management side={<><strong>{data.period.replace('-', '.')}</strong><span>{t({ ja: '権限のある拠点だけを表示', en: 'Authorized sites only' })}</span></>} />
    <div className="workforce-toolbar"><label>{t({ ja: '表示する月', en: 'Month' })}<input className="input" type="month" value={period} onChange={(e) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setPeriod(e.target.value); }} /></label><label>{t({ ja: '表示する拠点', en: 'Work site' })}<select className="input" aria-label={t({ ja: '表示する拠点', en: 'Work site' })} value={selectedSite} onChange={(e) => setSiteId(e.target.value)}><option value="">{t({ ja: 'アクセスできる全拠点', en: 'All accessible sites' })}</option>{source.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button type="button" className="btn" disabled={portal.isFetching} onClick={() => void portal.refetch()}>{t({ ja: '最新の状態を確認', en: 'Refresh' })}</button></div>
    <div className="workforce-metrics"><WorkforceMetric title={t({ ja: '勤怠・訂正の確認待ち', en: 'Attendance reviews' })} value={data.attendances.filter((r) => r.status === 'submitted').length + data.corrections.filter((r) => r.status === 'pending').length} note={t({ ja: '表示中の月・拠点', en: 'Selected month and sites' })} icon="clock" /><WorkforceMetric title={t({ ja: '有給の承認待ち', en: 'Paid leave requests' })} value={data.leaveRequests.filter((r) => r.status === 'pending').length} note={t({ ja: '確認待ちタブから承認', en: 'Review in the queue' })} icon="leaf" tone="cyan" /><WorkforceMetric title={t({ ja: '経費の確認・精算待ち', en: 'Expense tasks' })} value={data.expenses.filter((r) => ['submitted', 'approved'].includes(r.status)).length} note={t({ ja: '提出済み・承認済み', en: 'Submitted and approved' })} icon="wallet" tone="coral" /></div>
    <WorkforceTabs tabs={visibleTabs} selected={selectedTab} onSelect={setTab} />
    {selectedTab === 'overview' ? <WorkforceReviews data={data} actions={actions} {...selfProps} /> : null}
    {selectedTab === 'attendance' ? <div className="workforce-stack"><WorkforceReviews data={data} actions={actions} {...selfProps} category="attendance" /><WorkforcePanel title={t({ ja: '月の勤怠記録', en: 'Monthly attendance' })} icon="calendar">{data.attendances.length ? <div className="workforce-record-list">{data.attendances.map((r) => <article className="workforce-record" key={r.id}><header><h3>{r.employeeName} · {r.workDate}</h3><WorkforceStatus status={r.status} /></header><p>{timeLabel(r.clockIn)} — {timeLabel(r.clockOut)} · {minutesLabel(r.workedMinutes, locale)}</p><p>{t({ ja: '深夜時間', en: 'Night work' })}: {minutesLabel(r.nightMinutes, locale)}</p></article>)}</div> : <WorkforceEmpty>{t({ ja: 'この月の勤怠記録はありません。', en: 'No attendance records this month.' })}</WorkforceEmpty>}</WorkforcePanel></div> : null}
    {selectedTab === 'expenses' ? <div className="workforce-stack"><WorkforceReviews data={data} actions={actions} {...selfProps} category="expenses" /><WorkforcePanel title={t({ ja: '月の経費記録', en: 'Monthly expenses' })} icon="wallet">{data.expenses.length ? <div className="workforce-record-list">{data.expenses.map((r) => <article className="workforce-record" key={r.id}><header><h3>{r.employeeName} · {r.expenseDate}</h3><WorkforceStatus status={r.status} /></header><div className="workforce-record-meta"><span>{r.category}</span><WorkforceMoney value={r.amount} /></div><p>{r.description}</p>{r.paidOn ? <p>{r.paidOn} · {r.paymentReference}</p> : null}<button className="btn" type="button" onClick={() => setReceiptId(r.id)}>{t({ ja: '領収書を確認', en: 'View receipts' })}</button></article>)}</div> : <WorkforceEmpty>{t({ ja: 'この月の経費はありません。', en: 'No expenses this month.' })}</WorkforceEmpty>}</WorkforcePanel></div> : null}
    {selectedTab === 'people' ? <WorkforcePeople data={data} actions={actions} entities={meta.data?.entities ?? []} /> : null}
    {selectedTab === 'payroll' ? <div className="workforce-stack">{actions.includes('workforce.calculate_payroll') ? <div className="workforce-toolbar"><WorkforceCalculate data={data} period={period} /></div> : null}<WorkforcePayroll rows={data.payrolls} actions={actions} {...selfProps} /></div> : null}
    {receipt ? <WorkforceReceipts expense={receipt} canUpload={false} onClose={() => setReceiptId(undefined)} /> : null}
  </div>;
}
