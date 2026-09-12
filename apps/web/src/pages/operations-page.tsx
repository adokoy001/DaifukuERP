import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { useOperationsSnapshot, useSettlementEvidence, useStoreOptions, type OperationsFilters, type OperationsSnapshot } from '../api/operations.ts';
import { useMeta } from '../api/queries.ts';
import type { ActionMeta } from '../api/types.ts';
import { Icon } from '../components/icon.tsx';
import { OperationsBoard } from '../components/operations-board.tsx';
import { OperationsMetrics } from '../components/operations-metrics.tsx';
import { OperationsPlan } from '../components/operations-plan.tsx';
import { OperationsTrend } from '../components/operations-trend.tsx';
import { ReportExport } from '../components/report-export.tsx';
import { ReportTable } from '../components/report-table.tsx';
import { useLocale } from '../i18n.tsx';
import { businessToday, parseOperationsSearch } from '../lib/operations.ts';
import { LoadingView, MetaError } from './status-views.tsx';

function OperationsEvidence({ data, input, actions, settlements, stale, onStore }: { data: OperationsSnapshot; input: OperationsFilters; actions: ActionMeta[]; settlements: ReturnType<typeof useSettlementEvidence>; stale: boolean; onStore: (id: string) => void }) {
  const { t } = useLocale();
  const canExport = (name: string) => actions.find((a) => a.name === 'restaurant_chain.' + name)?.canExport === true;
  return <>
    <section className="control-panel"><div className="panel-heading"><div><h2>{t({ ja: '店舗別パフォーマンス', en: 'Store performance' })}</h2><p>{t({ ja: '前期間 ', en: 'Previous period ' })}{data.range.previousFrom} — {data.range.previousTo}</p></div></div>
      <div className="store-drilldown"><button className="btn" onClick={() => onStore('')}>{t({ ja: '全店舗で集計', en: 'All permitted stores' })}</button>{data.stores.rows.map((row) => <button key={String(row.storeId)} className="btn" onClick={() => onStore(String(row.storeId))}>{String(row.store)}<Icon name="arrow" size={14} /></button>)}</div><ReportTable result={data.stores} />
    </section>
    <OperationsBoard result={data.submissions} actions={actions} />
    <section className="control-panel"><div className="panel-heading"><div><h2>{t({ ja: '集計の根拠となる日次締め', en: 'Source daily closings' })}</h2><p>{t({ ja: '伝票リンクから元の記録を確認できます。CSVはこの条件で最新データを再取得します。', en: 'Follow record links to verify the evidence. CSV re-queries fresh data using these criteria.' })}</p></div><ReportExport actionName="restaurant_chain.operations_sources" input={{ ...input }} allowed={canExport('operations_sources')} disabled={stale} /></div><ReportTable result={data.sourceTable} /></section>
    <section className="control-panel"><div className="panel-heading"><div><h2>{t({ ja: '売上伝票と消込の確認', en: 'Invoice and settlement evidence' })}</h2><p>{t({ ja: '集計基準日までの入金・消込を確認します。', en: 'Payments and allocations effective on the selected as-of date.' })}</p></div>{settlements.data && !settlements.isError ? <ReportExport actionName="restaurant_chain.settlement_evidence" input={{ ...input }} allowed={canExport('settlement_evidence')} disabled={stale || settlements.isFetching} /> : null}</div>
      {!actions.some((a) => a.name === 'restaurant_chain.settlement_evidence') ? <p className="notice-strip">{t({ ja: '本部の会計参照権限で確認できるレポートです。', en: 'This report requires headquarters accounting access.' })}</p> : settlements.isError ? <MetaError error={settlements.error} retry={() => void settlements.refetch()} /> : settlements.isFetching ? <LoadingView /> : settlements.data ? <ReportTable result={settlements.data} /> : <LoadingView />}
    </section>
  </>;
}

