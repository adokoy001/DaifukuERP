// /setup (docs/specs/setup-wizard.md AC-1..AC-10, AC-15, AC-24..AC-26), built with the UI kit: the nine setup steps of
// the current company, each judged from real data by GET /meta/setup-status. Every save goes through an existing
// endpoint (settings PUT, actions, /admin/users...), so their permission checks apply; the wizard's own record is the
// ordinary PUT /meta/settings/setup.progress (merged into the stored value, AC-15). Company admins only (AC-8).
import { useBlocker, useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type JSX, type RefObject } from 'react';
import { isApiError } from '../api/client.ts';
import { useMeta } from '../api/queries.ts';
import { useSaveSetting, useSettings } from '../api/settings.ts';
import { useSetupStatus } from '../api/setup.ts';
import type { AppMeta } from '../api/types.ts';
import { ErrorDetails } from '../components/error-details.tsx';
import { Icon } from '../components/icon.tsx';
import { FiscalYearStep } from '../components/setup-fiscal-step.tsx';
import { IndustryTemplateStep, UsersStep, WorkforceStep } from '../components/setup-people-steps.tsx';
import {
  ChartOfAccountsStep,
  CompanyProfileStep,
  InventoryStep,
  InvoiceIssuerStep,
  TaxStep,
} from '../components/setup-setting-steps.tsx';
import { SetupSaveError, type SetupStepProps } from '../components/setup-shared.tsx';
import { SetupStepper } from '../components/setup-stepper.tsx';
import { useLocale } from '../i18n.tsx';
import { describeError, type ErrorView } from '../lib/error-view.ts';
import { formatTimestamp } from '../lib/format.ts';
import {
  buildProgress,
  canConfirm,
  canSkip,
  canUndoSkip,
  initialStep,
  isAdminRoles,
  neighbourStep,
  OPTIONAL_TEXT,
  parseSetupSearch,
  progressText,
  SKIP_REASON_MAX,
  skipReasonError,
  STEP_STATUS_TEXT,
  STEP_STATUS_TONE,
  type ProgressChange,
  type SetupStep,
  type SetupStepId,
} from '../lib/setup-wizard.ts';
import { S } from '../strings.ts';
import { Badge, Button, Card, EmptyState, FormSection, PageHeader } from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const SETUP_PROGRESS_KEY = 'setup.progress';
const DISCARD = { ja: '未保存の変更があります。破棄して移動しますか？', en: 'Discard your unsaved changes and leave?' };
const STEP_VIEWS: Record<SetupStepId, (props: SetupStepProps) => JSX.Element> = {
  company_profile: CompanyProfileStep,
  fiscal_year: FiscalYearStep,
  chart_of_accounts: ChartOfAccountsStep,
  tax: TaxStep,
  invoice_issuer: InvoiceIssuerStep,
  inventory: InventoryStep,
  industry_template: IndustryTemplateStep,
  users: UsersStep,
  workforce: WorkforceStep,
};

function Forbidden() {
  const { t } = useLocale();
  return (
    <div className="workspace-page">
      <EmptyState
        titleAs="h1"
        testId="setup-forbidden"
        title={t({ ja: 'セットアップは会社の管理者だけが使えます', en: 'Only company administrators can use Setup' })}
        description={t({
          ja: '会社の管理者（admin）の役割と、店舗・拠点に限定されない会社全体への所属が必要です。必要なら管理者に依頼してください。',
          en: 'The admin role with company-wide access (not limited to stores or sites) is required. Ask your administrator if you need it.',
        })}
      />
    </div>
  );
}

