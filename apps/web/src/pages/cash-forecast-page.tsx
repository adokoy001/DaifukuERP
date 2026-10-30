// /finance/cash-forecast — the cash forecast screen (docs/specs/cash-forecast.md AC-20..AC-27), built with the UI
// kit. It runs banking.cash_forecast and banking.cash_schedule once each for the conditions in the URL (default: today
// and the next 89 days), and shows a summary, the guidance for the result, a balance chart, the daily table
// (ReportTable) and the schedule. CSV goes through the existing ReportExport (fresh export authority). No new read or
// write path: both actions are the server's report actions.
import type { CashScheduleRow } from '@daifuku/mod-banking/contract';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isApiError } from '../api/client.ts';
import { useCurrencyScale } from '../api/company.tsx';
import { useCashForecast, useCashSchedule, type CashForecastResult } from '../api/cash-forecast.ts';
import { financeIdentity } from '../api/finance.ts';
import { useMeta } from '../api/queries.ts';
import type { Label } from '../api/types.ts';
import { CashForecastChart } from '../components/cash-forecast-chart.tsx';
import { ReportExport } from '../components/report-export.tsx';
import { ReportTable } from '../components/report-table.tsx';
import { useLocale } from '../i18n.tsx';
import {
  CASH_FORECAST_ACTION,
  CASH_SCHEDULE_ACTION,
  cashNotices,
  chartLabel,
  columnClass,
  conditionErrors,
  conditionsFromSearch,
  DIRECTION_LABEL,
  documentLink,
  hasNothing,
  hideQuietDays,
  minBalanceWarning,
  QUICK_RANGE_LABEL,
  QUICK_RANGES,
  quickRange,
  sameConditions,
  searchFromConditions,
  SOURCE_LABEL,
  STATE_LABEL,
  todayForCash,
  yen,
  type CashConditions,
} from '../lib/cash-forecast.ts';
import { formatDecimal } from '../lib/format.ts';
import { S } from '../strings.ts';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  cellAlignClass,
  DataTableShell,
  EmptyState,
  PageHeader,
  SkeletonCard,
  TabPanel,
  Tabs,
} from '../ui/index.ts';
import '../cash-forecast.css';
import { LoadingView, MetaError } from './status-views.tsx';

const TITLE: Label = { ja: '資金繰り表', en: 'Cash forecast' };
const SCHEDULE_PAGE = 50;

export function CashForecastPage() {
  const { t } = useLocale();
  const meta = useMeta();
  if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  const forecastAction = meta.data.actions.find((a) => a.name === CASH_FORECAST_ACTION);
  const scheduleAction = meta.data.actions.find((a) => a.name === CASH_SCHEDULE_ACTION);
  // AC-26: the navigation hides the screen without the action; a direct URL explains instead of calling it.
  if (!forecastAction || !scheduleAction)
    return (
      <div className="workspace-page">
        <EmptyState
          titleAs="h1"
          testId="cash-no-access"
          title={t({ ja: '資金繰り表を使う権限がありません', en: 'You cannot use the cash forecast' })}
          description={t({
            ja: '全社を対象とする経理または管理者の役割が必要です。必要なら管理者に役割の追加を依頼してください。',
            en: 'The accounting or admin role for the whole company is required. Ask your administrator to add it if you need it.',
          })}
          action={
            <Link to="/" className={buttonClass()}>
              {t({ ja: 'ホームへ戻る', en: 'Back to home' })}
            </Link>
          }
        />
      </div>
    );
  return (
    <CashForecastView
      key={financeIdentity()}
      canExportForecast={forecastAction.canExport === true}
      canExportSchedule={scheduleAction.canExport === true}
    />
  );
}

type FieldErrors = { from?: Label; to?: Label };

