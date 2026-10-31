// /finance/depreciation — preview and run the depreciation of a fiscal period (docs/specs/fixed-assets.md AC-32..AC-34),
// built with the UI kit. Reads fixed_assets.preview_depreciation (no writes), runs fixed_assets.run_depreciation after a
// kit Dialog confirmation; everything else (register, disposals, reports) is the generic DSL screens.
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useClosePeriods } from '../api/close.ts';
import { isApiError, request } from '../api/client.ts';
import { useDepreciationPreview } from '../api/depreciation.ts';
import { financeIdentity, useFinanceCommand } from '../api/finance.ts';
import { useMeta } from '../api/queries.ts';
import type { AppMeta, Label } from '../api/types.ts';
import { Icon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import { noFiscalPeriods, periodOption, periodRange, type ClosePeriod } from '../lib/close-guide.ts';
import {
  accountsText,
  acquiredText,
  assetClassText,
  BLOCKER_LABEL,
  canRun,
  kindText,
  METHOD_LABEL,
  methodText,
  OPEN_FISCAL_YEAR_ACTION,
  PREVIEW_ACTION,
  rateTableTitle,
  RULES_ACTION,
  RULES_SETTING_LINK,
  RUN_ACTION,
  runAnnouncement,
  runBlockers,
  skippedText,
  totalText,
  yen,
  type DepreciationPreview,
  type RulesView,
  type RunResult,
} from '../lib/depreciation.ts';
import { S } from '../strings.ts';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  cellAlignClass,
  DataTableShell,
  Dialog,
  EmptyState,
  FormSection,
  PageHeader,
  SkeletonCard,
} from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const TITLE: Label = { ja: '償却の実行', en: 'Depreciation run' };

export function DepreciationPage() {
  const { t } = useLocale();
  const meta = useMeta();
  if (!meta.data) return <LoadingView />;
  // AC-33: the navigation hides the screen without the preview action; a direct URL explains instead of failing.
  if (!meta.data.actions.some((action) => action.name === PREVIEW_ACTION))
    return (
      <div className="workspace-page">
        <EmptyState
          titleAs="h1"
          title={t({ ja: '償却の実行を使う権限がありません', en: 'You cannot use the depreciation run' })}
          description={t({
            ja: '経理・閲覧または管理者の役割が必要です。必要なら管理者に役割の追加を依頼してください。',
            en: 'The accounting, viewer or admin role is required. Ask your administrator to add it if you need it.',
          })}
          action={
            <Link to="/" className={buttonClass()}>
              {t({ ja: 'ホームへ戻る', en: 'Back to home' })}
            </Link>
          }
        />
      </div>
    );
  return <DepreciationRun key={financeIdentity()} meta={meta.data} />;
}

/**
 * A table of the rules viewer under a visible heading. Its rows hold no link or input, so the frame that scrolls
 * sideways on a narrow screen takes focus itself (tabIndex 0, role region, named like the table; docs/conventions/ui.md).
 */
