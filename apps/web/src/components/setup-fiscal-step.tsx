// The fiscal-year step of the setup wizard (docs/specs/setup-wizard.md AC-3, AC-24): the existing years (read with the
// caller's own permission through GET /api/fiscal_year), the year-end month from company.profile and the
// accounting.fiscal_period check decide what is shown or proposed (lib/setup-wizard.ts proposeFiscalYear). Creating is
// the existing action accounting.open_fiscal_year; the server's overlap check (CONFLICT) stays the final guard.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { isApiError, request } from '../api/client.ts';
import type { ListResponse } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { describeError } from '../lib/error-view.ts';
import {
  fiscalYearEndMonth,
  proposeFiscalYear,
  tokyoDate,
  type FiscalProposal,
  type FiscalYearRow,
} from '../lib/setup-wizard.ts';
import { Button, SkeletonCard } from '../ui/index.ts';
import { effectiveValue, settingOf, SetupChecks, SetupSaveError, type SetupStepProps } from './setup-shared.tsx';

export const fiscalYearsKey = ['setup', 'fiscal-years'] as const;

function rowsOf(list: ListResponse): FiscalYearRow[] {
  return list.items.flatMap((row) =>
    typeof row.code === 'string' && typeof row.startDate === 'string' && typeof row.endDate === 'string'
      ? [{ id: String(row.id), code: row.code, startDate: row.startDate, endDate: row.endDate }]
      : [],
  );
}

function YearText({ year }: { year: FiscalYearRow }) {
  return (
    <span className="font-mono">
      {year.code}（{year.startDate} – {year.endDate}）
    </span>
  );
}

function ProposalView({
  proposal,
  busy,
  onCreate,
}: {
  proposal: FiscalProposal;
  busy: boolean;
  onCreate: (startDate: string) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3" data-testid="setup-fiscal-proposal">
      <p className="text-sm">
        {t({ ja: '提案する年度: ', en: 'Proposed fiscal year: ' })}
        <strong className="font-mono" data-testid="setup-fiscal-proposal-range">
          {proposal.startDate} – {proposal.endDate}
        </strong>
        {proposal.continuation ? t({ ja: '（前の年度の続き）', en: ' (continues the previous year)' }) : null}
      </p>
      {proposal.mismatch ? (
        <p className="text-xs text-text-secondary" data-testid="setup-fiscal-proposal-mismatch">
          {t({
            ja: '提案の開始月は決算月の翌月と違います（既存の年度に続けるため）。既存の年度は変更・削除しません。',
            en: 'The proposed start month is not the month after the year-end month (it continues the existing years). Existing years are not changed or deleted.',
          })}
        </p>
      ) : null}
      {proposal.gap ? (
        <p className="ui-notice ui-notice-warning text-xs" data-testid="setup-fiscal-gap">
          {t({
            ja: `${proposal.gap.from}〜${proposal.gap.to} は会計年度に含まれず、その日付の伝票は確定できません。`,
            en: `${proposal.gap.from} to ${proposal.gap.to} is in no fiscal year; documents dated then cannot be submitted.`,
          })}
        </p>
      ) : null}
      {proposal.overlap ? (
        <p className="ui-notice ui-notice-warning text-sm" data-testid="setup-fiscal-overlap">
          {t({
            ja: '既存の年度と重なるため作成できません: ',
            en: 'This would overlap an existing year, so it cannot be created: ',
          })}
          <YearText year={proposal.overlap} />
        </p>
      ) : (
        <div>
          <Button
            variant="primary"
            onClick={() => onCreate(proposal.startDate)}
            disabled={busy}
            aria-busy={busy || undefined}
            data-testid="setup-fiscal-create"
          >
            {busy ? t({ ja: '作成中…', en: 'Creating…' }) : t({ ja: 'この年度を作成', en: 'Create this fiscal year' })}
          </Button>
        </div>
      )}
    </div>
  );
}

