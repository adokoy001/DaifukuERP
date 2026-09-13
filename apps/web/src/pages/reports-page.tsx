import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMeta } from '../api/queries.ts';
import { reportActions } from '../api/reports.ts';
import { Icon, moduleIcon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import { reportTitle } from '../lib/report.ts';
import { LoadingView, MetaError } from './status-views.tsx';
export function ReportsPage() {
  const { t } = useLocale();
  const meta = useMeta();
  const [search, setSearch] = useState(''),
    [module, setModule] = useState('');
  if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  const reports = reportActions(meta.data).filter((item) => !item.mutates);
  const visible = reports.filter(
    (item) =>
      (!module || item.module === module) &&
      (t(reportTitle(item)) + ' ' + t(item.description)).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="workspace-page reports-page">
      <header className="control-heading">
        <div>
          <span className="eyebrow">BUSINESS INTELLIGENCE</span>
          <h1>{t({ ja: '数字から、次の判断へ。', en: 'From numbers to the next decision.' })}</h1>
          <p>
            {t({
              ja: '会社の数字を見渡し、元の記録まで確認する。権限のあるレポートをまとめました。',
              en: 'Explore company performance and follow the evidence, with reports available to your role.',
            })}
          </p>
        </div>
        <span className="control-heading-icon">
          <Icon name="chart" size={40} />
        </span>
      </header>
      <Link to="/analytics" className="operations-banner">
        <span>
          <strong>{t({ ja: 'ピボット分析スタジオ', en: 'Pivot analytics studio' })}</strong>
          <small>
            {t({
              ja: '集計対象を切り替え、階層・グラフ・保存設定で数字を読み解く',
              en: 'Explore sources, hierarchies, charts and saved analyses',
            })}
          </small>
        </span>
        <Icon name="spark" />
      </Link>
      {meta.data.actions.some((a) => a.name === 'restaurant_chain.operations_snapshot') ? (
        <Link to="/operations" className="operations-banner">
          <span>
            <strong>{t({ ja: 'チェーン運営ダッシュボード', en: 'Chain operations dashboard' })}</strong>
            <small>
              {t({
                ja: '目標・売上・提出状況を、店舗ごとに見渡す',
                en: 'Targets, sales and submissions across your stores',
              })}
            </small>
          </span>
          <Icon name="arrow" />
        </Link>
      ) : null}
      <div className="report-filters">
        <label>
          <Icon name="search" size={18} />
          <input
            type="search"
            className="input"
            aria-label={t({ ja: 'レポートを検索', en: 'Search reports' })}
            placeholder={t({ ja: '見たいレポートを検索', en: 'Find a report' })}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          className="input"
          aria-label={t({ ja: '業務分野', en: 'Business area' })}
          value={module}
          onChange={(e) => setModule(e.target.value)}
        >
          <option value="">{t({ ja: 'すべての分野', en: 'All areas' })}</option>
          {meta.data.modules
            .filter((m) => reports.some((item) => item.module === m.name))
            .map((m) => (
              <option value={m.name} key={m.name}>
                {t(m.label)}
              </option>
            ))}
        </select>
        <span>
          {visible.length} {t({ ja: '件のレポート', en: 'reports' })}
        </span>
      </div>
      <div className="report-catalog">
        {visible.map((item) => (
          <Link key={item.name} to="/r/$action" params={{ action: item.name }} className="report-card">
            <span className="report-card-icon">
              <Icon name={moduleIcon(item.module)} size={24} />
            </span>
            <div>
              <small>{t(meta.data.modules.find((m) => m.name === item.module)?.label)}</small>
              <h2>{t(reportTitle(item))}</h2>
              <p>{t(item.description)}</p>
              <span className="status-pill">
                {t(
                  item.canExport
                    ? { ja: 'CSV出力可', en: 'CSV available' }
                    : { ja: '画面で閲覧', en: 'View on screen' },
                )}
              </span>
            </div>
            <Icon name="arrow" size={18} />
          </Link>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="notice-strip">
          {t({ ja: '条件に一致するレポートがありません。', en: 'No reports match these filters.' })}
        </p>
      ) : null}
    </div>
  );
}