export function OperationsPage() {
  const { t, locale } = useLocale();
  const meta = useMeta();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/operations' });
  const applied = parseOperationsSearch(search);
  const appliedKey = JSON.stringify(applied);
  const [draft, setDraft] = useState(applied), [dialog, setDialog] = useState<'plan' | 'status'>();
  useEffect(() => { setDraft(parseOperationsSearch(search)); }, [appliedKey]);
  const actions = meta.data?.actions ?? [];
  const allowed = (name: string) => actions.some((a) => a.name === 'restaurant_chain.' + name);
  const enabled = allowed('operations_snapshot');
  const stores = useStoreOptions(enabled);
  const report = useOperationsSnapshot(applied, enabled);
  const settlements = useSettlementEvidence(applied, enabled && allowed('settlement_evidence'));
  const refresh = () => { void report.refetch(); if (allowed('settlement_evidence')) void settlements.refetch(); };
  const stale = JSON.stringify(draft) !== appliedKey;
  const setFilter = (key: keyof OperationsFilters, value: string) => setDraft((prev) => { const next = { ...prev, [key]: value }; if (key === 'storeId' && !value) delete next.storeId; return next; });
  const apply = (event: FormEvent) => { event.preventDefault(); if (!stale) refresh(); else void navigate({ to: '/operations', search: { ...draft } }); };
  const filterStore = (id: string) => { const next = { ...applied }; if (id) next.storeId = id; else delete next.storeId; void navigate({ to: '/operations', search: next }); };
  if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  if (!enabled) return <div className="notice-strip">{t({ ja: 'この会社・権限ではチェーン運営画面を利用できません。', en: 'Chain operations is unavailable for this company or role.' })}</div>;
  return <div className="workspace-page operations-page">
    <header className="control-heading"><div><span className="eyebrow">CHAIN OPERATIONS</span><h1>{t({ ja: 'すべての店舗に、次の一手を。', en: 'A clear next step for every store.' })}</h1><p>{t({ ja: '営業計画から日次報告、売上と入金の確認まで。', en: 'From trading plans and daily reporting to sales and settlement evidence.' })}</p></div><span className="control-heading-icon"><Icon name="building" size={40} /></span></header>
    <div className="operations-toolbar"><div className="button-row">{allowed('plan_days') ? <button className="btn" disabled={!stores.data?.length} onClick={() => setDialog('plan')}><Icon name="calendar" size={16} />{t({ ja: '営業計画', en: 'Trading plan' })}</button> : null}{allowed('record_day_status') ? <button className="btn" disabled={!stores.data?.length} onClick={() => setDialog('status')}>{t({ ja: '売上ゼロ・休業を報告', en: 'Report no sales / closure' })}</button> : null}{meta.data.entities.find((e) => e.name === 'restaurant_chain_closing')?.ops.includes('create') ? <Link to="/e/$entity/new" params={{ entity: 'restaurant_chain_closing' }} className="btn btn-primary"><Icon name="plus" size={16} />{t({ ja: '日次報告を作成', en: 'New daily report' })}</Link> : null}</div><Link to="/reports" className="subtle-link">{t({ ja: 'すべてのBIレポート', en: 'All BI reports' })}<Icon name="arrow" size={16} /></Link></div>
    <form className="control-panel operations-filters" onSubmit={apply}>
      <label>{t({ ja: '対象期間・開始', en: 'Period from' })}<input className="input" type="date" required max={draft.to} value={draft.from} onChange={(e) => setFilter('from', e.target.value)} /></label>
      <label>{t({ ja: '対象期間・終了', en: 'Period to' })}<input className="input" type="date" required min={draft.from} max={draft.asOf} value={draft.to} onChange={(e) => setFilter('to', e.target.value)} /></label>
      <label>{t({ ja: '集計基準日', en: 'As-of date' })}<input className="input" type="date" required min={draft.to} max={businessToday()} value={draft.asOf} onChange={(e) => setFilter('asOf', e.target.value)} /></label>
      <label>{t({ ja: '対象店舗', en: 'Store' })}<select aria-label={t({ ja: '対象店舗', en: 'Store' })} className="input" value={draft.storeId ?? ''} onChange={(e) => setFilter('storeId', e.target.value)}><option value="">{t({ ja: '権限内の全店舗', en: 'All permitted stores' })}</option>{stores.data?.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
      <button className="btn btn-primary" disabled={report.isFetching || settlements.isFetching}>{t(report.isFetching || settlements.isFetching ? { ja: '集計中…', en: 'Loading…' } : { ja: '集計する', en: 'Apply filters' })}</button>
    </form>
    {stores.isError ? <MetaError error={stores.error} retry={() => void stores.refetch()} /> : null}
    {stale ? <p role="status" className="notice-strip">{t({ ja: '条件が変わりました。「集計する」で反映してください。CSV出力は再集計後に利用できます。', en: 'Filters have changed. Apply them before exporting.' })}</p> : null}
    {report.isError ? <MetaError error={report.error} retry={refresh} /> : report.data ? <>
      <div className="operations-context"><span>{report.data.range.from} — {report.data.range.to} · {t({ ja: '基準日 ', en: 'As of ' })}{report.data.range.asOf} · Asia/Tokyo</span><span>{t({ ja: '取得 ', en: 'Retrieved ' })}{new Date(report.dataUpdatedAt).toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US', { timeZone: 'Asia/Tokyo' })}</span></div>
      <OperationsMetrics data={report.data.overview} />
      <section className="control-panel"><div className="panel-heading"><div><h2>{t({ ja: '売上の流れをつかむ', en: 'Sales over time' })}</h2><p>{t({ ja: '税込売上と営業計画の目標を比較', en: 'Gross sales compared with planned targets' })}</p></div><div className="chart-legend"><span className="legend-sales">{t({ ja: '税込売上', en: 'Gross sales' })}</span><span className="legend-target">{t({ ja: '目標', en: 'Target' })}</span></div></div><OperationsTrend series={report.data.series} /><details className="operations-detail"><summary>{t({ ja: '日別の正確な数値を見る', en: 'View exact daily values' })}</summary><ReportTable result={report.data.series} /></details></section>
      <OperationsEvidence data={report.data} input={applied} actions={actions} settlements={settlements} stale={stale || report.isFetching} onStore={filterStore} />
      <aside className="operations-definitions"><h2>{t({ ja: 'この数字の読み方', en: 'How to read these numbers' })}</h2><p>{t({ ja: '売上は選択期間内の計上日・取消有効日の増減です。期間外の取消は、その取消日の期間に反映されます。提出・承認状況は現在の状態です。未提出は営業計画と報告を照合し、売上ゼロ・休業とは区別します。計画がない日は未提出と判定しません。', en: 'Sales show postings and cancellation movements effective within the selected period. Cancellations outside that period appear in their own period. Workflow status is current. Missing reports are identified against trading plans, separately from zero sales and closures. Unplanned days are not marked missing.' })}</p><p>{t({ ja: '廃棄原価は在庫補助簿の評価額で、会計上の利益ではありません。実収現金が未報告、または比率の分母が0の場合は「—」を表示します。', en: 'Waste cost is inventory subledger valuation, not accounting profit. Unknown actual cash and zero-denominator rates display a dash.' })}</p><span>{t({ ja: '計画のない店舗日 ', en: 'Unplanned store-days ' })}{report.data.overview.unplannedDays}</span></aside>
    </> : <LoadingView />}
    {dialog && stores.data ? <OperationsPlan stores={stores.data} mode={dialog} {...(applied.storeId ? { initialStoreId: applied.storeId } : {})} initialDate={applied.to} onClose={() => setDialog(undefined)} /> : null}
  </div>;
}