/** AC-6/AC-26: the reason form under "Skip"; nothing is sent while the reason is empty or too long. */
function SkipForm({
  busy,
  onSubmit,
  onCancel,
  onDirty,
}: {
  busy: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => {
    onDirty(reason.trim() !== '');
    return () => onDirty(false);
  }, [reason, onDirty]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = skipReasonError(reason);
    if (problem) {
      setError(t(problem));
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    onSubmit(reason);
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2" data-testid="setup-skip-form">
      <label htmlFor={`${id}-reason`} className="text-sm font-medium text-text">
        {t({ ja: 'スキップする理由（必須、200 文字まで）', en: 'Why skip this step (required, up to 200 characters)' })}
      </label>
      <textarea
        id={`${id}-reason`}
        className={`input ${error ? 'input-error' : ''}`}
        rows={2}
        value={reason}
        maxLength={SKIP_REASON_MAX + 50}
        aria-invalid={error !== undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        disabled={busy}
        onChange={(event) => {
          setReason(event.target.value);
          setError(undefined);
        }}
        data-testid="setup-skip-reason"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="ui-field-error" data-testid="setup-skip-error">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy} data-testid="setup-skip-submit">
          {t({ ja: 'スキップを記録', en: 'Record the skip' })}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          {t({ ja: 'やめる', en: 'Cancel' })}
        </Button>
      </div>
    </form>
  );
}

function StepHeading({ step, headingRef }: { step: SetupStep; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const { t, locale } = useLocale();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-semibold text-text outline-none"
          data-testid="setup-step-heading"
        >
          {step.order}. {t(step.label)}
        </h2>
        <Badge tone={STEP_STATUS_TONE[step.status]} data-testid="setup-step-status">
          {t(STEP_STATUS_TEXT[step.status])}
        </Badge>
        {step.optional ? <Badge tone="neutral">{t(OPTIONAL_TEXT)}</Badge> : null}
      </div>
      {step.reason ? (
        <p className="text-sm text-text-secondary" data-testid="setup-step-reason">
          {t({ ja: 'スキップの理由: ', en: 'Reason for skipping: ' })}
          {step.reason}
          {step.skippedAt ? ` (${formatTimestamp(step.skippedAt, locale)})` : null}
        </p>
      ) : null}
      {step.regressed ? (
        <p className="ui-notice ui-notice-warning text-sm" data-testid="setup-step-regressed">
          {t({
            ja: '以前は完了していましたが、条件を満たさなくなりました。',
            en: 'This step was done before, but its conditions no longer hold.',
          })}
        </p>
      ) : null}
      {step.completedAt && !step.regressed ? (
        <p className="text-xs text-text-muted">
          {t({ ja: '確認日時: ', en: 'Confirmed at: ' })}
          {formatTimestamp(step.completedAt, locale)}
        </p>
      ) : null}
    </div>
  );
}

function SetupView({ meta }: { meta: AppMeta }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const search = parseSetupSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const status = useSetupStatus(true);
  const settings = useSettings(true);
  const saveSetting = useSaveSetting();
  const [dirty, setDirty] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [skipDirty, setSkipDirty] = useState(false);
  const [recordError, setRecordError] = useState<ErrorView>();
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Read by the blocker at navigation time: a record write that has just finished must not block the "next" it opens.
  const recording = useRef(false);
  const busy = stepBusy || recordBusy;
  const unsaved = dirty || skipDirty;
  useBlocker({
    shouldBlockFn: () => stepBusy || recording.current || (unsaved && !globalThis.confirm(t(DISCARD))),
    enableBeforeUnload: busy || unsaved,
  });
  const { refetch } = status;
  const refresh = useCallback(() => refetch(), [refetch]);
  const announce = useCallback((text: string) => {
    setAnnouncement('');
    globalThis.setTimeout(() => setAnnouncement(text), 30);
  }, []);
  const data = status.data;
  const current = initialStep(data, search.step);
  // AC-10: opening another step moves focus to its heading (not on the first render, which keeps the page's focus).
  const previous = useRef<SetupStepId | undefined>(undefined);
  useEffect(() => {
    if (previous.current !== undefined && previous.current !== current) headingRef.current?.focus();
    previous.current = current;
    setSkipping(false);
    setRecordError(undefined);
  }, [current]);
  const open = useCallback(
    (id: SetupStepId) => void navigate({ to: '/setup', search: { step: id }, replace: true }),
    [navigate],
  );
  const refused = status.isError && isApiError(status.error) && status.error.status === 403;
  if (refused) return <Forbidden />;
  if (status.isError && !data) return <MetaError error={status.error} retry={() => void status.refetch()} />;
  if (!data || !settings.data) {
    if (settings.isError) return <MetaError error={settings.error} retry={() => void settings.refetch()} />;
    return <LoadingView />;
  }
  const step = data.steps.find((s) => s.id === current) ?? data.steps[0];
  if (!step) return <EmptyState title={t({ ja: '段階がありません', en: 'No steps' })} />;
  const prev = neighbourStep(data.steps, step.id, -1);
  const next = neighbourStep(data.steps, step.id, 1);
  const StepView = STEP_VIEWS[step.id];

  /** AC-15: re-read the status, merge the change into the stored record, PUT it, re-read again. */
  const record = async (change: ProgressChange, done: string): Promise<boolean> => {
    if (recording.current) return false;
    recording.current = true;
    setRecordBusy(true);
    setRecordError(undefined);
    try {
      const latest = await status.refetch();
      if (!latest.data || latest.isError) throw latest.error ?? new Error('setup status unavailable');
      await saveSetting.mutateAsync({
        key: SETUP_PROGRESS_KEY,
        value: buildProgress(latest.data.progress, change, new Date()),
      });
      announce(done);
      return true;
    } catch (error) {
      setRecordError(describeError(error));
      return false;
    } finally {
      recording.current = false;
      setRecordBusy(false);
      await status.refetch();
    }
  };
  const confirmAndNext = async () => {
    const ok = await record(
      { step: step.id, record: 'completed' },
      t({ ja: '確認を記録しました。', en: 'Confirmation recorded.' }),
    );
    if (ok && next) open(next);
  };
  const skip = async (reason: string) => {
    const ok = await record(
      { step: step.id, record: 'skipped', reason },
      t({ ja: `${t(step.label)}をスキップしました。`, en: `Skipped ${t(step.label)}.` }),
    );
    if (ok) setSkipping(false);
  };
  const undoSkip = () =>
    void record({ step: step.id, record: null }, t({ ja: 'スキップを取り消しました。', en: 'Skip undone.' }));
  const recheck = () => {
    if (status.isFetching) return;
    void status.refetch().then((result) => {
      announce(
        result.isError
          ? t({
              ja: '再点検できませんでした。前回の結果を表示しています。',
              en: 'Could not check again; showing the previous result.',
            })
          : result.data
            ? t(progressText(result.data.summary))
            : '',
      );
    });
  };
  const staleFailure = status.isError ? describeError(status.error) : null;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="setup-page">
      <PageHeader
        eyebrow="SETUP"
        title={t({ ja: 'セットアップ', en: 'Setup' })}
        subtitle={t({
          ja: '会社の初期設定を順に整えます。完了かどうかは保存の有無ではなく実際のデータで判定します。途中でやめても、次に開いたときに続きから進められます。',
          en: 'Set up the company step by step. Whether a step is done is judged from the actual data, not from saving. You can stop at any time and continue later.',
        })}
        icon={<Icon name="settings" size={24} />}
        actions={
          <Button onClick={recheck} aria-disabled={status.isFetching || undefined} data-testid="setup-recheck">
            {status.isFetching ? t({ ja: '点検中…', en: 'Checking…' }) : t({ ja: '再点検', en: 'Check again' })}
          </Button>
        }
      />
      <p className="sr-only" aria-live="polite" data-testid="setup-live">
        {announcement}
      </p>
      {staleFailure ? (
        <div role="alert" className="ui-notice ui-notice-danger flex flex-col gap-1" data-testid="setup-status-error">
          <p className="font-semibold">
            {t({
              ja: '最新の状態を取得できませんでした。前回の結果を表示しています（入力中の値は残っています）。',
              en: 'Could not load the latest status; showing the previous result (your inputs are kept).',
            })}
          </p>
          <p>{staleFailure.message}</p>
          <ErrorDetails view={staleFailure} />
          <div>
            <Button onClick={() => void status.refetch()} data-testid="setup-status-retry">
              {t({ ja: '再読込', en: 'Reload' })}
            </Button>
          </div>
        </div>
      ) : null}
      <p className="text-sm text-text-secondary" data-testid="setup-progress">
        {t(progressText(data.summary))}
        {t({ ja: ' ／ 点検日時 ', en: ' · Checked at ' })}
        {formatTimestamp(data.checkedAt, locale)}
      </p>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
        <Card className="min-w-0 self-start">
          <SetupStepper steps={data.steps} current={step.id} onOpen={open} />
        </Card>
        <Card className="min-w-0" data-testid="setup-step-panel" data-step={step.id}>
          <FormSection landmark title={<StepHeading step={step} headingRef={headingRef} />}>
            <StepView
              key={step.id}
              step={step}
              status={data}
              meta={meta}
              settings={settings.data}
              onDirty={setDirty}
              onBusy={setStepBusy}
              refresh={refresh}
              announce={announce}
            />
            {recordError ? <SetupSaveError view={recordError} testId="setup-record-error" /> : null}
            {skipping ? (
              <SkipForm
                busy={recordBusy}
                onSubmit={(reason) => void skip(reason)}
                onCancel={() => setSkipping(false)}
                onDirty={setSkipDirty}
              />
            ) : null}
            <div
              className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3"
              data-testid="setup-step-actions"
            >
              <Button onClick={() => prev && open(prev)} disabled={!prev || busy} data-testid="setup-prev">
                {t({ ja: '前へ', en: 'Previous' })}
              </Button>
              {canConfirm(step) ? (
                <Button
                  variant="primary"
                  onClick={() => void confirmAndNext()}
                  disabled={busy}
                  aria-busy={recordBusy || undefined}
                  data-testid="setup-confirm"
                >
                  {next ? t({ ja: '確認して次へ', en: 'Confirm and next' }) : t({ ja: '確認', en: 'Confirm' })}
                </Button>
              ) : null}
              {next ? (
                <Button
                  variant={canConfirm(step) ? 'ghost' : 'default'}
                  onClick={() => open(next)}
                  disabled={busy}
                  data-testid="setup-next"
                >
                  {t({ ja: '次へ', en: 'Next' })}
                </Button>
              ) : null}
              {canSkip(step) && !skipping ? (
                <Button variant="ghost" onClick={() => setSkipping(true)} disabled={busy} data-testid="setup-skip">
                  {t({ ja: 'スキップ…', en: 'Skip…' })}
                </Button>
              ) : null}
              {canUndoSkip(step) ? (
                <Button variant="ghost" onClick={undoSkip} disabled={busy} data-testid="setup-undo-skip">
                  {t({ ja: 'スキップを取り消す', en: 'Undo skip' })}
                </Button>
              ) : null}
            </div>
          </FormSection>
        </Card>
      </div>
      {status.isFetching ? <p className="sr-only">{t(S.loading)}</p> : null}
    </div>
  );
}

export function SetupPage() {
  const meta = useMeta();
  if (meta.isError && !meta.data) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  // AC-8: without the admin role the screen explains instead of asking the API (which would answer 403).
  if (!isAdminRoles(meta.data.roles)) return <Forbidden />;
  return (
    <div className="workspace-page">
      <SetupView meta={meta.data} />
    </div>
  );
}
