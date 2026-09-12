import { Link } from '@tanstack/react-router';
import { useMe } from '../api/company.tsx';
import { useState } from 'react';
import { reportActions } from '../api/reports.ts';
import { canEditSettings } from '../api/settings.ts';
import type { AppMeta, Locale, MenuItem } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { reportTitle } from '../lib/report.ts';
import { S } from '../strings.ts';
import { Icon, moduleIcon } from './icon.tsx';

interface SidebarProps {
  meta: AppMeta | undefined;
  userName: string | undefined;
  onLogout: () => void;
  open: boolean;
  onClose: () => void;
}
const LINK = 'nav-link';
const ACTIVE = { className: 'nav-link is-active' };

function MenuLink({ item }: { item: MenuItem }) {
  const { t } = useLocale();
  if (item.entity) return <Link to="/e/$entity" params={{ entity: item.entity }} className={LINK} activeProps={ACTIVE}>{t(item.label)}</Link>;
  const report = /^\/r\/([^/?#]+)$/.exec(item.route ?? '');
  if (report?.[1]) return <Link to="/r/$action" params={{ action: report[1] }} className={LINK} activeProps={ACTIVE}>{t(item.label)}</Link>;
  const action = /^\/a\/([^/?#]+)$/.exec(item.route ?? '');
  if (action?.[1]) return <Link to="/a/$action" params={{ action: action[1] }} className={LINK} activeProps={ACTIVE}>{t(item.label)}</Link>;
  if (item.route === '/settings') return <Link to="/settings" className={LINK} activeProps={ACTIVE}>{t(item.label)}</Link>;
  return null;
}

function LocaleToggle() {
  const { locale, setLocale, t } = useLocale();
  return <div className="locale-toggle">{(['ja', 'en'] as const).map((l: Locale) =>
    <button type="button" key={l} aria-pressed={locale === l} aria-label={`${t(S.language)}: ${l}`} onClick={() => setLocale(l)}>{l.toUpperCase()}</button>,
  )}</div>;
}

function Navigation({ meta }: { meta: AppMeta | undefined }) {
  const { t } = useLocale();
  const [filter, setFilter] = useState('');
  const reports = reportActions(meta);
  const me = useMe();
  const lineNames = new Set(meta?.entities.flatMap((e) => (e.lines ?? []).map((line) => line.entity)));
  const entities = (meta?.entities ?? []).filter((e) => !lineNames.has(e.name));
  const searchable = entities.filter((e) => t(e.label).toLowerCase().includes(filter.toLowerCase()));
  return <>
    <Link to="/" className={LINK} activeProps={ACTIVE} activeOptions={{ exact: true }}><Icon name="home" size={18} />{t({ ja: 'ワークスペース', en: 'Workspace' })}</Link>
    {meta?.actions.some((a) => a.name === 'workforce.my_portal') ? <Link to="/me" className={LINK} activeProps={ACTIVE}><Icon name="people" size={18} />{t({ ja: '自分の勤怠・申請', en: 'My workday' })}</Link> : null}
    {meta?.actions.some((a) => a.name === 'workforce.management_portal') ? <Link to="/workforce" className={LINK} activeProps={ACTIVE}><Icon name="calendar" size={18} />{t({ ja: '従業員・勤怠管理', en: 'Workforce management' })}</Link> : null}
    <Link to="/templates" className={LINK} activeProps={ACTIVE}><Icon name="spark" size={18} />{t({ ja: '業界テンプレート', en: 'Industry templates' })}</Link>
    {meta?.actions.some((a) => a.name === 'restaurant_chain.operations_snapshot') ? <Link to="/operations" className={LINK} activeProps={ACTIVE}><Icon name="building" size={18} />{t({ ja: 'チェーン運営', en: 'Chain operations' })}</Link> : null}
    {reports.length ? <Link to="/reports" className={LINK} activeProps={ACTIVE}><Icon name="chart" size={18} />{t({ ja: 'BI・レポート', en: 'BI and reports' })}</Link> : null}
    {me.data?.user.tenantAdmin ? <Link to="/admin/users" className={LINK} activeProps={ACTIVE}><Icon name="people" size={18} />{t({ ja: '利用者と権限', en: 'Users and access' })}</Link> : null}
    <div className="nav-caption">{t({ ja: '業務メニュー', en: 'Your business' })}</div>
    {(meta?.modules ?? []).filter((m) => m.menus.length > 0).map((m) => <section className="nav-group" key={m.name}>
      <h2><Icon name={moduleIcon(m.name)} size={15} />{t(m.label)}</h2>
      {[...m.menus].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((item, i) => <MenuLink key={item.entity ?? item.route ?? i} item={item} />)}
    </section>)}
    {reports.length ? <details className="nav-details"><summary><Icon name="chart" size={17} />{t(S.reports)}<span>{reports.length}</span></summary>
      {reports.map((a) => <Link key={a.name} to="/r/$action" params={{ action: a.name }} className={LINK} activeProps={ACTIVE}>{t(reportTitle(a))}</Link>)}
    </details> : null}
    <details className="nav-details"><summary><Icon name="box" size={17} />{t(S.allEntities)}</summary>
      <input type="search" className="nav-search" aria-label={t(S.search)} placeholder={t(S.search)} value={filter} onChange={(e) => setFilter(e.target.value)} />
      {searchable.map((e) => <MenuLink key={e.name} item={{ label: e.label, entity: e.name }} />)}
    </details>
    {canEditSettings(meta?.roles) ? <Link to="/settings" className={LINK} activeProps={ACTIVE} data-testid="nav-settings"><Icon name="settings" size={18} />{t(S.settings)}</Link> : null}
  </>;
}

export function Sidebar({ meta, userName, onLogout, open, onClose }: SidebarProps) {
  const { t } = useLocale();
  return <>
    {open ? <button type="button" className="nav-scrim" onClick={onClose} aria-label={t(S.close)} /> : null}
    <aside id="app-navigation" className={`app-sidebar ${open ? 'is-open' : ''}`}>
      <div className="brand-row">
        <Link to="/" className="brand" onClick={onClose}><span className="brand-mark">大</span><span>Daifuku<small>{t({ ja: '日々の仕事を、ひとつに。', en: 'Every day, connected.' })}</small></span></Link>
        <button type="button" className="mobile-close" onClick={onClose} aria-label={t(S.close)}><Icon name="close" /></button>
      </div>
      <nav aria-label={t(S.menu)} className="sidebar-nav" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) onClose(); }}><Navigation meta={meta} /></nav>
      <footer className="sidebar-footer">
        <div className="user-row"><span className="user-avatar">{(userName ?? 'D').slice(0, 1).toUpperCase()}</span><span className="user-name">{userName}<small>{t({ ja: 'ログイン中', en: 'Signed in' })}</small></span><button type="button" onClick={onLogout} title={t(S.logout)} aria-label={t(S.logout)}><Icon name="logout" size={17} /></button></div>
        <div className="sidebar-meta"><span>DAIFUKU WORKSPACE</span><LocaleToggle /></div>
      </footer>
    </aside>
  </>;
}
