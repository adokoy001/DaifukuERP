import { useCallback, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMeta } from '../api/queries.ts';
import { useShiftBoard, useShiftSites } from '../api/shifts.ts';
import { getCompanyId, getUser } from '../api/client.ts';
import { ShiftPlanner } from '../components/shift-planner.tsx';
import { ReadRecoveryProvider, ReadRefreshNotice } from '../components/read-refresh-notice.tsx';
import { WorkforceHero } from '../components/workforce-shell.tsx';
import { WorkforceError } from '../components/workforce-shared.tsx';
import { useLocale } from '../i18n.tsx';
import { canRetainData } from '../lib/read-recovery.ts';
import { shiftMonday } from '../lib/shift.ts';
import '../shifts.css';
function Board({ siteId, weekStart, actions, onGuard }: { siteId: string; weekStart: string; actions: string[]; onGuard: (value: boolean, busy: boolean) => void }) {
  const query = useShiftBoard(siteId, weekStart), { t } = useLocale();
  if (query.isError && !canRetainData(query)) return <WorkforceError error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <p role="status">{t({ ja: 'シフト資料を読込中…', en: 'Loading planning sources…' })}</p>;
  const user = getUser(), key = `${user?.tenantId}:${user?.id}:${getCompanyId()}:${siteId}:${weekStart}`;
  return <ReadRecoveryProvider sources={[query]}><ReadRefreshNotice /><button className="btn shift-refresh" disabled={query.isFetching} onClick={() => void query.refetch()}>{t({ ja: '最新の資料を確認', en: 'Refresh planning sources' })}</button><ShiftPlanner key={key} scopeKey={key} board={query.data} actions={actions} refresh={async () => { const result = await query.refetch(); return result.isError ? undefined : result.data; }} onGuard={onGuard} /></ReadRecoveryProvider>;
}
export function ShiftPage() {
  const { t } = useLocale(), meta = useMeta(), allowed = Boolean(meta.data?.actions.some((action) => action.name === 'workforce.shift_board'));
  const sites = useShiftSites(allowed), [site, setSite] = useState(''), [week, setWeek] = useState(() => shiftMonday()), [guarded, setGuarded] = useState(false), [busy, setBusy] = useState(false);
  const onGuard = useCallback((value: boolean, locked: boolean) => { setGuarded(value); setBusy(locked); }, []);
  const change = (work: () => void) => { if (!guarded || globalThis.confirm(t({ ja: '未保存のシフト案・推薦を破棄して切り替えますか？', en: 'Discard the unsaved plan or recommendation and switch?' }))) work(); };
  if ((meta.isError && !canRetainData(meta)) || (sites.isError && !canRetainData(sites))) return <div className="workspace-page"><WorkforceError error={meta.error ?? sites.error} /></div>;
  if (!meta.data) return <p role="status">{t({ ja: '読込中…', en: 'Loading…' })}</p>;
  if (!allowed) return <div className="workspace-page"><p className="notice">{t({ ja: 'この会社でシフトを管理する権限がありません。', en: 'You cannot manage shifts in this company.' })}</p></div>;
  const siteId = sites.data?.items.some((row) => row.id === site) ? site : sites.data?.items[0]?.id ?? '';
  return <ReadRecoveryProvider sources={[meta, sites]}><div className="workspace-page workforce-page shift-page" data-testid="shift-page"><ReadRefreshNotice /><WorkforceHero management title={t({ ja: 'みんなの希望を、働きやすい一週間へ。', en: 'Turn team preferences into a workable week.' })} description={t({ ja: '必要人数と勤務条件を確認し、推薦案を整えて社員へ公開します。', en: 'Check staffing needs and work profiles, refine a recommendation and publish it to employees.' })} /><Link className="btn" to="/workforce">{t({ ja: '社員・勤怠管理へ', en: 'Workforce management' })}</Link><div className="workforce-toolbar"><label>{t({ ja: '計画する拠点', en: 'Planning site' })}<select className="input" disabled={busy} value={siteId} onChange={(event) => change(() => setSite(event.target.value))}>{sites.data?.items.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label>{t({ ja: '計画する週（月曜）', en: 'Planning week (Monday)' })}<input className="input" type="date" disabled={busy} value={week} onChange={(event) => { if (event.target.value) change(() => setWeek(shiftMonday(event.target.value))); }} /></label><span className="shift-muted">Asia/Tokyo · 7{t({ ja: '日間', en: ' days' })}</span></div>{siteId ? <Board key={`${siteId}:${week}`} siteId={siteId} weekStart={week} actions={meta.data.actions.map((action) => action.name)} onGuard={onGuard} /> : <p className="workforce-notice">{t({ ja: '有効な拠点を人事担当者に登録してもらってください。', en: 'Ask HR to create an active work site.' })}</p>}</div></ReadRecoveryProvider>;
}
