// /finance/depreciation — preview and run the depreciation of a fiscal period (docs/specs/fixed-assets.md AC-32..AC-34),
// built with the UI kit. Reads fixed_assets.preview_depreciation (no writes), runs fixed_assets.run_depreciation after a
// kit Dialog confirmation; everything else (register, disposals, reports) is the generic DSL screens.
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useClosePeriods } from '../api/close.ts';
import { isApiError, request } from '../api/client.ts';
import { useDepreciationPreview } from '../api/depreciation.ts';
import { financeIdentity, useFinanceCommand } from '../api/finance.ts';
import { useMeta } from '../api/queries.ts';
import type { AppMeta, Label } from '../api/types.ts';
import { Icon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import { periodOption, periodRange, type ClosePeriod } from '../lib/close-guide.ts';
import {
  BLOCKER_LABEL,
  canRun,
  methodText,
  PREVIEW_ACTION,
  RULES_ACTION,
  RULES_SETTING_HREF,
  RUN_ACTION,
  runAnnouncement,
  runBlockers,
  skippedText,
  totalText,
  yen,
  type DepreciationPreview,
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

interface RulesView {
  id: string;
  verifiedOn: string | null;
  sources: string[];
  rateTables: {
    method: string;
    source: string;
    rows: { usefulLife: number; rate: string; revisedRate: string | null; guaranteeRate: string | null }[];
  }[];
}

/** AC-32: the rule set behind the preview, so a person can compare it with the statutory tables before recording. */
function RulesDetails() {
  const { t } = useLocale();
  const rules = useQuery({
    queryKey: ['finance', financeIdentity(), 'depreciation-rules'],
    queryFn: ({ signal }) =>
      request<RulesView>(`/actions/${RULES_ACTION}`, { method: 'POST', body: {}, signal, cache: 'no-store' }),
    retry: false,
    gcTime: 0,
    networkMode: 'always',
  });
  if (!rules.data) return null;
  return (
    <details className="mt-2" data-testid="depreciation-rules">
      <summary className="cursor-pointer text-sm font-semibold">
        {t({ ja: `償却率表を見る（${rules.data.id}）`, en: `Show the rate tables (${rules.data.id})` })}
      </summary>
      <p className="mt-1 text-xs text-text-secondary">
        {t({ ja: '出典: ', en: 'Sources: ' })}
        {rules.data.sources.join(' / ')}
      </p>
      {rules.data.rateTables.map((table) => (
        <div key={table.method} className="mt-2">
          <p className="text-sm font-semibold">{table.source}</p>
          <DataTableShell
            columnCount={4}
            label={table.source}
            head={
              <tr>
                <th scope="col">{t({ ja: '耐用年数', en: 'Useful life' })}</th>
                <th scope="col" className={cellAlignClass('right')}>
                  {t({ ja: '償却率', en: 'Rate' })}
                </th>
                <th scope="col" className={cellAlignClass('right')}>
                  {t({ ja: '改定償却率', en: 'Revised rate' })}
                </th>
                <th scope="col" className={cellAlignClass('right')}>
                  {t({ ja: '保証率', en: 'Guarantee rate' })}
                </th>
              </tr>
            }
          >
            {table.rows.map((row) => (
              <tr key={row.usefulLife}>
                <td>{row.usefulLife}</td>
                <td className={cellAlignClass('right')}>{row.rate}</td>
                <td className={cellAlignClass('right')}>{row.revisedRate ?? '—'}</td>
                <td className={cellAlignClass('right')}>{row.guaranteeRate ?? '—'}</td>
              </tr>
            ))}
          </DataTableShell>
        </div>
      ))}
    </details>
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
            ja: `償却率表（${rules.id}）は一次資料と未照合です。会社の照合記録（${rules.confirmedOn ?? ''}）に基づいて転記します。`,
            en: `The rate tables (${rules.id}) are not verified against the primary sources; postings rely on the company confirmation of ${rules.confirmedOn ?? ''}.`,
          })}
        </p>
      </div>
    );
  return (
    <div className="ui-notice ui-notice-danger" data-testid="depreciation-rules-unverified">
      <p>
        {t({
          ja: `償却率表（${rules.id}）が一次資料と未照合で、会社の照合記録もありません。試算は表示しますが、実行（仕訳の作成）はできません。率表を耐用年数省令の別表第八・第十と照合し、設定「償却率表の照合記録」に規則集合の id と照合日を記録してください。`,
          en: `The rate tables (${rules.id}) are not verified against the primary sources and the company has no confirmation. The preview is shown but the run (posting) is blocked. Compare the tables with 耐用年数省令 別表第八・第十 and record the rule set id and the date in the setting “Depreciation rate table confirmation”.`,
        })}
      </p>
      <p className="mt-1">
        <a href={RULES_SETTING_HREF} className="ui-link">
          {t({ ja: '設定を開く（会計）', en: 'Open the settings (Accounting)' })}
        </a>
      </p>
      <RulesDetails />
    </div>
  );
}

