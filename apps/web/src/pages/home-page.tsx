import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useDocstatusCounts } from '../api/dashboard.ts';
import { useMeta } from '../api/queries.ts';
import { reportActions } from '../api/reports.ts';
import type { EntityMeta } from '../api/types.ts';
import { CountValue, DashboardSummary, QuickStart, type CountLookup } from '../components/dashboard-summary.tsx';
import { Icon, moduleIcon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import { DOCSTATUSES, groupByModule, type ModuleGroup } from '../lib/dashboard.ts';
import { DOCSTATUS_LABELS } from '../lib/format.ts';
import { reportTitle } from '../lib/report.ts';
import { S } from '../strings.ts';
import { LoadingView, MetaError } from './status-views.tsx';

function DocCard({ entity, count }: { entity: EntityMeta; count: CountLookup }) {
  const { t } = useLocale();
  return <article data-testid="doc-card" data-entity={entity.name} className="document-card">
    <header><span className="document-icon"><Icon name={moduleIcon(entity.module ?? '')} /></span>
      <Link to="/e/$entity" params={{ entity: entity.name }}>{t(entity.label)}</Link>
      <Link to="/e/$entity" params={{ entity: entity.name }} className="card-arrow" aria-label={`${t(entity.label)} ${t(S.list)}`}><Icon name="arrow" size={18} /></Link>
    </header>
    <dl>{DOCSTATUSES.map((ds) => <div key={ds} data-docstatus={ds}><dt><span className={`status-dot status-${ds}`} />{t(DOCSTATUS_LABELS[ds])}</dt><dd data-testid="doc-count"><CountValue cell={count(entity.name, ds)} /></dd></div>)}</dl>
    <footer><Link to="/e/$entity" params={{ entity: entity.name }}>{t({ ja: '記録を確認', en: 'View records' })}</Link>
      {entity.ops.includes('create') ? <Link to="/e/$entity/new" params={{ entity: entity.name }} className="create-link"><Icon name="plus" size={14} />{t(S.new)}</Link> : null}
    </footer>
  </article>;
}

function ModuleSection({ group, count }: { group: ModuleGroup; count: CountLookup }) {
  const { t } = useLocale();
  return <section data-testid="module-section" data-module={group.name} className="module-section">
    <div className="section-heading"><h2><Icon name={moduleIcon(group.name)} size={18} />{t(group.label)}</h2><span>{group.documents.length + group.masters.length} {t({ ja: 'メニュー', en: 'menus' })}</span></div>
    {group.documents.length ? <div className="document-grid">{group.documents.map((e) => <DocCard key={e.name} entity={e} count={count} />)}</div> : null}
    {group.masters.length ? <div className="master-links">{group.masters.map((e) => <Link key={e.name} to="/e/$entity" params={{ entity: e.name }}>{t(e.label)}<Icon name="arrow" size={13} /></Link>)}</div> : null}
  </section>;
}

function Dashboard({ groups, reports }: { groups: ModuleGroup[]; reports: ReturnType<typeof reportActions> }) {
  const { t } = useLocale();
  const documents = useMemo(() => groups.flatMap((g) => g.documents), [groups]);
  const count = useDocstatusCounts(documents);
  return <>
    <DashboardSummary documents={documents} count={count} reportCount={reports.length} />
    <QuickStart documents={documents} />
    <div className="dashboard-body"><div className="business-sections"><div className="section-intro"><h2>{t({ ja: '業務をつなぐ', en: 'Your business, connected' })}</h2><p>{t({ ja: '日々の記録から、集計・確認まで。', en: 'From everyday records to a clear overview.' })}</p></div>
      {groups.map((g) => <ModuleSection key={g.name || '_other'} group={g} count={count} />)}
      {documents.length === 0 ? <p className="notice">{t(S.noDocuments)}</p> : null}
    </div><aside className="dashboard-rail">
      <section className="report-card" data-testid="reports-section"><div className="section-heading"><h2><Icon name="chart" />{t(S.reports)}</h2><span>{reports.length}</span></div><p>{t({ ja: '必要な数字を、必要なときに。', en: 'The numbers you need, when you need them.' })}</p>
        <div className="report-links">{reports.slice(0, 8).map((a) => <Link key={a.name} to="/r/$action" params={{ action: a.name }}><span>{t(reportTitle(a))}</span><Icon name="arrow" size={15} /></Link>)}</div>
        {reports.length > 8 ? <details><summary>{t({ ja: 'すべてのレポート', en: 'All reports' })} ({reports.length})</summary><div className="report-links">{reports.slice(8).map((a) => <Link key={a.name} to="/r/$action" params={{ action: a.name }}>{t(reportTitle(a))}</Link>)}</div></details> : null}
      </section>
      <section className="guide-card"><span className="icon-tile"><Icon name="spark" /></span><h2>{t({ ja: 'ひとつずつ、確かな記録に。', en: 'One clear record at a time.' })}</h2><p>{t({ ja: '下書きで内容を整え、保存してから確定。日々の積み重ねが、会社の見える化につながります。', en: 'Prepare a draft, save your changes, then submit. Each record adds clarity to your business.' })}</p><ol><li>{t({ ja: '下書きを作成', en: 'Create a draft' })}</li><li>{t({ ja: '内容を確認・保存', en: 'Review and save' })}</li><li>{t({ ja: '確定して記録', en: 'Submit the record' })}</li></ol></section>
    </aside></div>
  </>;
}

export function HomePage() {
  const { t, locale } = useLocale();
  const meta = useMeta();
  const groups = useMemo(() => meta.data ? groupByModule(meta.data, S.allEntities) : [], [meta.data]);
  const reports = useMemo(() => reportActions(meta.data), [meta.data]);
  const date = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  return <div className="workspace-page">
    <header className="welcome-header"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>{t({ ja: '今日の仕事を、ここから。', en: 'A clear start to your day.' })}</h1><p>{t({ ja: 'つながる記録。見渡せる業務。大福帳へようこそ。', en: 'Connected records. A clearer business. Welcome to Daifuku.' })}</p></div><div className="date-chip"><Icon name="clock" size={16} />{date}</div></header>
    <div className="template-home-entry"><span>{t({ ja: '電器店・農家・飲食チェーンなど、仕事の形に合わせて。', en: 'Find a starting point for your store, farm or restaurant chain.' })}</span><Link to="/templates"><Icon name="spark" size={17} />{t({ ja: '業界テンプレートを見る', en: 'Explore templates' })}<Icon name="arrow" size={15} /></Link></div>
    {meta.isError ? <MetaError error={meta.error} retry={() => void meta.refetch()} /> : null}
    {meta.isPending ? <LoadingView /> : null}
    {meta.data ? <Dashboard groups={groups} reports={reports} /> : null}
  </div>;
}