function RulesTable({ title, head, children }: { title: string; head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="mt-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="ui-table-frame" tabIndex={0} role="region" aria-label={title}>
        <table className="ui-table" aria-label={title}>
          <thead>
            <tr>{head}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * AC-32 / AC-35: every legal parameter behind the postings, so a person can compare them with the primary sources before
 * recording the confirmation (and look up useful-life examples later): sources, rate tables, memorandum values, method
 * restrictions, the rounding, and the useful-life examples. Always reachable, collapsed.
 */
function RulesDetails({ meta }: { meta: AppMeta }) {
  const { t, locale } = useLocale();
  const rules = useQuery({
    queryKey: ['finance', financeIdentity(), 'depreciation-rules'],
    queryFn: ({ signal }) =>
      request<RulesView>(`/actions/${RULES_ACTION}`, { method: 'POST', body: {}, signal, cache: 'no-store' }),
    retry: false,
    gcTime: 0,
    networkMode: 'always',
  });
  if (!rules.data) return null;
  const data = rules.data;
  const right = cellAlignClass('right');
  return (
    <Card>
      <details data-testid="depreciation-rules">
        <summary className="cursor-pointer text-sm font-semibold">
          {t({ ja: `償却の規則を見る（${data.id}）`, en: `Show the depreciation rules (${data.id})` })}
        </summary>
        <p className="mt-2 text-sm">
          {t({
            ja: '照合の対象は転記に使うすべての値です: 償却率表と適用する取得日、備忘価額と適用する取得日、償却方法の制限、端数処理（年額・月の配分・除却の年の限度額は円未満を切り捨て。切捨ての出典の箇所は未確認）。',
            en: 'A confirmation covers every value postings use: the rate tables and the acquisition dates they apply to, the memorandum values and their dates, the method restrictions, and the rounding (yearly, monthly and disposal-year amounts are cut down to the yen; the primary source of this rounding is not yet confirmed).',
          })}
        </p>
        <p className="mt-1 text-xs text-text-secondary">{t({ ja: '出典', en: 'Sources' })}</p>
        <ul className="flex flex-col gap-1 text-xs">
          {data.sources.map((url) => (
            <li key={url} className="break-all">
              <a href={url} target="_blank" rel="noreferrer" className="ui-link">
                {url}
              </a>
            </li>
          ))}
        </ul>
        {data.rateTables.map((table) => (
          <RulesTable
            key={`${table.method}-${table.acquiredFrom}`}
            title={`${rateTableTitle(table, locale)}（${t({ ja: '取得日', en: 'acquired' })} ${acquiredText(table, locale)}）`}
            head={[
              <th key="life" scope="col">
                {t({ ja: '耐用年数', en: 'Useful life' })}
              </th>,
              <th key="rate" scope="col" className={right}>
                {t({ ja: '償却率', en: 'Rate' })}
              </th>,
              <th key="revised" scope="col" className={right}>
                {t({ ja: '改定償却率', en: 'Revised rate' })}
              </th>,
              <th key="guarantee" scope="col" className={right}>
                {t({ ja: '保証率', en: 'Guarantee rate' })}
              </th>,
            ]}
          >
            {table.rows.map((row) => (
              <tr key={row.usefulLife}>
                <td>{row.usefulLife}</td>
                <td className={right}>{row.rate}</td>
                <td className={right}>{row.revisedRate ?? '—'}</td>
                <td className={right}>{row.guaranteeRate ?? '—'}</td>
              </tr>
            ))}
          </RulesTable>
        ))}
        <RulesTable
          title={t({ ja: '備忘価額', en: 'Memorandum values' })}
          head={[
            <th key="kind" scope="col">
              {t({ ja: '区分', en: 'Kind' })}
            </th>,
            <th key="dates" scope="col">
              {t({ ja: '取得日', en: 'Acquired' })}
            </th>,
            <th key="amount" scope="col" className={right}>
              {t({ ja: '金額（円）', en: 'Amount (yen)' })}
            </th>,
            <th key="source" scope="col">
              {t({ ja: '出典', en: 'Source' })}
            </th>,
          ]}
        >
          {data.memorandum.map((row) => (
            <tr key={`${row.kind}-${row.acquiredFrom}`}>
              <td>{kindText(row.kind, locale)}</td>
              <td>{acquiredText(row, locale)}</td>
              <td className={right}>{row.amount}</td>
              <td>{row.source}</td>
            </tr>
          ))}
        </RulesTable>
        <RulesTable
          title={t({ ja: '償却方法の制限', en: 'Method restrictions' })}
          head={[
            <th key="class" scope="col">
              {t({ ja: '資産の種類', en: 'Asset class' })}
            </th>,
            <th key="dates" scope="col">
              {t({ ja: '取得日', en: 'Acquired' })}
            </th>,
            <th key="methods" scope="col">
              {t({ ja: '認められる方法', en: 'Allowed methods' })}
            </th>,
            <th key="source" scope="col">
              {t({ ja: '出典', en: 'Source' })}
            </th>,
          ]}
        >
          {data.methodRestrictions.map((row) => (
            <tr key={`${row.assetClass}-${row.acquiredFrom}`}>
              <td>{assetClassText(meta, row.assetClass, locale)}</td>
              <td>{acquiredText(row, locale)}</td>
              <td>{row.methods.map((m) => METHOD_LABEL[m]?.[locale] ?? m).join(locale === 'ja' ? '、' : ', ')}</td>
              <td>{row.source}</td>
            </tr>
          ))}
        </RulesTable>
        <RulesTable
          title={t({ ja: '耐用年数の例', en: 'Useful-life examples' })}
          head={[
            <th key="label" scope="col">
              {t({ ja: '資産', en: 'Asset' })}
            </th>,
            <th key="class" scope="col">
              {t({ ja: '資産の種類', en: 'Asset class' })}
            </th>,
            <th key="years" scope="col" className={right}>
              {t({ ja: '耐用年数', en: 'Useful life' })}
            </th>,
            <th key="table" scope="col">
              {t({ ja: '出典の別表', en: 'Table' })}
            </th>,
          ]}
        >
          {data.usefulLifeExamples.map((row) => (
            <tr key={`${row.assetClass}-${row.label.ja}`}>
              <td>{t(row.label)}</td>
              <td>{assetClassText(meta, row.assetClass, locale)}</td>
              <td className={right}>{row.usefulLife}</td>
              <td>{row.table}</td>
            </tr>
          ))}
        </RulesTable>
      </details>
    </Card>
  );
}

function RulesNotice({ preview }: { preview: DepreciationPreview }) {
  const { t } = useLocale();
  const { rules } = preview;
  if (rules.verifiedOn) return null;
  if (rules.usable)
    return (
      <div className="ui-notice ui-notice-warning" data-testid="depreciation-rules-confirmed">
        <p>
          {t({
            ja: `償却の規則（${rules.id}）は一次資料と未照合です。会社の照合記録（${rules.confirmedOn ?? ''}）に基づいて転記します。`,
            en: `The depreciation rules (${rules.id}) are not verified against the primary sources; postings rely on the company confirmation of ${rules.confirmedOn ?? ''}.`,
          })}
        </p>
      </div>
    );
  return (
    <div className="ui-notice ui-notice-danger" data-testid="depreciation-rules-unverified">
      <p>
        {t({
          ja: `償却の規則（${rules.id}）が一次資料と未照合で、会社の照合記録もありません。試算は表示しますが、実行（仕訳の作成）はできません。下の「償却の規則を見る」の値（償却率表と適用する取得日、備忘価額、償却方法の制限、円未満の切捨て）を耐用年数省令の別表第八・第十と法人税法施行令で確かめ、設定「償却率表の照合記録」に規則集合の id と照合日を記録してください。`,
          en: `The depreciation rules (${rules.id}) are not verified against the primary sources and the company has no confirmation. The preview is shown but the run (posting) is blocked. Check the values under “Show the depreciation rules” below (rate tables and their acquisition dates, memorandum values, method restrictions, rounding down to the yen) against the Useful Life Ordinance (耐用年数省令), Appended Tables 8 and 10, and the Corporation Tax Act Order, then record the rule set id and the date in the setting “Depreciation rate table confirmation”.`,
        })}
      </p>
      <p className="mt-1">
        <Link to={RULES_SETTING_LINK.to} search={RULES_SETTING_LINK.search} className="ui-link">
          {t({ ja: '設定を開く（会計）', en: 'Open the settings (Accounting)' })}
        </Link>
      </p>
    </div>
  );
}

function PreviewTable({ preview, busy }: { preview: DepreciationPreview; busy: boolean }) {
  const { t, locale } = useLocale();
  if (preview.lines.length === 0)
    return (
      <p className="text-sm text-text-secondary" data-testid="depreciation-nothing">
        {t({ ja: 'この期間に計上する償却はありません。', en: 'There is no depreciation to book for this period.' })}
      </p>
    );
  return (
    <DataTableShell
      columnCount={7}
      label={t({ ja: '計上予定の償却', en: 'Depreciation to book' })}
      testId="depreciation-preview"
      busy={busy}
      head={
        <tr>
          <th scope="col">{t({ ja: '資産', en: 'Asset' })}</th>
          <th scope="col">{t({ ja: '償却方法', en: 'Method' })}</th>
          <th scope="col" className={cellAlignClass('right')}>
            {t({ ja: '期首帳簿価額', en: 'Opening book value' })}
          </th>
          <th scope="col" className={cellAlignClass('right')}>
            {t({ ja: '年額', en: 'Annual amount' })}
          </th>
          <th scope="col" className={cellAlignClass('right')}>
            {t({ ja: '年度の計上済み', en: 'Booked this year' })}
          </th>
          <th scope="col" className={cellAlignClass('right')}>
            {t({ ja: '今回の額', en: 'This run' })}
          </th>
          <th scope="col">{t({ ja: '科目（償却費 / 累計額）', en: 'Accounts (expense / accumulated)' })}</th>
        </tr>
      }
    >
      {preview.lines.map((line) => (
        <tr key={line.assetId} data-testid="depreciation-line">
          <td>
            <Link to="/e/$entity/$id" params={{ entity: 'fixed_asset', id: line.assetId }} className="ui-link">
              {line.code}
            </Link>{' '}
            <span className="text-text-secondary">{line.name}</span>
          </td>
          <td>{methodText(line, locale)}</td>
          <td className={cellAlignClass('right')}>{yen(line.openingBookValue)}</td>
          <td className={cellAlignClass('right')}>{yen(line.annualAmount)}</td>
          <td className={cellAlignClass('right')}>{yen(line.bookedInYear)}</td>
          <td className={cellAlignClass('right')} data-testid="depreciation-amount">
            {yen(line.amount)}
          </td>
          <td data-testid="depreciation-accounts">{accountsText(line)}</td>
        </tr>
      ))}
      <tr>
        <th scope="row" colSpan={5}>
          {t({ ja: '合計', en: 'Total' })}
        </th>
        <td className={cellAlignClass('right')} data-testid="depreciation-total">
          {yen(preview.total)}
        </td>
        <td />
      </tr>
    </DataTableShell>
  );
}

function DepreciationRun({ meta }: { meta: AppMeta }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/finance/depreciation' });
  const preview = useDepreciationPreview(search.periodId, true);
  const periods = useClosePeriods(true);
  const command = useFinanceCommand<RunResult>();
  const [confirm, setConfirm] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [failure, setFailure] = useState('');
  // After a run the opener is disabled (nothing left to book): focus moves to the period heading once the preview is
  // taken again (docs/conventions/ui.md, like the close guide).
  const [focusStatus, setFocusStatus] = useState(false);
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const pickerId = useId();
  const data = preview.data;
  const mayRun = meta.actions.some((action) => action.name === RUN_ACTION);
  const mayOpenYear = meta.actions.some((action) => action.name === OPEN_FISCAL_YEAR_ACTION);
  const errorReason = preview.isError && isApiError(preview.error) ? preview.error.details?.reason : undefined;
  const noPeriods = !data && noFiscalPeriods(periods.data, errorReason);
  // A failed refresh keeps the previous preview on screen: it must not look current or allow a run.
  const stale = preview.isError && data !== undefined;

  // AC-32: pin the server's default period in the URL (replace: no extra history entry).
  useEffect(() => {
    if (search.periodId || !data?.defaulted) return;
    void navigate({ to: '/finance/depreciation', search: { periodId: data.period.id }, replace: true });
  }, [search.periodId, data, navigate]);

  useEffect(() => {
    setAnnouncement('');
    setFailure('');
  }, [search.periodId]);

  useEffect(() => {
    if (!focusStatus || preview.isFetching) return;
    statusHeading.current?.focus();
    setFocusStatus(false);
  }, [focusStatus, preview.isFetching]);

  const previewAgain = () => {
    void preview.refetch().then((result) => {
      if (result.isSuccess) setFailure('');
    });
  };

  const run = () => {
    if (!data || command.isPending) return;
    setFailure('');
    command.mutate(
      { action: RUN_ACTION, input: { periodId: data.period.id } },
      {
        onSuccess: (result) => {
          setConfirm(false);
          setFocusStatus(true);
          setAnnouncement(runAnnouncement(result, data.period.code, locale));
        },
        onError: (error) => {
          setConfirm(false);
          setFailure(isApiError(error) ? `${error.message}${error.hint ? ` — ${error.hint}` : ''}` : String(error));
        },
      },
    );
  };

  const options: ClosePeriod[] = periods.data ?? (data ? [{ ...data.period }] : []);
  const value = search.periodId ?? data?.period.id ?? '';
  const known = options.some((period) => period.id === value);
  const blockers = data ? runBlockers(data) : [];
  const runnable = data ? canRun(data) : false;
  return (
    <div className="workspace-page" data-testid="depreciation-page">
      <PageHeader
        eyebrow="DEPRECIATION"
        title={t(TITLE)}
        titleTestId="depreciation-title"
        subtitle={t({
          ja: '会計期間を選んで減価償却を試算し、確認してから仕訳を 1 本作ります。同じ期間を 2 回実行しても二重に計上しません。',
          en: 'Pick a fiscal period, preview the depreciation, then book it as one journal entry. Running a period twice never books twice.',
        })}
        icon={
          <span className="icon-tile">
            <Icon name="chart" />
          </span>
        }
        actions={
          <Button onClick={previewAgain} disabled={command.isPending || noPeriods} aria-busy={preview.isFetching}>
            {t({ ja: '再試算', en: 'Preview again' })}
          </Button>
        }
      />
      <p className="sr-only" aria-live="polite" data-testid="depreciation-announcement">
        {announcement}
      </p>
      <div className="flex flex-col gap-4">
        {noPeriods ? (
          <Card>
            <EmptyState
              titleAs="h2"
              testId="depreciation-no-periods"
              title={t({ ja: '会計年度がまだありません', en: 'No fiscal year yet' })}
              description={t({
                ja: '会計年度を開くと、その月ごとの会計期間ができ、この画面で償却を試算・実行できるようになります。',
                en: 'Open a fiscal year to create its monthly periods; depreciation can then be previewed and run here.',
              })}
              action={
                mayOpenYear ? (
                  <Link to="/a/$action" params={{ action: OPEN_FISCAL_YEAR_ACTION }} className={buttonClass('primary')}>
                    {t({ ja: '会計年度を開く', en: 'Open a fiscal year' })}
                  </Link>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <Card>
            <FormSection
              title={t({ ja: '会計期間', en: 'Fiscal period' })}
              description={t({
                ja: '最初は、今日より前に終わった最後の期間を選んでいます。同じ年度の未実行の月は、後の月でまとめて計上されます。',
                en: 'Starts at the last period that ended before today. Months skipped in the same year are caught up by a later month.',
              })}
            >
              <div className="flex flex-col gap-1">
                <label htmlFor={pickerId} className="text-sm font-semibold text-text-secondary">
                  {t({ ja: '会計期間', en: 'Fiscal period' })}
                </label>
                <select
                  id={pickerId}
                  className="input w-full sm:max-w-md"
                  value={value}
                  disabled={command.isPending || options.length === 0}
                  onChange={(event) =>
                    void navigate({ to: '/finance/depreciation', search: { periodId: event.target.value } })
                  }
                >
                  {known ? null : (
                    <option value={value}>{periods.isPending || preview.isPending ? t(S.loading) : '—'}</option>
                  )}
                  {options.map((period) => (
                    <option key={period.id} value={period.id}>
                      {periodOption(period, locale)}
                    </option>
                  ))}
                </select>
              </div>
            </FormSection>
          </Card>
        )}
        {noPeriods ? null : preview.isError && !data ? (
          <MetaError error={preview.error} retry={previewAgain} />
        ) : !data ? (
          <>
            <p className="sr-only" aria-live="polite">
              {t(S.loading)}
            </p>
            <div aria-busy="true" className="flex flex-col gap-4">
              <SkeletonCard lines={4} />
            </div>
          </>
        ) : (
          <>
            {stale ? (
              <div role="alert" className="ui-notice ui-notice-danger" data-testid="depreciation-stale">
                <p>
                  {t({
                    ja: '最新の試算に失敗しました。表示は前回の結果です。実行するには試算をやり直してください。',
                    en: 'The latest preview failed; this is the previous result. Preview again before running.',
                  })}
                </p>
                <Button size="sm" className="mt-2" onClick={previewAgain} disabled={command.isPending}>
                  {t({ ja: '試算をやり直す', en: 'Retry the preview' })}
                </Button>
              </div>
            ) : null}
            {failure ? (
              <div role="alert" className="ui-notice ui-notice-danger" data-testid="depreciation-error">
                <p>{failure}</p>
              </div>
            ) : null}
            <RulesNotice preview={data} />
            {data.priorYearPending ? (
              <div className="ui-notice ui-notice-warning" data-testid="depreciation-prior-year">
                <p>
                  {t({
                    ja: `前の会計年度に未計上の償却があります（${data.priorYearPending.count} 件、${yen(data.priorYearPending.total)} 円）。年度を締める前に、その年度の最終期間で実行してください。`,
                    en: `The previous fiscal year has unbooked depreciation (${data.priorYearPending.count} assets, ${yen(data.priorYearPending.total)} yen). Run its last period before closing that year.`,
                  })}{' '}
                  <Link
                    to="/finance/depreciation"
                    search={{ periodId: data.priorYearPending.periodId }}
                    className="ui-link"
                  >
                    {t({ ja: '最終期間を開く', en: 'Open the last period' })}
                  </Link>
                </p>
              </div>
            ) : null}
            <Card data-testid="depreciation-status">
              <div className="flex flex-col gap-3 p-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    ref={statusHeading}
                    tabIndex={-1}
                    className="text-lg font-bold text-text-heading"
                    data-testid="depreciation-period-heading"
                  >
                    {data.period.code}
                  </h2>
                  {data.period.isClosed ? (
                    <Badge tone="neutral">{t({ ja: '締め済み', en: 'Closed' })}</Badge>
                  ) : data.period.isFuture ? (
                    <Badge tone="warning">{t({ ja: '未来の期間', en: 'Future period' })}</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-text-secondary">
                  {periodRange(data.period, locale)} · {data.fiscalYear.code}
                </p>
                {blockers.length ? (
                  <ul className="flex flex-col gap-1 text-sm text-danger-text" data-testid="depreciation-blockers">
                    {blockers.map((b) => (
                      <li key={b}>{t(BLOCKER_LABEL[b])}</li>
                    ))}
                  </ul>
                ) : null}
                <PreviewTable preview={data} busy={preview.isFetching} />
                {data.skipped.opening_required ? (
                  <p className="ui-notice ui-notice-warning text-sm" data-testid="depreciation-opening-required">
                    {t({
                      ja: `事業供用が最初の会計年度より前で、移行時の値が無い資産が ${data.skipped.opening_required} 件あります。償却しないので、台帳で移行日と移行時の償却累計を入れてください。`,
                      en: `${data.skipped.opening_required} assets went into service before the first fiscal year and have no opening values. They are not depreciated; enter the opening date and the opening accumulated depreciation in the register.`,
                    })}
                  </p>
                ) : null}
                {skippedText(data.skipped, locale) ? (
                  <p className="text-xs text-text-secondary" data-testid="depreciation-skipped">
                    {t({ ja: '計上しない資産: ', en: 'Not booked: ' })}
                    {skippedText(data.skipped, locale)}
                  </p>
                ) : null}
                {mayRun ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="primary"
                      onClick={() => setConfirm(true)}
                      disabled={!runnable || stale || command.isPending || preview.isFetching}
                      data-testid="depreciation-run"
                    >
                      {t({ ja: '償却を実行', en: 'Run depreciation' })}
                    </Button>
                    {data.lines.length ? <span className="text-sm">{totalText(data, locale)}</span> : null}
                  </div>
                ) : null}
              </div>
            </Card>
            <Card>
              <FormSection
                landmark
                title={t({ ja: 'この期間の実行', en: 'Runs of this period' })}
                description={t({
                  ja: '確定済みの実行と仕訳です。取り消すときは実行の画面から、新しい順に取り消します。',
                  en: 'Submitted runs and their entries. Cancel them from the run record, newest first.',
                })}
              >
                {data.runs.length ? (
                  <ul className="flex flex-col" data-testid="depreciation-runs">
                    {data.runs.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-b-0"
                      >
                        <Link to="/e/$entity/$id" params={{ entity: 'depreciation_run', id: r.id }} className="ui-link">
                          {r.number ?? r.id}
                        </Link>
                        <span className="text-sm">
                          {t({
                            ja: `${r.assetCount} 件 ${yen(r.totalAmount)} 円`,
                            en: `${r.assetCount} assets ${yen(r.totalAmount)} yen`,
                          })}
                        </span>
                        {r.journalEntryId ? (
                          <Link
                            to="/e/$entity/$id"
                            params={{ entity: 'journal_entry', id: r.journalEntryId }}
                            className="ui-link"
                            data-testid="depreciation-entry-link"
                          >
                            {t({ ja: '仕訳 ', en: 'Entry ' })}
                            {r.journalEntryNumber ?? r.journalEntryId}
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-text-secondary">
                    {t({ ja: 'まだ実行していません。', en: 'Not run yet.' })}
                  </p>
                )}
              </FormSection>
            </Card>
            <RulesDetails meta={meta} />
          </>
        )}
      </div>
      {confirm && data ? (
        <Dialog
          title={t({ ja: `${data.period.code} の償却を実行しますか`, en: `Run depreciation for ${data.period.code}?` })}
          description={t({
            ja: `${totalText(data, locale)}を、${data.period.endDate} の日付の仕訳 1 本で計上します。取り消すと逆仕訳になります。`,
            en: `${totalText(data, locale)} will be booked as one journal entry dated ${data.period.endDate}. Cancelling posts a reversal.`,
          })}
          closeLabel={t(S.close)}
          onClose={() => {
            if (!command.isPending) setConfirm(false);
          }}
          icon={
            <span className="icon-tile">
              <Icon name="check" />
            </span>
          }
          actions={
            <>
              <Button onClick={() => setConfirm(false)} disabled={command.isPending} data-autofocus>
                {t({ ja: '戻る', en: 'Go back' })}
              </Button>
              <Button variant="primary" onClick={run} disabled={command.isPending} data-testid="depreciation-confirm">
                {t({ ja: '実行する', en: 'Run' })}
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  );
}
