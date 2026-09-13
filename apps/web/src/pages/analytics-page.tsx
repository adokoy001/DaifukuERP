import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchAnalytics,
  useAnalyticsCatalog,
  type AnalyticsCatalog,
  type AnalyticsSnapshot,
} from '../api/analytics.ts';
import { getCompanyId, getUser } from '../api/client.ts';
import { useCompanyName } from '../api/company.tsx';
import { AnalyticsControls } from '../components/analytics-controls.tsx';
import { AnalyticsChart, AnalyticsResult } from '../components/analytics-result.tsx';
import { Icon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import {
  analyticsTemplates,
  defaultAnalytics,
  isIsoDate,
  OP_LABELS,
  PERIODS,
  periodDates,
  settingsDates,
  validSettingsForDataset,
  type AnalyticsSettings,
} from '../lib/analytics.ts';
import {
  AnalysisStorageError,
  analyticsStorageKey,
  mutateAnalyses,
  parseAnalyticsSettings,
  readAnalyses,
  type AnalysisMutation,
  type SavedAnalysis,
} from '../lib/analytics-storage.ts';
import { createPivotRunner, type PivotWorkerPort } from '../lib/pivot-worker-client.ts';
import type { PivotResult } from '../lib/pivot.ts';
import { groupDigits as formatDecimal } from '../lib/format.ts';
import { cellKey } from '../lib/pivot.ts';
import { LoadingView, MetaError } from './status-views.tsx';
import '../analytics.css';

function AnalyticsWorkspace({ catalog }: { catalog: AnalyticsCatalog }) {
  const { t, locale } = useLocale();
  const companyName = useCompanyName();
  const templates = useMemo(() => analyticsTemplates(catalog.datasets), [catalog.datasets]);
  const first = templates[0]?.settings;
  const [settings, setSettings] = useState<AnalyticsSettings | undefined>(first);
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot>();
  const [result, setResult] = useState<PivotResult>();
  const [resultKey, setResultKey] = useState('');
  const computationKey = useRef('');
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [loadedBaseline, setLoadedBaseline] = useState<SavedAnalysis>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const editingRevision = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const user = getUser();
  const storageKey = analyticsStorageKey({
    tenantId: user?.tenantId ?? '',
    userId: user?.id ?? '',
    companyId: getCompanyId() ?? '',
  });
  const runner = useMemo(
    () =>
      createPivotRunner(
        () =>
          typeof Worker === 'undefined'
            ? null
            : (new Worker(new URL('../workers/pivot-worker.ts', import.meta.url), {
                type: 'module',
              }) as unknown as PivotWorkerPort),
        {
          result: (value) => {
            setResult(value);
            setResultKey(computationKey.current);
          },
          pending: setCalculating,
          failed: (code) => {
            setResult(undefined);
            setError(
              code === 'cell_limit'
                ? 'グループ数が多すぎます。階層や指標を減らしてください。 / Too many groups; reduce dimensions or measures.'
                : code === 'unsupported'
                  ? 'このブラウザでは並列集計を利用できません。 / Web Workers are unavailable.'
                  : `集計できませんでした。条件や元データを確認してください。 / Calculation failed (${code}).`,
            );
          },
        },
      ),
    [],
  );
  useEffect(
    () => () => {
      controller.current?.abort();
      runner.dispose();
    },
    [runner],
  );
  useEffect(() => {
    const refresh = () => {
      try {
        setSaved(readAnalyses(globalThis.localStorage, storageKey));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    };
    const receive = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) refresh();
    };
    refresh();
    globalThis.addEventListener('storage', receive);
    return () => globalThis.removeEventListener('storage', receive);
  }, [storageKey]);
  const dataset = catalog.datasets.find((item) => item.id === settings?.dataset);
  const dates = settings ? settingsDates(settings) : undefined;
  const validDates = dates !== undefined && isIsoDate(dates.from) && isIsoDate(dates.to) && dates.from <= dates.to;
  const fingerprint =
    settings && dates ? JSON.stringify({ dataset: settings.dataset, ...dates, state: settings.state }) : '';
  const snapshotFingerprint = snapshot
    ? JSON.stringify({
        dataset: snapshot.dataset,
        from: snapshot.meta.from,
        to: snapshot.meta.to,
        state: snapshot.meta.state,
      })
    : '';
  const stale = !!snapshot && fingerprint !== snapshotFingerprint;
  const configString = JSON.stringify(settings?.pivot);
  useEffect(() => {
    setResult(undefined);
    computationKey.current = configString;
    if (snapshot && settings && !stale) {
      setError('');
      runner.run(snapshot.rows, settings.pivot);
    } else runner.cancel();
    // Only aggregation changes rerun the worker; opening a hierarchy uses the existing prefix aggregates.
  }, [snapshot, configString, stale, runner]);
  const load = async (value: AnalyticsSettings) => {
    const range = settingsDates(value);
    if (!isIsoDate(range.from) || !isIsoDate(range.to) || range.from > range.to) {
      setError(t({ ja: '開始日と終了日を正しい順序で入力してください。', en: 'Enter a valid start and end date.' }));
      return;
    }
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setLoading(true);
    setError('');
    setSnapshot(undefined);
    setResult(undefined);
    runner.cancel();
    try {
      const response = await fetchAnalytics({ dataset: value.dataset, ...range, state: value.state }, pending.signal);
      if (pending.signal.aborted) return;
      if (
        response.meta.complete !== true ||
        response.rows.length !== response.meta.rowCount ||
        response.rows.length > 50_000 ||
        response.scopeKey !== catalog.scopeKey
      )
        throw new Error(
          t({
            ja: '閲覧条件が変わりました。ページを更新して再取得してください。',
            en: 'Access or source conditions changed. Reload this page.',
          }),
        );
      setSnapshot(response);
    } catch (failure) {
      if (!pending.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (!pending.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    if (first) void load(first);
  }, []); // Initial source is already authorized by this catalog instance.
  if (!settings || !dataset)
    return (
      <p className="notice-strip">
        {t({
          ja: '現在の会社・権限で利用できる分析対象はありません。',
          en: 'No analytics sources are available for this company and role.',
        })}
      </p>
    );
  const patch = (value: Partial<AnalyticsSettings>) =>
    setSettings((current) => (current ? { ...current, ...value } : current));
  const choose = (value: AnalyticsSettings, savedId = '', savedName = '') => {
    editingRevision.current += 1;
    setSettings(value);
    setSelected(savedId);
    setLoadedBaseline(saved.find((item) => item.id === savedId));
    setName(savedName);
    setNotice('');
    setSaveError('');
    void load(value);
  };
  const dirty =
    loadedBaseline !== undefined &&
    (JSON.stringify(loadedBaseline.settings) !== JSON.stringify(settings) || loadedBaseline.name !== name.trim());
  const persist = async (change: AnalysisMutation, revision: number) => {
    setSaving(true);
    setNotice('');
    setSaveError('');
    try {
      const items = await mutateAnalyses(globalThis.localStorage, globalThis.navigator?.locks, storageKey, change);
      setSaved(items);
      setStorageError(false);
      return true;
    } catch (failure) {
      if (failure instanceof AnalysisStorageError) {
        if (revision === editingRevision.current)
          setSaveError(
            failure.code === 'conflict'
              ? t({
                  ja: 'この分析は別のタブで変更または削除されています。保存した分析を読み直すか、「別名で保存」を選んでください。',
                  en: 'This analysis was changed or deleted in another tab. Reload the saved analysis or choose "Save a copy".',
                })
              : t({
                  ja: 'このブラウザでは安全な設定保存を利用できません。Web Locksに対応したブラウザとHTTPS接続で開いてください。',
                  en: 'Safe settings storage is unavailable. Use a browser supporting Web Locks over HTTPS.',
                }),
          );
        if (failure.code === 'conflict') {
          try {
            setSaved(readAnalyses(globalThis.localStorage, storageKey));
            setStorageError(false);
          } catch {
            setStorageError(true);
          }
        }
      } else setStorageError(true);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const save = async (copy: boolean) => {
    if (saving) return;
    if (!parseAnalyticsSettings(settings)) {
      setNotice(
        t({
          ja: '軸・粒度の重複や日付を確認してください。設定を保存できません。',
          en: 'Check for duplicate dimensions and invalid dates before saving.',
        }),
      );
      return;
    }
    if (!name.trim()) {
      setNotice(t({ ja: '保存する分析の名前を入力してください。', en: 'Enter a name for this analysis.' }));
      return;
    }
    const revision = editingRevision.current;
    const entry: SavedAnalysis = {
      id: copy || !selected ? crypto.randomUUID() : selected,
      name: name.trim(),
      updatedAt: new Date().toISOString(),
      settings,
    };
    if (
      (await persist(
        { kind: 'save', entry, ...(!copy && selected && loadedBaseline ? { baseline: loadedBaseline } : {}) },
        revision,
      )) &&
      revision === editingRevision.current
    ) {
      setSelected(entry.id);
      setLoadedBaseline(entry);
      setNotice(t({ ja: '分析設定を保存しました。', en: 'Analysis settings saved.' }));
    }
  };
  const remove = async () => {
    if (saving || !selected || !loadedBaseline) return;
    const revision = editingRevision.current;
    if (
      (await persist({ kind: 'delete', id: selected, baseline: loadedBaseline }, revision)) &&
      revision === editingRevision.current
    ) {
      setSelected('');
      setLoadedBaseline(undefined);
      setNotice(t({ ja: '保存設定を削除しました。', en: 'Saved settings deleted.' }));
    }
  };
  const expand = (axis: 'rows' | 'columns', key: string) => {
    const property = axis === 'rows' ? 'expandedRows' : 'expandedColumns';
    const keys = settings[property];
    patch({ [property]: keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key] });
  };
  const grandTotal = result?.cells[cellKey('[]', '[]')];
  return (
    <div className="workspace-page analytics-page">
      <Link to="/reports" className="control-back">
        ← {t({ ja: 'レポートセンター', en: 'Report center' })}
      </Link>
      <header className="analytics-hero">
        <div>
          <span className="eyebrow">DAIFUKU ANALYTICS STUDIO</span>
          <h1>{t({ ja: '数字をほどく。次が見える。', en: 'Explore your numbers. See what comes next.' })}</h1>
          <p>
            {t({
              ja: '対象・階層・指標を自由に組み合わせる、ブラウザのピボット分析。',
              en: 'Combine sources, dimensions and measures with browser pivot analytics.',
            })}
          </p>
          <span className="analytics-company">
            <Icon name="building" size={16} />
            {companyName} · {t({ ja: '現在の閲覧権限で集計', en: 'Your current access scope' })}
          </span>
        </div>
        <Icon name="chart" size={52} />
      </header>
      <section className="control-panel analytics-start">
        <div className="panel-heading">
          <h2>{t({ ja: '分析を始める', en: 'Start an analysis' })}</h2>
          <span className="status-pill">
            {templates.length} {t({ ja: 'テンプレート', en: 'templates' })}
          </span>
        </div>
        <div className="analytics-start-grid">
          <label>
            {t({ ja: 'おすすめテンプレート', en: 'Recommended templates' })}
            <select
              className="input"
              aria-label={t({ ja: 'おすすめテンプレート', en: 'Recommended templates' })}
              value=""
              onChange={(event) => {
                const template = templates.find((item) => item.id === event.target.value);
                if (template) choose(template.settings);
              }}
            >
              <option value="">{t({ ja: '用途から選ぶ…', en: 'Choose a pattern…' })}</option>
              {templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(item.title)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t({ ja: '保存した分析', en: 'Saved analyses' })}
            <select
              className="input"
              value={selected}
              onChange={(event) => {
                const item = saved.find((item) => item.id === event.target.value);
                const source = catalog.datasets.find((source) => source.id === item?.settings.dataset);
                if (item && source && validSettingsForDataset(item.settings, source))
                  choose(item.settings, item.id, item.name);
                else if (!item) {
                  editingRevision.current += 1;
                  setSelected('');
                  setLoadedBaseline(undefined);
                  setSaveError('');
                  setNotice('');
                } else
                  setNotice(
                    t({
                      ja: 'この設定の対象や項目は利用できません。テンプレートから選び直してください。',
                      en: 'The saved source or fields are no longer available. Choose a template.',
                    }),
                  );
              }}
            >
              <option value="">{t({ ja: '新しい分析', en: 'New analysis' })}</option>
              {saved.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="analytics-template-strip">
          {templates
            .filter((item) => item.id.endsWith('-monthly'))
            .slice(0, 6)
            .map((item) => (
              <button
                className={`analytics-template ${settings.dataset === item.settings.dataset ? 'is-selected' : ''}`}
                type="button"
                key={item.id}
                title={t(item.description)}
                onClick={() => choose(item.settings)}
              >
                <Icon name="chart" size={17} />
                <span>{t(item.title)}</span>
                <span>↗</span>
              </button>
            ))}
        </div>
      </section>
      <section id="analytics-builder" className="control-panel analytics-builder">
        <div className="panel-heading">
          <h2>{t({ ja: '集計条件', en: 'Source conditions' })}</h2>
          <button
            type="button"
            className="btn"
            disabled={!result || stale || resultKey !== configString}
            onClick={() => document.getElementById('analytics-output')?.scrollIntoView()}
          >
            {t({ ja: '集計結果へ ↓', en: 'View results ↓' })}
          </button>
        </div>
        <small className="muted">{t({ ja: '日付の基準：日本時間', en: 'Date defaults: Japan time' })}</small>
        <div className="analytics-source-grid">
          <label>
            {t({ ja: '集計対象', en: 'Source' })}
            <select
              className="input"
              value={dataset.id}
              onChange={(event) => {
                const next = catalog.datasets.find((item) => item.id === event.target.value);
                if (next) choose(defaultAnalytics(next));
              }}
            >
              {catalog.datasets.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(item.title)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t({ ja: '対象の状態', en: 'Record state' })}
            <select className="input" value={settings.state} onChange={(event) => patch({ state: event.target.value })}>
              {dataset.states.map((state) => (
                <option value={state.value} key={state.value}>
                  {t(state.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t({ ja: '期間', en: 'Period' })}
            <select
              className="input"
              value={settings.period}
              onChange={(event) => {
                const period = event.target.value as AnalyticsSettings['period'];
                patch({ period, ...(period === 'custom' ? dates : periodDates(period)) });
              }}
            >
              {PERIODS.map((period) => (
                <option value={period.value} key={period.value}>
                  {t(period.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t({ ja: '開始日', en: 'From' })}
            <input
              type="date"
              className="input"
              value={dates?.from ?? ''}
              onChange={(event) => patch({ period: 'custom', from: event.target.value, to: dates?.to ?? settings.to })}
            />
          </label>
          <label>
            {t({ ja: '終了日', en: 'To' })}
            <input
              type="date"
              className="input"
              value={dates?.to ?? ''}
              onChange={(event) =>
                patch({ period: 'custom', to: event.target.value, from: dates?.from ?? settings.from })
              }
            />
          </label>
        </div>
        <p className="analytics-source-note">
          <strong>
            {t({ ja: '1行の単位', en: 'Source grain' })}: {t(dataset.grain)}
          </strong>{' '}
          · {t(dataset.description)}
        </p>
        <div className="analytics-toolbar">
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || !validDates}
            onClick={() => void load(settings)}
          >
            <Icon name="chart" size={17} />
            {t(
              loading
                ? { ja: 'データを取得中…', en: 'Loading records…' }
                : { ja: '条件を適用・最新データで集計', en: 'Apply and refresh data' },
            )}
          </button>
          {settings.period !== 'previous-month' && settings.period !== 'custom' ? (
            <small>
              {t({ ja: '当月は本日までの途中実績です。', en: 'The current month is partial, through today.' })}
            </small>
          ) : null}
        </div>
        <AnalyticsControls
          dataset={dataset}
          value={settings.pivot}
          onChange={(pivot) => patch({ pivot, expandedRows: [], expandedColumns: [], chartMeasure: 0 })}
        />
        <div className="analytics-toolbar">
          <button
            type="button"
            className="btn"
            onClick={() =>
              patch({
                pivot: { ...settings.pivot, rows: settings.pivot.columns, columns: settings.pivot.rows },
                expandedRows: [],
                expandedColumns: [],
              })
            }
          >
            {t({ ja: '行と列を入れ替え', en: 'Swap rows and columns' })}
          </button>
          <label className="analytics-check">
            <input
              type="checkbox"
              checked={settings.subtotals}
              onChange={(event) => patch({ subtotals: event.target.checked })}
            />
            {t({ ja: '展開した階層の小計を表示', en: 'Show expanded subtotals' })}
          </label>
          <button
            type="button"
            className="btn"
            onClick={() =>
              patch({
                expandedRows:
                  result?.rowNodes
                    .filter((node) => node.depth && node.children.length)
                    .slice(0, 1000)
                    .map((node) => node.key) ?? [],
                expandedColumns:
                  result?.columnNodes
                    .filter((node) => node.depth && node.children.length)
                    .slice(0, 1000)
                    .map((node) => node.key) ?? [],
              })
            }
          >
            {t({ ja: '階層を展開', en: 'Expand levels' })}
          </button>
          <button type="button" className="btn" onClick={() => patch({ expandedRows: [], expandedColumns: [] })}>
            {t({ ja: '折り畳む', en: 'Collapse' })}
          </button>
        </div>
      </section>
      <section className="control-panel analytics-save">
        <div>
          <h2>
            {t({ ja: 'この分析を保存', en: 'Save this analysis' })}
            {dirty ? (
              <span className="status-pill is-attention">{t({ ja: '未保存の変更', en: 'Unsaved changes' })}</span>
            ) : null}
          </h2>
          <small>
            {t({
              ja: 'このブラウザ・利用者・会社に設定のみ保存します（最大30件）。呼び出すと最新データを取得します。',
              en: 'Save settings for this browser, user and company (up to 30). Loading retrieves fresh data.',
            })}
          </small>
        </div>
        <div className="analytics-save-actions">
          <input
            className="input"
            aria-label={t({ ja: '分析の名前', en: 'Analysis name' })}
            placeholder={t({ ja: '例：本部の月次経費レビュー', en: 'e.g. Monthly expense review' })}
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            className="btn btn-primary"
            type="button"
            disabled={saving || !validDates}
            onClick={() => void save(false)}
          >
            {t(selected ? { ja: '上書き保存', en: 'Save changes' } : { ja: '保存', en: 'Save' })}
          </button>
          {selected ? (
            <>
              <button className="btn" type="button" disabled={saving || !validDates} onClick={() => void save(true)}>
                {t({ ja: '別名で保存', en: 'Save a copy' })}
              </button>
              <button className="btn" type="button" disabled={saving} onClick={() => void remove()}>
                {t({ ja: '削除', en: 'Delete' })}
              </button>
            </>
          ) : null}
        </div>
        {saveError ? <p role="alert">{saveError}</p> : null}
        {storageError ? (
          <p role="alert">
            {t({
              ja: '保存領域を利用できないか、設定が旧版・破損・上限超過のため読み書きできません。分析自体は引き続き利用できます。',
              en: 'Storage is unavailable, incompatible, damaged or full. Analysis remains available.',
            })}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
      </section>
      {error ? (
        <p className="notice-strip" role="alert">
          {error}
        </p>
      ) : null}
      {stale ? (
        <p className="notice-strip" role="status">
          {t({
            ja: '取得条件が変わりました。「条件を適用」で再取得してください。',
            en: 'Source conditions changed. Apply to retrieve fresh data.',
          })}
        </p>
      ) : null}
      {loading || calculating ? (
        <div className="analytics-loading" role="status">
          <Icon name="chart" size={24} />
          {t(
            loading
              ? { ja: '権限内の記録を取得しています…', en: 'Retrieving authorized records…' }
              : { ja: 'ブラウザで集計しています…', en: 'Calculating in your browser…' },
          )}
        </div>
      ) : null}
      {result && resultKey === configString && snapshot && !stale ? (
        <section id="analytics-output" className="control-panel analytics-output">
          <header className="analytics-output-header">
            <div>
              <span className="eyebrow">YOUR ANALYSIS</span>
              <h2>{t(dataset.title)}</h2>
              <p>
                {snapshot.meta.from} — {snapshot.meta.to} ·{' '}
                {t(dataset.states.find((state) => state.value === snapshot.meta.state)?.label)}
              </p>
            </div>
            <div>
              <span className="status-pill">
                {snapshot.meta.rowCount.toLocaleString()}{' '}
                {t({ ja: '件・対象期間の取得完了', en: 'records · complete period' })}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => document.getElementById('analytics-builder')?.scrollIntoView()}
              >
                {t({ ja: '集計条件へ ↑', en: 'Source conditions ↑' })}
              </button>
            </div>
          </header>
          <div className="analytics-kpis">
            {settings.pivot.measures.map((measure, index) => (
              <article key={index}>
                <span>
                  {measure.op === 'rows'
                    ? t(OP_LABELS.rows)
                    : `${t(dataset.measures.find((field) => field.key === measure.field)?.label)} / ${t(OP_LABELS[measure.op])}`}
                </span>
                <strong>
                  {grandTotal?.[index] === null || grandTotal?.[index] === undefined
                    ? '—'
                    : formatDecimal(grandTotal?.[index] ?? '')}
                </strong>
                <small>{t({ ja: '全対象の総計', en: 'All records' })}</small>
              </article>
            ))}
          </div>
          <div className="analytics-toolbar">
            <label>
              {t({ ja: 'グラフ', en: 'Chart' })}
              <select
                className="input"
                value={settings.chart}
                onChange={(event) => patch({ chart: event.target.value as AnalyticsSettings['chart'] })}
              >
                <option value="bar">{t({ ja: '棒グラフ', en: 'Bar' })}</option>
                <option value="line">{t({ ja: '折れ線', en: 'Line' })}</option>
                <option value="none">{t({ ja: '表のみ', en: 'Table only' })}</option>
              </select>
            </label>
            <label>
              {t({ ja: 'グラフの指標', en: 'Chart measure' })}
              <select
                className="input"
                value={settings.chartMeasure}
                onChange={(event) => patch({ chartMeasure: Number(event.target.value) })}
              >
                {settings.pivot.measures.map((measure, index) => (
                  <option key={index} value={index}>
                    {measure.op === 'rows'
                      ? t(OP_LABELS.rows)
                      : `${t(dataset.measures.find((field) => field.key === measure.field)?.label)} / ${t(OP_LABELS[measure.op])}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <AnalyticsChart result={result} settings={settings} dataset={dataset} />
          <AnalyticsResult
            key={`${configString}-${snapshot.meta.retrievedAt}`}
            result={result}
            settings={settings}
            dataset={dataset}
            onExpand={expand}
          />
          <footer className="analytics-footnote muted">
            {t({ ja: '取得日時', en: 'Retrieved' })}:{' '}
            {new Date(snapshot.meta.retrievedAt).toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US')} ·{' '}
            {t({
              ja: '1回5万件まで。大きな期間は絞り込んで分析できます。正式帳票のCSVはレポートセンターから出力してください。',
              en: 'Up to 50,000 records per snapshot. Narrow the period for larger sources. Export official report CSVs from the report center.',
            })}
          </footer>
        </section>
      ) : null}
    </div>
  );
}
export function AnalyticsPage() {
  const catalog = useAnalyticsCatalog();
  if (catalog.isError) return <MetaError error={catalog.error} retry={() => void catalog.refetch()} />;
  if (!catalog.data) return <LoadingView />;
  return <AnalyticsWorkspace key={catalog.data.scopeKey} catalog={catalog.data} />;
}