function CashForecastView({
  canExportForecast,
  canExportSchedule,
}: {
  canExportForecast: boolean;
  canExportSchedule: boolean;
}) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/finance/cash-forecast' });
  const [today] = useState(() => todayForCash());
  // The URL is the source of the shown conditions; a changed URL (history, a link) resets the form to it.
  const applied = conditionsFromSearch(search, today);
  const appliedKey = JSON.stringify(applied);
  const [form, setForm] = useState<CashConditions>(applied);
  const [errors, setErrors] = useState<FieldErrors>({});
  useEffect(() => setForm(JSON.parse(appliedKey) as CashConditions), [appliedKey]);
  const forecast = useCashForecast(applied);
  const schedule = useCashSchedule(applied);
  const stale = !sameConditions(form, applied);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const ids = { from: useId(), to: useId(), drafts: useId(), overdue: useId() };
  // AC-20: a server VALIDATION is shown on the input it names.
  const serverError = forecast.error ?? schedule.error;
  const serverFieldErrors = useMemo<FieldErrors>(() => {
    if (!isApiError(serverError) || serverError.code !== 'VALIDATION') return {};
    const out: FieldErrors = {};
    for (const issue of serverError.issues()) {
      const field = issue.path === 'from' ? 'from' : issue.path === 'to' ? 'to' : undefined;
      if (field) out[field] = { ja: issue.message, en: issue.message };
    }
    return out;
  }, [serverError]);
  const shownErrors: FieldErrors = { ...serverFieldErrors, ...errors };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = conditionErrors(form, today);
    setErrors(found);
    if (found.from || found.to) {
      (found.from ? fromRef : toRef).current?.focus();
      return;
    }
    if (sameConditions(form, applied)) {
      void forecast.refetch();
      void schedule.refetch();
      return;
    }
    void navigate({ to: '/finance/cash-forecast', search: searchFromConditions(form), replace: true });
  };
  const errorText = (field: 'from' | 'to') => {
    const message = shownErrors[field];
    return message ? (
      <span id={`${ids[field]}-error`} className="cash-field-error" data-testid={`cash-${field}-error`}>
        {t(message)}
      </span>
    ) : null;
  };
  return (
    <div className="workspace-page cash-page">
      <PageHeader
        eyebrow="FINANCE"
        title={t(TITLE)}
        titleTestId="cash-title"
        subtitle={t({
          ja: '記帳済みの入出金と、確定済みの請求・支払ファイル・契約・給与から見込まれる入出金を日別に並べ、残高の推移を示します。',
          en: 'Lists posted cash movements and the receipts and payments expected from submitted invoices, transfer files, contracts and payroll by day, with the running balance.',
        })}
      />
      <Card
        as="form"
        onSubmit={submit}
        noValidate
        aria-label={t({ ja: '表示の条件', en: 'Conditions' })}
        className="cash-conditions"
        data-testid="cash-form"
      >
        <div className="cash-quick" role="group" aria-label={t({ ja: '期間の簡単入力', en: 'Quick period selection' })}>
          {QUICK_RANGES.map((kind) => (
            <Button
              key={kind}
              size="sm"
              onClick={() => {
                setErrors({});
                setForm((current) => ({ ...current, ...quickRange(kind, today) }));
              }}
            >
              {t(QUICK_RANGE_LABEL[kind])}
            </Button>
          ))}
        </div>
        <div className="cash-fields">
          <div className="cash-field">
            <label htmlFor={ids.from}>{t({ ja: '開始日', en: 'Start date' })}</label>
            <input
              ref={fromRef}
              id={ids.from}
              className="input"
              type="date"
              value={form.from}
              aria-invalid={shownErrors.from ? true : undefined}
              aria-describedby={shownErrors.from ? `${ids.from}-error` : undefined}
              onChange={(e) => setForm((c) => ({ ...c, from: e.target.value }))}
            />
            {errorText('from')}
          </div>
          <div className="cash-field">
            <label htmlFor={ids.to}>{t({ ja: '終了日', en: 'End date' })}</label>
            <input
              ref={toRef}
              id={ids.to}
              className="input"
              type="date"
              value={form.to}
              aria-invalid={shownErrors.to ? true : undefined}
              aria-describedby={shownErrors.to ? `${ids.to}-error` : undefined}
              onChange={(e) => setForm((c) => ({ ...c, to: e.target.value }))}
            />
            {errorText('to')}
          </div>
          <label htmlFor={ids.drafts} className="cash-check">
            <input
              id={ids.drafts}
              type="checkbox"
              checked={form.includeDrafts}
              onChange={(e) => setForm((c) => ({ ...c, includeDrafts: e.target.checked }))}
            />
            {t({ ja: '下書きを表示', en: 'Show drafts' })}
          </label>
          <label htmlFor={ids.overdue} className="cash-check">
            <input
              id={ids.overdue}
              type="checkbox"
              checked={form.includeOverdue}
              onChange={(e) => setForm((c) => ({ ...c, includeOverdue: e.target.checked }))}
            />
            {t({ ja: '期日超過を今日に含める', en: 'Include overdue on today' })}
          </label>
          <Button type="submit" variant="primary" disabled={forecast.isFetching || schedule.isFetching}>
            {t({ ja: '表示', en: 'Show' })}
          </Button>
        </div>
        <p className="cash-note">
          {t({
            ja: '日付は日本時間の暦日です。期間は366日以内、終了日は今日から730日以内です。',
            en: 'Dates are Japanese calendar dates. The period is at most 366 days and ends within 730 days from today.',
          })}
        </p>
      </Card>
      {stale ? (
        <p role="status" className="ui-notice ui-notice-info cash-stale" data-testid="cash-stale">
          {t({
            ja: '条件が変更されています。表示中は前回の条件の結果です。「表示」を押すと再計算します。CSV は再計算まで出力できません。',
            en: 'The conditions have changed. These are the results of the previous conditions. Press Show to recalculate; CSV export is off until then.',
          })}
        </p>
      ) : null}
      <Results
        forecast={forecast}
        schedule={schedule}
        stale={stale}
        canExportForecast={canExportForecast}
        canExportSchedule={canExportSchedule}
        validationOnly={Object.keys(serverFieldErrors).length > 0}
      />
    </div>
  );
}

