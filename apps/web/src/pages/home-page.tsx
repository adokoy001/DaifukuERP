import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useDocstatusCounts } from '../api/dashboard.ts';
import { useNavigation } from '../api/navigation.ts';
import { reportActions } from '../api/reports.ts';
import type { EntityMeta } from '../api/types.ts';
import { CountValue, DashboardSummary, QuickStart, type CountLookup } from '../components/dashboard-summary.tsx';
import { Icon, moduleIcon } from '../components/icon.tsx';
import { WorkspaceCards } from '../components/workspace-cards.tsx';
import { useLocale } from '../i18n.tsx';
import { DOCSTATUSES, groupByModule, type ModuleGroup } from '../lib/dashboard.ts';
import { DOCSTATUS_LABELS } from '../lib/format.ts';
import { workspaceForModule } from '../lib/navigation.ts';
import { reportTitle } from '../lib/report.ts';
import { canRetainData } from '../lib/read-recovery.ts';
import { S } from '../strings.ts';
import { LoadingView, MetaError } from './status-views.tsx';

function DocCard({ entity, count }: { entity: EntityMeta; count: CountLookup }) {
  const { t } = useLocale();
  return (
    <article data-testid="doc-card" data-entity={entity.name} className="document-card">
      <header>
        <span className="document-icon">
          <Icon name={moduleIcon(entity.module ?? '')} />
        </span>
        <Link to="/e/$entity" params={{ entity: entity.name }}>
          {t(entity.label)}
        </Link>
        <Link
          to="/e/$entity"
          params={{ entity: entity.name }}
          className="card-arrow"
          aria-label={`${t(entity.label)} ${t(S.list)}`}
        >
          <Icon name="arrow" size={18} />
        </Link>
      </header>
      <dl>
        {DOCSTATUSES.map((status) => (
          <div key={status} data-docstatus={status}>
            <dt>
              <span className={`status-dot status-${status}`} />
              {t(DOCSTATUS_LABELS[status])}
            </dt>
            <dd data-testid="doc-count">
              <CountValue cell={count(entity.name, status)} />
            </dd>
          </div>
        ))}
      </dl>
      <footer>
        <Link to="/e/$entity" params={{ entity: entity.name }}>
          {t({ ja: '記録を確認', en: 'View records' })}
        </Link>
        {entity.ops.includes('create') ? (
          <Link to="/e/$entity/new" params={{ entity: entity.name }} className="create-link">
            <Icon name="plus" size={14} />
            {t(S.new)}
          </Link>
        ) : null}
      </footer>
    </article>
  );
}

function SelectedModule({ group, reports }: { group: ModuleGroup; reports: ReturnType<typeof reportActions> }) {
  const { t } = useLocale();
  const count = useDocstatusCounts(group.documents);
  const related = reports.filter((report) => report.module === group.name);
  return (
    <>
      <DashboardSummary documents={group.documents} count={count} reportCount={related.length} />
      <QuickStart documents={group.documents} />
      <section data-testid="module-section" data-module={group.name} className="module-section">
        <div className="section-heading">
          <h2>
            <Icon name={moduleIcon(group.name)} size={18} />
            {t(group.label)}
          </h2>
          <Link to="/workspaces/$workspace" params={{ workspace: workspaceForModule(group.name) }}>
            {t({ ja: 'この分野の画面を見る', en: 'Explore this business area' })} →
          </Link>
        </div>
        <div className="document-grid">
          {group.documents.map((entity) => (
            <DocCard key={entity.name} entity={entity} count={count} />
          ))}
        </div>
        {!group.documents.length ? <p className="notice">{t(S.noDocuments)}</p> : null}
        {group.masters.length ? (
          <div className="master-links">
            {group.masters.slice(0, 8).map((entity) => (
              <Link key={entity.name} to="/e/$entity" params={{ entity: entity.name }}>
                {t(entity.label)}
                <Icon name="arrow" size={13} />
              </Link>
            ))}
          </div>
        ) : null}
      </section>
      <section data-testid="reports-section" className="home-report-links">
        <h2>{t({ ja: '関連レポート', en: 'Related reports' })}</h2>
        {related.slice(0, 5).map((report) => (
          <Link key={report.name} to="/r/$action" params={{ action: report.name }}>
            {t(reportTitle(report))}
          </Link>
        ))}
        <Link to="/workspaces/$workspace" params={{ workspace: 'reports' }}>
          {t({ ja: '分析・レポートを開く', en: 'Explore analytics and reports' })} →
        </Link>
      </section>
    </>
  );
}

