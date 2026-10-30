// /finance/recurring — generate recurring journals (docs/specs/recurring-journals.md AC-23..AC-25), built with the UI
// kit. It orders existing operations only: accounting.recurring_schedule previews what is due up to the base date,
// accounting.generate_recurring runs after a kit Dialog confirmation, and the result links to the created entries.
// The templates themselves are edited in the generic list/form (/e/recurring_journal).
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { useCurrencyScale } from '../api/company.tsx';
import { financeIdentity } from '../api/finance.ts';
import { useMeta } from '../api/queries.ts';
import { useGenerateRecurring, useRecurringSchedule } from '../api/recurring.ts';
import type { AppMeta, Label } from '../api/types.ts';
import { ErrorDetails } from '../components/error-details.tsx';
import { Icon } from '../components/icon.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import { describeError } from '../lib/error-view.ts';
import { formatDecimal } from '../lib/format.ts';
import { businessToday, validDate } from '../lib/operations.ts';
import {
  autoSubmitNotice,
  canGenerate,
  dueRows,
  GENERATE_RECURRING_ACTION,
  NO_PERMISSION,
  periodSuffix,
  PLAN_STATUS_LABEL,
  RECURRING_ENTITY,
  resultLinks,
  resultSummary,
  runButtonLabel,
  RUN_STATUS_LABEL,
  scheduleRowHint,
  STOP_REASON_LABEL,
  stopHint,
  type GenerateResult,
  type PlanStatus,
  type RunStatus,
  type ScheduleRow,
  type TemplateRun,
} from '../lib/recurring.ts';
import { S } from '../strings.ts';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  Dialog,
  EmptyState,
  FormSection,
  PageHeader,
  SkeletonCard,
} from '../ui/index.ts';
import type { BadgeTone } from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const TITLE: Label = { ja: '定期仕訳の生成', en: 'Generate recurring journals' };
const PLAN_TONE: Record<PlanStatus, BadgeTone> = {
  due: 'accent',
  blocked: 'danger',
  after_blocked: 'neutral',
  invalid_template: 'danger',
};
const RUN_TONE: Record<RunStatus, BadgeTone> = {
  generated: 'success',
  up_to_date: 'neutral',
  blocked: 'warning',
  failed: 'danger',
  inactive: 'neutral',
};

export function RecurringPage() {
  const { t } = useLocale();
  const meta = useMeta();
  if (!meta.data) return <LoadingView />;
  // AC-24: the navigation hides the screen without the action; a direct URL explains instead of failing.
  if (!meta.data.actions.some((action) => action.name === GENERATE_RECURRING_ACTION))
    return (
      <div className="workspace-page">
        <EmptyState
          titleAs="h1"
          testId="recurring-no-permission"
          title={t(NO_PERMISSION.title)}
          description={t(NO_PERMISSION.description)}
          action={
            <Link to="/" className={buttonClass()}>
              {t({ ja: 'ホームへ戻る', en: 'Back to home' })}
            </Link>
          }
        />
      </div>
    );
  return <RecurringRun key={financeIdentity()} meta={meta.data} />;
}

function ScheduleList({ rows, scale }: { rows: readonly ScheduleRow[]; scale: number }) {
  const { t } = useLocale();
  return (
    <ul className="flex flex-col" data-testid="recurring-schedule">
      {rows.map((row) => (
        <li
          key={`${row.templateId}:${row.occurrenceDate}`}
          data-testid="recurring-schedule-row"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-b-0"
        >
          <span className="min-w-0 flex-1 basis-48">
            <Link
              to="/e/$entity/$id"
              params={{ entity: RECURRING_ENTITY, id: row.templateId }}
              className="ui-link block text-sm"
            >
              {row.templateName}
              {row.occurrence ? ` (${row.occurrence})` : ''}
            </Link>
            <span className="block text-xs text-text-muted">
              {row.occurrenceDate}
              {row.periodCode ? ` · ${row.periodCode}` : ''}
              {row.reason ? ` · ${t(STOP_REASON_LABEL[row.reason])}` : ''}
            </span>
          </span>
          <span className="text-sm tabular-nums">{formatDecimal(row.amount, scale)}</span>
          <Badge tone={PLAN_TONE[row.status]} data-testid="recurring-schedule-status">
            {t(PLAN_STATUS_LABEL[row.status])}
          </Badge>
          <ScheduleRowHelp row={row} />
        </li>
      ))}
    </ul>
  );
}

