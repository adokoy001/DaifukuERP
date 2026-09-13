import { Link, useParams } from '@tanstack/react-router';
import { useMemo, useState, type FormEvent } from 'react';
import { isApiError } from '../api/client.ts';
import { useMeta } from '../api/queries.ts';
import { reportActions, useRunReport } from '../api/reports.ts';
import type { ActionMeta, AppMeta, TableResult } from '../api/types.ts';
import { ActionConfirm } from '../components/action-confirm.tsx';
import { Icon } from '../components/icon.tsx';
import { ReportExport } from '../components/report-export.tsx';
import { ReportTable } from '../components/report-table.tsx';
import { SchemaFields, useSchemaForm } from '../components/schema-form.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import { issuesToFieldErrors } from '../lib/form.ts';
import {
  reportDateErrors,
  reportInitialValues,
  reportInputFields,
  reportPeriodLabel,
  reportPeriodOptions,
  reportPeriodValues,
  reportTitle,
} from '../lib/report.ts';
import { refResolverFrom, schemaFields } from '../lib/schema.ts';
import { S } from '../strings.ts';
import { LoadingView, MetaError } from './status-views.tsx';
interface RunInput {
  input: Record<string, unknown>;
  fingerprint: string;
}
interface Snapshot extends RunInput {
  result: TableResult;
  at: Date;
}
function ResultHeader({ action, snapshot, stale }: { action: ActionMeta; snapshot: Snapshot; stale: boolean }) {
  const { t, locale } = useLocale();
  return (
    <header className="report-result-heading">
      <div>
        <h2 data-testid="report-title">{t(snapshot.result.title)}</h2>
        <span className="muted" data-testid="report-count">
          {snapshot.result.rows.length} {t(S.reportRows)} · {t({ ja: '取得', en: 'Retrieved' })}{' '}
          {snapshot.at.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US')}
        </span>
      </div>
      {snapshot.result.meta?.truncated === true ? (
        <span role="status" className="status-pill is-attention">
          {t(S.reportTruncated)}
        </span>
      ) : null}
      <ReportExport
        actionName={action.name}
        input={snapshot.input}
        allowed={action.canExport === true}
        disabled={stale || snapshot.result.rows.length === 0}
      />
    </header>
  );
}
function ReportView({ action, meta }: { action: ActionMeta; meta: AppMeta }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const fields = useMemo(
    () => reportInputFields(schemaFields(action.inputSchema, refResolverFrom(meta.entities, action.module))),
    [action.inputSchema, action.module, meta.entities],
  );
  const initialValues = useMemo(() => reportInitialValues(fields), [fields]);
  const periodOptions = useMemo(() => reportPeriodOptions(fields), [fields]);
  const form = useSchemaForm(fields, {
    current: initialValues,
    jsonOnly: action.inputSchema !== undefined && action.inputSchema.type !== 'object',
  });
  const run = useRunReport(action.name);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [pending, setPending] = useState<RunInput>();
  const fingerprint = JSON.stringify(form.state.jsonMode ? form.state.json : form.state.values);
  const stale = snapshot !== undefined && snapshot.fingerprint !== fingerprint;
  const execute = (captured: RunInput) => {
    setPending(undefined);
    setSnapshot(undefined);
    run.mutate(captured.input, {
      onSuccess: (result) => setSnapshot({ ...captured, result, at: new Date() }),
      onError: (err) => {
        if (isApiError(err) && err.code === 'VALIDATION')
          form.setErrors(
            issuesToFieldErrors(
              err.issues(),
              fields.map((f) => f.name),
            ).fieldErrors,
          );
        toast.error(err);
      },
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (run.isPending) return;
    const built = form.build();
    if (!built.ok) {
      form.setErrors(built.errors);
      toast.push({ kind: 'error', title: t(S.formHasErrors) });
      return;
    }
    const payload = built.payload;
    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      const errors = reportDateErrors(payload as Record<string, unknown>, fields, locale);
      if (Object.keys(errors).length > 0) {
        form.setErrors(form.state.jsonMode ? { _json: Object.values(errors).join(' ') } : errors);
        toast.push({ kind: 'error', title: t(S.formHasErrors) });
        return;
      }
    }
    const captured = { input: built.payload as Record<string, unknown>, fingerprint };
    if (action.mutates) setPending(captured);
    else execute(captured);
  };
  return (
    <div className="workspace-page report-workspace">
      <Link className="control-back" to="/reports">
        ← {t({ ja: 'レポートセンター', en: 'Report center' })}
      </Link>
      <header className="control-heading compact">
        <div>
          <span className="eyebrow">REPORTS & EVIDENCE</span>
          <h1 data-testid="report-name">{t(reportTitle(action))}</h1>
          <p>{t(action.description)}</p>
        </div>
        <Icon name="chart" size={32} />
      </header>
      <form
        onSubmit={submit}
        noValidate
        aria-label={t(S.conditions)}
        className="control-panel report-conditions"
        data-testid="report-form"
      >
        <div className="panel-heading">
          <h2>{t(S.conditions)}</h2>
          {form.canToggle ? (
            <details>
              <summary>{t({ ja: '詳細入力', en: 'Advanced input' })}</summary>
              <button type="button" className="btn" onClick={form.toggleJson}>
                {t(form.state.jsonMode ? S.conditions : S.rawJson)}
              </button>
            </details>
          ) : null}
        </div>
        {periodOptions.length > 0 && !form.state.jsonMode ? (
          <div className="report-period-controls">
            <div
              className="report-period-buttons"
              role="group"
              aria-label={t({ ja: '期間の簡単入力', en: 'Quick period selection' })}
            >
              {periodOptions.map((period) => (
                <button
                  key={period}
                  type="button"
                  className="btn"
                  disabled={run.isPending}
                  onClick={() => {
                    for (const [name, value] of Object.entries(reportPeriodValues(fields, period)))
                      form.setValue(name, String(value));
                  }}
                >
                  {t(reportPeriodLabel(fields, period))}
                </button>
              ))}
            </div>
            <p className="report-browse-note">
              {t({
                ja: '日本時間の暦日・暦月で入力します。直近12か月は当月を含み、終了日は今日です。会計年度で見る場合は日付を指定してください。',
                en: 'Uses Japanese calendar dates and months. Last 12 months includes the current month through today. Enter dates to report on a fiscal year.',
              })}
            </p>
          </div>
        ) : null}
        {fields.length > 0 || form.state.jsonMode ? (
          <SchemaFields fields={fields} form={form} disabled={run.isPending} idPrefix="r" />
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={run.isPending}>
          {t(run.isPending ? S.running : S.run)}
        </button>
      </form>
      {stale ? (
        <p role="status" className="notice-strip">
          {t({
            ja: '条件が変更されています。表示中は前回の結果です。再集計してから出力してください。',
            en: 'Filters have changed. These are the previous results. Run again before exporting.',
          })}
        </p>
      ) : null}
      {snapshot ? (
        <section
          aria-label={t(snapshot.result.title)}
          className="control-panel report-results"
          data-testid="report-result"
        >
          <ResultHeader action={action} snapshot={snapshot} stale={stale} />
          <details className="report-evidence">
            <summary>{t({ ja: 'この結果の条件と計算情報', en: 'Criteria and calculation information' })}</summary>
            <dl>
              {Object.entries(snapshot.input).map(([key, value]) => (
                <div key={key}>
                  <dt>{t(fields.find((f) => f.name === key)?.label) || key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
            {snapshot.result.meta ? <pre>{JSON.stringify(snapshot.result.meta, null, 2)}</pre> : null}
          </details>
          <ReportTable result={snapshot.result} />
        </section>
      ) : !run.isPending ? (
        <div className="report-ready">
          <Icon name="chart" size={40} />
          <h2>
            {t({ ja: '条件を選んで、数字の動きを確かめましょう。', en: 'Choose your filters to explore the numbers.' })}
          </h2>
          <p>
            {t({
              ja: '集計結果と元データへの参照をここに表示します。',
              en: 'Results and references to source records appear here.',
            })}
          </p>
        </div>
      ) : (
        <LoadingView />
      )}
      {pending ? (
        <ActionConfirm
          title={t({ ja: '処理を実行', en: 'Run operation' })}
          message={t(action.description)}
          destructive={false}
          cancelDocument={false}
          onClose={() => setPending(undefined)}
          onConfirm={() => execute(pending)}
        />
      ) : null}
    </div>
  );
}
export function ReportPage() {
  const { action: name } = useParams({ strict: false }) as { action?: string };
  const meta = useMeta();
  const { t } = useLocale();
  if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  const action = reportActions(meta.data).find((item) => item.name === name);
  return action ? (
    <ReportView key={action.name} action={action} meta={meta.data} />
  ) : (
    <div className="workspace-page" role="alert">
      {t(S.reportNotFound)} <Link to="/reports">{t({ ja: 'レポートセンターへ', en: 'Go to report center' })}</Link>
    </div>
  );
}