function Results({
  forecast,
  schedule,
  stale,
  canExportForecast,
  canExportSchedule,
  validationOnly,
}: {
  forecast: ReturnType<typeof useCashForecast>;
  schedule: ReturnType<typeof useCashSchedule>;
  stale: boolean;
  canExportForecast: boolean;
  canExportSchedule: boolean;
  validationOnly: boolean;
}) {
  const { t } = useLocale();
  if (validationOnly) return null;
  if (forecast.isError || schedule.isError)
    return (
      <MetaError
        error={forecast.error ?? schedule.error}
        retry={() => {
          void forecast.refetch();
          void schedule.refetch();
        }}
      />
    );
  if (!forecast.data || !schedule.data)
    return (
      <section aria-label={t({ ja: '計算結果', en: 'Results' })} className="cash-results">
        <p className="sr-only" aria-live="polite">
          {t(S.loading)}
        </p>
        <div aria-busy="true" className="cash-loading" data-testid="cash-loading">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={5} />
        </div>
      </section>
    );
  return (
    <ResultView
      forecast={forecast.data}
      scheduleRows={schedule.data.rows}
      scheduleTable={schedule.data.table}
      scheduleTruncated={schedule.data.meta.truncated}
      scheduleCount={schedule.data.meta.rowCount}
      stale={stale}
      canExportForecast={canExportForecast}
      canExportSchedule={canExportSchedule}
    />
  );
}

function Amount({ value, scale }: { value: string; scale: number }) {
  return (
    <span className={value.startsWith('-') ? 'cash-amount is-negative' : 'cash-amount'}>
      {formatDecimal(value, scale)}
    </span>
  );
}