/** A stopping row explains what to do even while the run button is disabled (nothing due), plus the check summary. */
function ScheduleRowHelp({ row }: { row: ScheduleRow }) {
  const { t } = useLocale();
  const hint = scheduleRowHint(row);
  if (!hint) return null;
  return (
    <div className="flex basis-full flex-col gap-1" data-testid="recurring-schedule-hint">
      <p className="text-xs text-text-secondary">{t(hint)}</p>
      {row.detail ? (
        <details className="ui-error-details">
          <summary>{t(S.technicalDetails)}</summary>
          <dl>
            <dt>{t({ ja: '検査の要約', en: 'Check summary' })}</dt>
            <dd className="code">{row.detail}</dd>
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function TemplateResult({ run, scale }: { run: TemplateRun; scale: number }) {
  const { t } = useLocale();
  const period = periodSuffix(run.stop?.periodCode);
  return (
    <li
      className="flex flex-col gap-2 border-b border-border-subtle py-3 last:border-b-0"
      data-testid="recurring-result"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/e/$entity/$id"
          params={{ entity: RECURRING_ENTITY, id: run.templateId }}
          className="ui-link text-sm font-semibold"
        >
          {run.name}
        </Link>
        <Badge tone={RUN_TONE[run.status]} data-testid="recurring-result-status">
          {t(RUN_STATUS_LABEL[run.status])}
        </Badge>
        {run.more ? (
          <span className="text-xs text-text-muted">
            {t({ ja: '残りの回は次の生成で作ります', en: 'The remaining occurrences come with the next run' })}
          </span>
        ) : null}
      </div>
      {run.entries.length ? (
        <ul className="flex flex-col gap-1">
          {run.entries.map((entry) => (
            <li key={entry.entryId} className="flex flex-wrap items-center gap-x-3 text-sm">
              <Link
                to="/e/$entity/$id"
                params={{ entity: 'journal_entry', id: entry.entryId }}
                className="ui-link"
                data-testid="recurring-entry-link"
              >
                {entry.number ?? t({ ja: `${entry.occurrenceDate} の下書き`, en: `Draft of ${entry.occurrenceDate}` })}
              </Link>
              {/* a draft's link already names its date */}
              {entry.number ? <span className="text-text-muted">{entry.occurrenceDate}</span> : null}
              <span className="tabular-nums">{formatDecimal(entry.amount, scale)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {run.stop ? (
        <div className="ui-notice ui-notice-warning" data-testid="recurring-stop">
          <p>
            {t({
              ja: `${run.stop.occurrenceDate} の回で止まりました: `,
              en: `Stopped at ${run.stop.occurrenceDate}: `,
            })}
            {t(STOP_REASON_LABEL[run.stop.reason])}
            {period ? t(period) : ''}
          </p>
          <p>{t(stopHint(run.stop.reason, run.kind === 'allocation'))}</p>
          <details className="ui-error-details">
            <summary>{t(S.technicalDetails)}</summary>
            <dl>
              <dt>{t(S.errorCode)}</dt>
              <dd className="code">{run.stop.code}</dd>
              <dt>{t({ ja: 'メッセージ', en: 'Message' })}</dt>
              <dd>{run.stop.message}</dd>
              {run.stop.hint ? (
                <>
                  <dt>{t(S.errorHint)}</dt>
                  <dd>{run.stop.hint}</dd>
                </>
              ) : null}
              {(run.stop.issues ?? []).map((issue, i) => (
                <dd key={i} className="code">
                  {issue.path}: {issue.message}
                </dd>
              ))}
            </dl>
          </details>
        </div>
      ) : null}
    </li>
  );
}

function RunResult({
  result,
  scale,
  headingRef,
}: {
  result: GenerateResult;
  scale: number;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const { t } = useLocale();
  const links = resultLinks(result);
  return (
    <Card data-testid="recurring-result-card">
      <FormSection
        landmark
        headingRef={headingRef}
        title={t({ ja: '生成の結果', en: 'Result' })}
        description={t(resultSummary(result))}
      >
        {result.templates.length ? (
          <ul className="flex flex-col">
            {result.templates.map((run) => (
              <TemplateResult key={run.templateId} run={run} scale={scale} />
            ))}
          </ul>
        ) : null}
        {links.length ? (
          <div className="flex flex-wrap gap-2" data-testid="recurring-result-links">
            {links.map((link) => (
              <Link key={link.href} to={link.href} className={buttonClass('default', 'sm')}>
                {t(link.label)}
              </Link>
            ))}
          </div>
        ) : null}
      </FormSection>
    </Card>
  );
}

function RecurringRun({ meta }: { meta: AppMeta }) {
  const { t } = useLocale();
  const toast = useToast();
  const dateId = useId();
  const dateErrorId = useId();
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const scale = useCurrencyScale();
  const [asOf, setAsOf] = useState(() => businessToday());
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<GenerateResult>();
  const [runError, setRunError] = useState<unknown>();
  const validAsOf = validDate(asOf);
  const schedule = useRecurringSchedule(asOf, validAsOf);
  const command = useGenerateRecurring();
  const data = schedule.data;
  const busy = command.isPending;
  const autoSubmit = data?.autoSubmit ?? false;
  const canList = meta.entities.some((e) => e.name === RECURRING_ENTITY);
  const due = data ? dueRows(data) : [];

  // After a run the schedule is read again before onSuccess, so the dialog's opener ("Generate drafts") is usually
  // disabled (nothing due) and cannot take focus back: move keyboard focus to the result heading instead.
  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);

  const run = () => {
    if (busy || !validAsOf) return;
    setRunError(undefined);
    command.generate(asOf, {
      onSuccess: (res) => {
        setConfirm(false);
        setResult(res);
        toast.success(t(resultSummary(res)));
      },
      onError: (error) => {
        setConfirm(false);
        setRunError(error);
        toast.error(error);
      },
    });
  };
  const runErrorView = runError ? describeError(runError) : undefined;

  return (
    <div className="workspace-page" data-testid="recurring-page">
      <PageHeader
        eyebrow="RECURRING JOURNALS"
        title={t(TITLE)}
        titleTestId="recurring-title"
        subtitle={t({
          ja: '家賃の未払計上や前払費用の振替など、定期仕訳に登録した仕訳を基準日までの回の分だけ作ります。同じ回は二度作らず、締めた期間の回では止まります。',
          en: 'Creates the entries of your recurring journals (accrued rent, prepaid expense transfers) for every occurrence up to the base date. An occurrence is never created twice, and a closed period stops its template.',
        })}
        icon={
          <span className="icon-tile">
            <Icon name="calendar" />
          </span>
        }
        actions={
          canList ? (
            <Link to="/e/$entity" params={{ entity: RECURRING_ENTITY }} className={buttonClass('default', 'sm')}>
              {t({ ja: '定期仕訳の一覧', en: 'Recurring journals' })}
            </Link>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-4">
        <Card>
          <FormSection
            title={t({ ja: '生成する範囲', en: 'What to generate' })}
            description={t({
              ja: 'この日までに期日が来た回を作ります（既定は今日）。',
              en: 'Occurrences due on or before this date are created (today by default).',
            })}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={dateId} className="text-sm font-semibold text-text-secondary">
                  {t({ ja: '基準日', en: 'Base date' })}
                </label>
                <input
                  id={dateId}
                  type="date"
                  className="input"
                  value={asOf}
                  disabled={busy}
                  aria-invalid={!validAsOf}
                  aria-describedby={validAsOf ? undefined : dateErrorId}
                  onChange={(event) => {
                    setAsOf(event.target.value);
                    setResult(undefined);
                  }}
                  data-testid="recurring-as-of"
                />
              </div>
              <Button
                variant="primary"
                onClick={() => setConfirm(true)}
                disabled={busy || !canGenerate(data)}
                data-testid="recurring-run"
              >
                {t(runButtonLabel(autoSubmit))}
              </Button>
            </div>
            {!validAsOf ? (
              <p id={dateErrorId} className="ui-field-error">
                {t({ ja: '日付を入れてください。', en: 'Enter a date.' })}
              </p>
            ) : null}
            {data ? (
              <p
                className={autoSubmit ? 'ui-notice ui-notice-warning' : 'text-sm text-text-secondary'}
                data-testid="recurring-auto-submit"
              >
                {t(autoSubmitNotice(autoSubmit))}
              </p>
            ) : null}
          </FormSection>
        </Card>
        {runErrorView ? (
          <div role="alert" className="ui-notice ui-notice-danger ui-error-panel" data-testid="recurring-run-error">
            <p className="ui-error-title">{t({ ja: '生成できませんでした', en: 'Generation failed' })}</p>
            {runErrorView.explanation ? <p className="ui-error-message">{t(runErrorView.explanation)}</p> : null}
            <p className="ui-error-message">{runErrorView.message}</p>
            <ErrorDetails view={runErrorView} />
          </div>
        ) : null}
        {result ? <RunResult result={result} scale={scale} headingRef={resultHeading} /> : null}
        {!validAsOf ? null : schedule.isError ? (
          <MetaError error={schedule.error} retry={() => void schedule.refetch()} />
        ) : !data ? (
          <>
            <p className="sr-only" aria-live="polite">
              {t(S.loading)}
            </p>
            <div aria-busy="true">
              <SkeletonCard lines={3} />
            </div>
          </>
        ) : data.rows.length === 0 ? (
          <Card>
            <EmptyState
              titleAs="h2"
              testId="recurring-nothing-due"
              title={t({ ja: '生成する定期仕訳はありません', en: 'No recurring journals are due' })}
              description={t({
                ja: '基準日までに期日が来た回はありません。定期仕訳の登録・変更は一覧から行います。',
                en: 'Nothing is due up to the base date. Register or change recurring journals from their list.',
              })}
              action={
                canList ? (
                  <Link to="/e/$entity" params={{ entity: RECURRING_ENTITY }} className={buttonClass()}>
                    {t({ ja: '定期仕訳の一覧', en: 'Recurring journals' })}
                  </Link>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <Card>
            <FormSection
              landmark
              title={t({ ja: '期日が来た回', en: 'Occurrences due' })}
              description={t({
                ja: `${due.length} 回を作ります。「止まる」の回とそれより後は、期間を開くか定期仕訳を直すまで作りません。`,
                en: `${due.length} ${due.length === 1 ? 'occurrence' : 'occurrences'} will be created. A stop and everything after it waits until the period is opened or the template is fixed.`,
              })}
            >
              <ScheduleList rows={data.rows} scale={scale} />
              {data.truncated ? (
                <p className="text-xs text-text-muted">
                  {t({ ja: '表示の上限に達したため一部だけを表示しています。', en: 'Only part of the list is shown.' })}
                </p>
              ) : null}
            </FormSection>
          </Card>
        )}
      </div>
      {confirm ? (
        <Dialog
          title={t(
            autoSubmit
              ? { ja: `${asOf} までの回を生成して確定しますか`, en: `Generate and submit up to ${asOf}?` }
              : { ja: `${asOf} までの回の下書きを生成しますか`, en: `Generate drafts up to ${asOf}?` },
          )}
          description={t({
            ja: `${due.length} 回分の仕訳を作ります。${autoSubmit ? '会社の設定により、作ると同時に確定（転記）します。' : '下書きなので、確かめてから仕訳の画面で確定してください。'}同じ回はもう一度実行しても作りません。`,
            en: `${due.length} ${due.length === 1 ? 'entry' : 'entries'} will be created. ${autoSubmit ? 'The company setting submits (posts) them right away.' : 'They are drafts; review and submit them on the journal entry screen.'} Running again never creates the same occurrence twice.`,
          })}
          closeLabel={t(S.close)}
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
          icon={
            <span className="icon-tile">
              <Icon name="check" />
            </span>
          }
          actions={
            <>
              <Button onClick={() => setConfirm(false)} disabled={busy} data-autofocus>
                {t({ ja: '戻る', en: 'Go back' })}
              </Button>
              <Button variant="primary" onClick={run} disabled={busy} data-testid="recurring-confirm">
                {t(runButtonLabel(autoSubmit))}
              </Button>
            </>
          }
        />
      ) : null}
      <span className="sr-only" aria-live="polite">
        {busy ? t({ ja: '生成しています', en: 'Generating' }) : ''}
      </span>
    </div>
  );
}
