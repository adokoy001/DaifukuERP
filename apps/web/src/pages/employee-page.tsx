import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMeta } from '../api/queries.ts';
import { useMyPortal } from '../api/workforce.ts';
import { WorkforceAttendance, WorkforceClock } from '../components/workforce-attendance.tsx';
import { WorkforceExpenses } from '../components/workforce-expenses.tsx';
import { WorkforceLeave } from '../components/workforce-leave.tsx';
import { EmployeeFiscal } from '../components/employee-fiscal.tsx';
import { EmployeeShifts } from '../components/employee-shifts.tsx';
import { WorkforcePayroll } from '../components/workforce-payroll.tsx';
import { WorkforceHero, WorkforceMetric, WorkforceTabs, type WorkforceTab } from '../components/workforce-shell.tsx';
import { WorkforceError } from '../components/workforce-shared.tsx';
import { useLocale } from '../i18n.tsx';
import { formatDecimal } from '../lib/format.ts';
import { businessToday } from '../lib/operations.ts';
import { LoadingView } from './status-views.tsx';
import { canRetainData } from '../lib/read-recovery.ts';
import { ReadRecoveryProvider, ReadRefreshNotice } from '../components/read-refresh-notice.tsx';

const tabs: WorkforceTab[] = [
  { id: 'today', label: { ja: '今日', en: 'Today' }, icon: 'home' },
  { id: 'shifts', label: { ja: 'シフト', en: 'Shifts' }, icon: 'calendar' },
  { id: 'attendance', label: { ja: '勤怠', en: 'Time' }, icon: 'clock' },
  { id: 'leave', label: { ja: '有給', en: 'Leave' }, icon: 'leaf' },
  { id: 'expenses', label: { ja: '経費', en: 'Expenses' }, icon: 'wallet' },
  { id: 'fiscal', label: { ja: '年末調整', en: 'Year-end' }, icon: 'document' },
  { id: 'payroll', label: { ja: '給与', en: 'Payslips' }, icon: 'document' },
];

export function EmployeePage() {
  const { t } = useLocale();
  const meta = useMeta();
  const [tab, setTab] = useState('today'), [period, setPeriod] = useState(() => businessToday().slice(0, 7));
  const actions = meta.data?.actions.map((a) => a.name) ?? [];
  const allowed = actions.includes('workforce.my_portal');
  const portal = useMyPortal(period, allowed);
  if (!meta.data && !meta.isError) return <LoadingView />;
  if ((meta.isError && !canRetainData(meta)) || (portal.isError && !canRetainData(portal))) return <div className="workspace-page workforce-page"><WorkforceError error={meta.isError && !canRetainData(meta) ? meta.error : portal.error} onRetry={() => { void meta.refetch(); void portal.refetch(); }} /></div>;
  if (!allowed) return <div className="workspace-page workforce-page"><p className="workforce-notice">{t({ ja: 'この会社で従業員ポータルを利用する権限がありません。管理者に会社所属と役割をご確認ください。', en: 'Employee portal access is unavailable in this company. Ask your administrator to review your membership and role.' })}</p></div>;
  if (!portal.data) return <LoadingView />;
  const data = portal.data;
  const pending = data.leaveRequests.filter((r) => r.status === 'pending').length + data.expenses.filter((r) => r.status === 'submitted').length + data.corrections.filter((r) => r.status === 'pending').length;
  const registered = Boolean(data.employee?.active);
  const attendance = <WorkforceAttendance rows={data.attendances} corrections={data.corrections} actions={actions} />;
  return <ReadRecoveryProvider sources={[meta, portal]}><div className="workspace-page workforce-page" data-testid="employee-portal">
    <ReadRefreshNotice />
    <WorkforceHero title={t({ ja: '今日も、おつかれさまです。', en: 'Your workday, made clearer.' })} description={t({ ja: '出退勤も、申請も、明細の確認も。自分の仕事の記録をひとつに。', en: 'Clock in, send requests and check payslips. Your work records, together.' })} {...(data.employee ? { name: data.employee.name, site: data.employee.code } : {})} side={<><strong>{data.today.replaceAll('-', '.')}</strong><span>{t({ ja: 'あなたのワークスペース', en: 'Your personal workspace' })}</span></>} />
    {!registered ? <p className="workforce-notice" role="status">{t({ ja: 'この会社の従業員登録が必要です。管理者へ、利用者アカウントと所属拠点の登録をご依頼ください。', en: 'An active employee record is required for this company. Ask your administrator to link your account and work site.' })}</p> : null}
    <WorkforceTabs tabs={tabs.filter((item) => (item.id !== 'shifts' || actions.includes('workforce.my_shifts')) && (item.id !== 'fiscal' || actions.includes('workforce.my_fiscal_portal')))} selected={tab} onSelect={setTab} />
    {!['shifts', 'fiscal'].includes(tab) ? <div className="workforce-toolbar"><label>{t({ ja: '表示する月', en: 'Month' })}<input className="input" type="month" value={period} onChange={(e) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setPeriod(e.target.value); }} /></label><button type="button" className="btn" disabled={portal.isFetching} onClick={() => void portal.refetch()}>{t({ ja: '最新の状態を確認', en: 'Refresh' })}</button></div> : null}
    {tab === 'today' ? <div className="workforce-today"><div className="workforce-metrics"><WorkforceMetric title={t({ ja: '有給の残り', en: 'Available leave' })} value={formatDecimal(data.leaveBalance) + t({ ja: ' 日', en: ' days' })} note={t({ ja: '有効な付与の残数', en: 'Remaining valid grants' })} icon="leaf" tone="cyan" /><WorkforceMetric title={t({ ja: '確認待ちの申請', en: 'Requests awaiting review' })} value={pending} note={t({ ja: '表示中の月の有給・訂正・経費', en: 'Leave, corrections and expenses this month' })} icon="clock" tone="coral" /><WorkforceMetric title={t({ ja: '確定した給与明細', en: 'Confirmed payslips' })} value={data.payrolls.filter((r) => r.status === 'confirmed').length} note={t({ ja: '給与タブで明細を確認できます', en: 'Open Payslips to view details' })} icon="document" /></div><div className="workforce-columns"><WorkforceClock attendance={data.attendance} today={data.today} registered={registered} onHistory={(month) => { setPeriod(month); setTab("attendance"); }} />{attendance}</div></div> : null}
    {tab === 'shifts' && actions.includes('workforce.my_shifts') ? <EmployeeShifts /> : null}
    {tab === 'attendance' ? attendance : null}
    {tab === 'leave' ? <WorkforceLeave balance={data.leaveBalance} requests={data.leaveRequests} today={data.today} actions={actions} registered={registered} onPeriod={setPeriod} /> : null}
    {tab === 'expenses' ? <WorkforceExpenses rows={data.expenses} today={data.today} actions={actions} registered={registered} onPeriod={setPeriod} /> : null}
    {tab === 'fiscal' && actions.includes('workforce.my_fiscal_portal') ? <EmployeeFiscal /> : null}
    {tab === 'payroll' ? <WorkforcePayroll rows={data.payrolls} actions={actions} self /> : null}
    <p className="workforce-footer-note">{t({ ja: '給与や申請内容を端末のオフライン用データとして保存しません。打刻と申請には通信が必要です。', en: 'Payslips and requests are not stored as offline app data. Clocking and requests need a connection.' })}{actions.includes('workforce.management_portal') ? <> <Link to="/workforce">{t({ ja: '従業員の管理画面へ', en: 'Open workforce management' })}</Link></> : null}</p>
  </div></ReadRecoveryProvider>;
}