function ResultView({
  forecast,
  scheduleRows,
  scheduleTable,
  scheduleTruncated,
  scheduleCount,
  stale,
  canExportForecast,
  canExportSchedule,
}: {
  forecast: CashForecastResult;
  scheduleRows: CashScheduleRow[];
  scheduleTable: CashForecastResult['table'];
  scheduleTruncated: boolean;
  scheduleCount: number;
  stale: boolean;
  canExportForecast: boolean;
  canExportSchedule: boolean;
}) {
  const { t } = useLocale();
  const scale = useCurrencyScale();
  const meta = forecast.meta;
  const [tab, setTab] = useState<'daily' | 'schedule'>('daily');
  const [hideQuiet, setHideQuiet] = useState(true);
  const quietId = useId();
  const table = useMemo(() => (hideQuiet ? hideQuietDays(forecast.table) : forecast.table), [hideQuiet, forecast]);
  const notices = cashNotices(meta, scale);
  const warning = minBalanceWarning(meta, scale);
  const input = {
    from: meta.from,
    to: meta.to,
    ...(meta.includeDrafts ? { includeDrafts: true } : {}),
    ...(meta.includeOverdue ? { includeOverdue: true } : {}),
  };
  const totals = forecast.table.totals ?? {};
  const empty = hasNothing(forecast.table, scheduleRows.length, meta);
  return (
    <section aria-labelledby="cash-result-title" className="cash-results" data-testid="cash-result">
      <h2 id="cash-result-title" className="cash-result-title" data-testid="cash-result-title">
        {t(forecast.table.title)}
      </h2>
      <dl className="cash-summary" data-testid="cash-summary">
        <div>
          <dt>
            {meta.openingBasis === 'projected'
              ? t({ ja: '期首残高（見込み）', en: 'Opening balance (projected)' })
              : t({ ja: '期首残高', en: 'Opening balance' })}
          </dt>
          <dd data-testid="cash-opening">
            <Amount value={meta.openingBalance} scale={scale} />
          </dd>
        </div>
        <div>
          <dt>{t({ ja: '入金計', en: 'Total in' })}</dt>
          <dd data-testid="cash-inflow">
            <Amount value={totals.inflow ?? '0'} scale={scale} />
          </dd>
        </div>
        <div>
          <dt>{t({ ja: '出金計', en: 'Total out' })}</dt>
          <dd data-testid="cash-outflow">
            <Amount value={totals.outflow ?? '0'} scale={scale} />
          </dd>
        </div>
        <div>
          <dt>{t({ ja: '期末残高', en: 'Closing balance' })}</dt>
          <dd data-testid="cash-closing">
            <Amount value={meta.closingBalance} scale={scale} />
          </dd>
        </div>
        <div>
          <dt>{t({ ja: '最低残高', en: 'Lowest balance' })}</dt>
          <dd data-testid="cash-min">
            <Amount value={meta.minBalance.balance} scale={scale} />{' '}
            <span className="cash-min-date">{meta.minBalance.date}</span>
          </dd>
        </div>
      </dl>
      {warning ? (
        <p className="ui-notice ui-notice-warning cash-warning" data-testid="cash-warning">
          {t(warning)}
        </p>
      ) : null}
      {notices.length > 0 ? (
        <ul className="cash-notices" aria-label={t({ ja: '計算についての案内', en: 'Notes on this result' })}>
          {notices.map((n) => (
            <li
              key={n.id}
              className={`ui-notice ${n.tone === 'warning' ? 'ui-notice-warning' : 'ui-notice-info'}`}
              data-testid={`cash-notice-${n.id}`}
            >
              <span>{t(n.text)}</span>
              {n.link ? (
                <Link to={n.link.to} className="ui-link">
                  {t(n.link.label)}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {empty ? (
        <EmptyState
          titleAs="h2"
          testId="cash-empty"
          title={t({
            ja: 'この期間には入出金も予定もありません',
            en: 'No movements or scheduled items in this period',
          })}
          description={t({
            ja: '記帳済みの入出金、確定済みの請求・支払ファイル・契約・給与の予定がありません。期間を変えて「表示」を押してください。',
            en: 'There are no posted movements and nothing scheduled from submitted invoices, transfer files, contracts or payroll. Change the period and press Show.',
          })}
        />
      ) : (
        <>
          <CashForecastChart
            rows={forecast.rows}
            includeDrafts={meta.includeDrafts}
            label={t(chartLabel(meta, scale))}
            scale={scale}
          />
          <Tabs
            idPrefix="cash"
            label={t({ ja: '表示する表', en: 'Tables' })}
            selected={tab}
            onSelect={(id) => setTab(id === 'schedule' ? 'schedule' : 'daily')}
            items={[
              { id: 'daily', label: t({ ja: '日別の表', en: 'Daily table' }) },
              {
                id: 'schedule',
                label: t({ ja: `入出金予定（${scheduleCount} 件）`, en: `Schedule (${scheduleCount})` }),
              },
            ]}
          />
          <TabPanel idPrefix="cash" id="daily" selected={tab === 'daily'}>
            <div className="cash-table-tools">
              <label htmlFor={quietId} className="cash-check">
                <input
                  id={quietId}
                  type="checkbox"
                  checked={hideQuiet}
                  onChange={(e) => setHideQuiet(e.target.checked)}
                />
                {t({ ja: '動きのない日を隠す', en: 'Hide days without movements' })}
              </label>
              <ReportExport
                actionName={CASH_FORECAST_ACTION}
                input={input}
                allowed={canExportForecast}
                disabled={stale || forecast.table.rows.length === 0}
              />
            </div>
            <p className="cash-legend" data-testid="cash-column-legend">
              <span className="cash-legend-chip cash-col-posted">{t({ ja: '記帳済み', en: 'Posted' })}</span>
              <span className="cash-legend-chip cash-col-scheduled">{t({ ja: '予定', en: 'Scheduled' })}</span>
              {meta.includeDrafts ? (
                <span className="cash-legend-chip cash-col-draft">
                  {t({ ja: '下書き（残高に含めない）', en: 'Draft (not in the balance)' })}
                </span>
              ) : null}
              <span className="cash-legend-chip cash-col-total">
                {t({ ja: '合計と残高', en: 'Totals and balance' })}
              </span>
            </p>
            <ReportTable result={table} columnClass={columnClass} />
          </TabPanel>
          <TabPanel idPrefix="cash" id="schedule" selected={tab === 'schedule'}>
            <div className="cash-table-tools">
              {scheduleTruncated ? (
                <Badge tone="warning">
                  {t({
                    ja: `先頭 ${scheduleRows.length} 件だけを表示しています（全 ${scheduleCount} 件）`,
                    en: `Showing the first ${scheduleRows.length} of ${scheduleCount}`,
                  })}
                </Badge>
              ) : null}
              <ReportExport
                actionName={CASH_SCHEDULE_ACTION}
                input={input}
                allowed={canExportSchedule}
                disabled={stale || scheduleTable.rows.length === 0}
              />
            </div>
            <ScheduleTable rows={scheduleRows} scale={scale} />
          </TabPanel>
        </>
      )}
      <details className="cash-accounts" data-testid="cash-accounts">
        <summary>
          {t({
            ja: `計算に使った資金科目（${meta.cashAccounts.length}）`,
            en: `Cash accounts used (${meta.cashAccounts.length})`,
          })}
        </summary>
        <ul>
          {meta.cashAccounts.map((a) => (
            <li key={a.accountId}>
              <span className="cash-account-name">
                {a.code} {a.name}
              </span>
              <span className="cash-account-balance">
                {t({ ja: `${meta.from} 前日の残高`, en: `Balance before ${meta.from}` })} {yen(a.balance, scale)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function ScheduleTable({ rows, scale }: { rows: CashScheduleRow[]; scale: number }) {
  const { t } = useLocale();
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows]);
  const pages = Math.max(1, Math.ceil(rows.length / SCHEDULE_PAGE));
  const shown = rows.slice(page * SCHEDULE_PAGE, (page + 1) * SCHEDULE_PAGE);
  const head = (
    <tr>
      <th scope="col">{t({ ja: '日付', en: 'Date' })}</th>
      <th scope="col">{t({ ja: '区分', en: 'Direction' })}</th>
      <th scope="col">{t({ ja: '種類', en: 'Source' })}</th>
      <th scope="col">{t({ ja: '状態', en: 'State' })}</th>
      <th scope="col">{t({ ja: '番号', en: 'Number' })}</th>
      <th scope="col">{t({ ja: '取引先', en: 'Partner' })}</th>
      <th scope="col" className={cellAlignClass('right')}>
        {t({ ja: '金額', en: 'Amount' })}
      </th>
    </tr>
  );
  return (
    <>
      <DataTableShell
        head={head}
        columnCount={7}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            title={t({ ja: '予定はありません', en: 'Nothing scheduled' })}
            description={t({
              ja: 'この期間に置く予定も、期日超過の予定もありません。',
              en: 'Nothing is scheduled in this period and nothing is overdue.',
            })}
          />
        }
        label={t({ ja: '入出金予定', en: 'Cash schedule' })}
        testId="cash-schedule-table"
      >
        {shown.map((row, index) => {
          const link = documentLink(row);
          return (
            <tr key={`${page}-${index}`} data-testid="cash-schedule-row">
              <td>
                <span className="cash-date">{row.date}</span>
                {row.dueDate !== row.date ? (
                  <span className="cash-due">{t({ ja: `期日 ${row.dueDate}`, en: `Due ${row.dueDate}` })}</span>
                ) : null}
              </td>
              <td>{t(DIRECTION_LABEL[row.direction])}</td>
              <td>{t(SOURCE_LABEL[row.source])}</td>
              <td>
                <span className="cash-badges">
                  <Badge tone={row.state === 'draft' ? 'neutral' : 'accent'}>{t(STATE_LABEL[row.state])}</Badge>
                  {row.overdue ? <Badge tone="warning">{t({ ja: '期日超過', en: 'Overdue' })}</Badge> : null}
                  {!row.inBalance ? (
                    <Badge tone="neutral">{t({ ja: '残高に含めない', en: 'Not in balance' })}</Badge>
                  ) : null}
                </span>
              </td>
              <td>
                {row.source === 'payroll' ? (
                  t({ ja: `給与（${row.count} 件）`, en: `Payroll (${row.count})` })
                ) : link ? (
                  <Link to="/e/$entity/$id" params={link} className="ui-link">
                    {row.number ?? t({ ja: '（番号なし）', en: '(no number)' })}
                    {row.period ? ` ${row.period}` : ''}
                  </Link>
                ) : (
                  (row.number ?? '—')
                )}
              </td>
              <td>{row.partnerName ?? '—'}</td>
              <td className={cellAlignClass('right')}>
                <Amount value={row.amount} scale={scale} />
              </td>
            </tr>
          );
        })}
      </DataTableShell>
      {pages > 1 ? (
        <nav className="cash-pager" aria-label={t({ ja: '入出金予定のページ移動', en: 'Schedule pagination' })}>
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t({ ja: '前へ', en: 'Previous' })}
          </Button>
          <span>
            {page * SCHEDULE_PAGE + 1}–{Math.min(rows.length, (page + 1) * SCHEDULE_PAGE)} / {rows.length}
          </span>
          <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            {t({ ja: '次へ', en: 'Next' })}
          </Button>
        </nav>
      ) : null}
    </>
  );
}