function DocumentStatus({ groups, reports }: { groups: ModuleGroup[]; reports: ReturnType<typeof reportActions> }) {
  const { t } = useLocale();
  const [selected, setSelected] = useState('sales');
  const group =
    groups.find((item) => item.name === selected) ?? groups.find((item) => item.documents.length) ?? groups[0];
  if (!group) return <p className="notice">{t(S.noDocuments)}</p>;
  return (
    <div className="home-status-body">
      <div className="home-status-filter">
        <label>
          {t({ ja: '状況を確認する業務', en: 'Business module to review' })}
          <select className="input" value={group.name} onChange={(event) => setSelected(event.target.value)}>
            {groups.map((item) => (
              <option key={item.name} value={item.name}>
                {t(item.label)}
              </option>
            ))}
          </select>
        </label>
        <p>
          {t({ ja: '選択した業務の伝票件数を表示します。', en: 'Document counts are shown for the selected module.' })}
        </p>
      </div>
      <SelectedModule key={group.name} group={group} reports={reports} />
    </div>
  );
}

export function HomePage() {
  const { t, locale } = useLocale();
  const { catalog, meta } = useNavigation();
  const [statusOpen, setStatusOpen] = useState(false);
  const groups = useMemo(() => (meta.data ? groupByModule(meta.data, S.allEntities) : []), [meta.data]);
  const reports = useMemo(() => reportActions(meta.data), [meta.data]);
  const unavailable = meta.isError && !canRetainData(meta);
  const date = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
  return (
    <div className="workspace-page workspace-home">
      <header className="welcome-header">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>{t({ ja: '今日の仕事を、ここから。', en: 'A clear start to your day.' })}</h1>
          <p>{t({ ja: 'まず業務を選んで、必要な画面へ。', en: 'Choose a business area to find your next step.' })}</p>
        </div>
        <div className="date-chip">
          <Icon name="clock" size={16} />
          {date}
        </div>
      </header>
      <div className="home-entry-actions">
        <Link to="/workspaces" className="btn btn-primary">
          <Icon name="search" size={18} />
          {t({ ja: 'すべての画面を探す', en: 'Find a screen' })}
        </Link>
        {catalog.entries.some((entry) => entry.href === '/me') ? (
          <Link to="/me" className="btn">
            <Icon name="clock" size={18} />
            {t({ ja: '自分の勤怠・申請', en: 'My workday' })}
          </Link>
        ) : null}
      </div>
      {unavailable ? <MetaError error={meta.error} retry={() => void meta.refetch()} /> : null}
      {meta.isPending ? <LoadingView /> : null}
      {meta.data && !unavailable ? (
        <>
          <section aria-label={t({ ja: '業務分野から始める', en: 'Start with a business area' })}>
            <div className="home-intro">
              <h2>{t({ ja: '業務分野から始める', en: 'Start with a business area' })}</h2>
              <p>
                {t({
                  ja: '操作画面・マスター・記録を、ひとつの入口に。',
                  en: 'Workflows, masters and records in one place.',
                })}
              </p>
            </div>
            <WorkspaceCards workspaces={catalog.workspaces} />
          </section>
          <details
            className="home-status"
            open={statusOpen}
            onToggle={(event) => setStatusOpen(event.currentTarget.open)}
          >
            <summary>
              {t({ ja: '伝票の状況を確認', en: 'Review document status' })}
              <small>
                {t({
                  ja: '業務を選んで、下書き・確定・取消の件数を見る',
                  en: 'Choose a module to see draft, submitted and cancelled counts',
                })}
              </small>
            </summary>
            {statusOpen ? <DocumentStatus groups={groups} reports={reports} /> : null}
          </details>
        </>
      ) : null}
    </div>
  );
}