export function FiscalYearStep(props: SetupStepProps) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const years = useQuery({
    queryKey: fiscalYearsKey,
    queryFn: ({ signal }) =>
      request<ListResponse>('/api/fiscal_year?orderBy=startDate:asc&limit=200&offset=0', { signal }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const create = useMutation({
    mutationFn: (startDate: string) =>
      request('/actions/accounting.open_fiscal_year', { method: 'POST', body: { startDate } }),
  });
  const endMonth = fiscalYearEndMonth(effectiveValue(settingOf(props.settings, 'company.profile')));
  const check = props.step.checks.find((c) => c.id === 'accounting.fiscal_period');
  const today = tokyoDate(props.status.checkedAt);
  const onCreate = (startDate: string) => {
    if (create.isPending) return;
    props.onBusy(true);
    create.mutate(startDate, {
      onSuccess: () =>
        props.announce(
          t({ ja: `会計年度（${startDate}〜）を作成しました。`, en: `Created the fiscal year from ${startDate}.` }),
        ),
      onSettled: async () => {
        props.onBusy(false);
        await qc.invalidateQueries({ queryKey: fiscalYearsKey });
        await props.refresh();
      },
    });
  };
  const conflict = create.isError && isApiError(create.error) && create.error.code === 'CONFLICT';
  return (
    <div className="flex flex-col gap-3">
      <SetupChecks checks={props.step.checks} />
      <p className="text-sm text-text-secondary" data-testid="setup-fiscal-end-month">
        {endMonth
          ? t({ ja: `決算月: ${endMonth} 月`, en: `Fiscal year-end month: ${endMonth}` })
          : t({
              ja: '決算月は未設定です（12 月決算＝暦年として提案します）。',
              en: 'The year-end month is not set (the proposal assumes December, a calendar year).',
            })}{' '}
        <Link to="/setup" search={{ step: 'company_profile' }} className="ui-link">
          {t({ ja: '会社情報で変更', en: 'Change in Company profile' })}
        </Link>
      </p>
      {years.isError ? (
        <SetupSaveError view={describeError(years.error)} testId="setup-fiscal-load-error" />
      ) : !years.data ? (
        <div aria-busy="true">
          <SkeletonCard lines={2} />
        </div>
      ) : (
        <FiscalPlanView
          years={rowsOf(years.data)}
          today={today}
          endMonth={endMonth}
          check={check?.status}
          busy={create.isPending}
          onCreate={onCreate}
        />
      )}
      {create.isError ? (
        conflict ? (
          <div role="alert" className="ui-notice ui-notice-danger text-sm" data-testid="setup-fiscal-conflict">
            {t({
              ja: '既存の会計年度と重なるため作成しませんでした。一覧で重なる年度を確認してください。',
              en: 'Not created: it overlaps an existing fiscal year. Check the overlapping year in the list.',
            })}{' '}
            <Link to="/e/$entity" params={{ entity: 'fiscal_year' }} className="ui-link">
              {t({ ja: '会計年度の一覧', en: 'Fiscal years' })}
            </Link>
          </div>
        ) : (
          <SetupSaveError view={describeError(create.error)} />
        )
      ) : null}
    </div>
  );
}

function FiscalPlanView({
  years,
  today,
  endMonth,
  check,
  busy,
  onCreate,
}: {
  years: FiscalYearRow[];
  today: string;
  endMonth: number | undefined;
  check: 'ok' | 'warn' | 'fail' | undefined;
  busy: boolean;
  onCreate: (startDate: string) => void;
}) {
  const { t } = useLocale();
  const plan = proposeFiscalYear({ today, endMonth, years, check });
  if (plan.kind === 'blocked')
    return (
      <p className="ui-notice ui-notice-warning text-sm" data-testid="setup-fiscal-blocked">
        {t({
          ja: '今日を含む年度はありますが、今日の会計期間が使えません（締め済み、または期間がありません）。上の点検の詳細とリンク先で直してください。新しい年度は提案しません: ',
          en: 'A fiscal year contains today, but today’s period cannot be used (closed, or the year has no periods). Fix it from the check above. No new year is proposed: ',
        })}
        <YearText year={plan.current} />
      </p>
    );
  if (plan.kind === 'propose') return <ProposalView proposal={plan.proposal} busy={busy} onCreate={onCreate} />;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm" data-testid="setup-fiscal-current">
        {t({ ja: '今日を含む会計年度: ', en: 'Fiscal year containing today: ' })}
        <YearText year={plan.current} />
      </p>
      {plan.mismatch ? (
        <p className="text-xs text-text-secondary" data-testid="setup-fiscal-mismatch">
          {t({
            ja: 'この年度の開始月は決算月の翌月と違います。既存の年度は変更・削除しません（新しい会社には暦年の年度が初めから作られます）。次の年度から決算月に揃えるには、年度の作成時に開始日を選びます。',
            en: 'This year does not start the month after the year-end month. Existing years are not changed or deleted (a new company starts with a calendar-year fiscal year). To align later years, choose the start date when you create them.',
          })}
        </p>
      ) : null}
      {plan.proposal ? (
        <>
          <p className="text-sm text-text-secondary">
            {t({
              ja: '30 日以内に会計期間が尽きます。翌年度を作成してください。',
              en: 'The fiscal periods run out within 30 days. Create the next fiscal year.',
            })}
          </p>
          <ProposalView proposal={plan.proposal} busy={busy} onCreate={onCreate} />
        </>
      ) : null}
    </div>
  );
}