function PreviewTable({ preview }: { preview: DepreciationPreview }) {
  const { t, locale } = useLocale();
  if (preview.lines.length === 0)
    return (
      <p className="text-sm text-text-secondary" data-testid="depreciation-nothing">
        {t({ ja: 'この期間に計上する償却はありません。', en: 'There is no depreciation to book for this period.' })}
      </p>
    );
  return (
    <DataTableShell
      columnCount={6}
      label={t({ ja: '計上予定の償却', en: 'Depreciation to book' })}
      testId="depreciation-preview"
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
        </tr>
      ))}
      <tr>
        <th scope="row" colSpan={5}>
          {t({ ja: '合計', en: 'Total' })}
        </th>
        <td className={cellAlignClass('right')} data-testid="depreciation-total">
          {yen(preview.total)}
        </td>
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
  const pickerId = useId();
  const data = preview.data;
  const mayRun = meta.actions.some((action) => action.name === RUN_ACTION);

  // AC-32: pin the server's default period in the URL (replace: no extra history entry).
  useEffect(() => {
    if (search.periodId || !data?.defaulted) return;
    void navigate({ to: '/finance/depreciation', search: { periodId: data.period.id }, replace: true });
  }, [search.periodId, data, navigate]);

  useEffect(() => {
    setAnnouncement('');
    setFailure('');
  }, [search.periodId]);

  const run = () => {
    if (!data || command.isPending) return;
    setFailure('');
    command.mutate(
      { action: RUN_ACTION, input: { periodId: data.period.id } },
      {
        onSuccess: (result) => {
          setConfirm(false);
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
          <Button onClick={() => void preview.refetch()} disabled={command.isPending} aria-busy={preview.isFetching}>
            {t({ ja: '再試算', en: 'Preview again' })}
          </Button>
        }
      />
      <p className="sr-only" aria-live="polite" data-testid="depreciation-announcement">
        {announcement}
      </p>
      <div className="flex flex-col gap-4">
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
                {known ? null : <option value={value}>{t(S.loading)}</option>}
                {options.map((period) => (
                  <option key={period.id} value={period.id}>
                    {periodOption(period, locale)}
                  </option>
                ))}
              </select>
            </div>
          </FormSection>
        </Card>
        {preview.isError && !data ? (
          <MetaError error={preview.error} retry={() => void preview.refetch()} />
        ) : !data ? (
          <div aria-busy="true" className="flex flex-col gap-4">
            <p className="sr-only" aria-live="polite">
              {t(S.loading)}
            </p>
            <SkeletonCard lines={4} />
          </div>
        ) : (
          <>
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
                  <h2 className="text-lg font-bold text-text-heading">{data.period.code}</h2>
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
                <PreviewTable preview={data} />
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
                      disabled={!runnable || command.isPending || preview.isFetching}
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
