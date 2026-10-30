// /finance/expenses — approved employee expenses waiting for an expense settlement (docs/specs/expense-settlement.md
// AC-20, D14), built with the UI kit. It reads expense.settlement_candidates (employee x payment method x site) and,
// per group, calls expense.draft_settlement and opens the new draft on the generic settlement screen, where lines are
// edited, submitted, cancelled and amended. No other read or write path.
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useDraftSettlement, useExpenseCandidates } from '../api/expense.ts';
import { financeIdentity } from '../api/finance.ts';
import { useMeta } from '../api/queries.ts';
import type { Label } from '../api/types.ts';
import { ErrorDetails } from '../components/error-details.tsx';
import { Icon } from '../components/icon.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import { describeError } from '../lib/error-view.ts';
import {
  advanceBlock,
  advancesOf,
  ADVANCE_ENTITY,
  CANDIDATES_ACTION,
  cappedNote,
  DRAFT_ACTION,
  draftedOnly,
  draftFailureKind,
  groupBlock,
  groupKey,
  groupTitle,
  inputFor,
  isPayrollRefusal,
  KIND_LABEL,
  readyGroups,
  REQUIRED_ROLES_TEXT,
  sameTarget,
  SELF_SETTLEMENT_TEXT,
  SETTLEMENT_ENTITY,
  summaryText,
  type CandidateGroup,
  type DraftTarget,
  type OpenAdvance,
  type SettlementCandidates,
} from '../lib/expense-settlement.ts';
import { formatDecimal } from '../lib/format.ts';
import { Badge, Button, buttonClass, Card, EmptyState, FormSection, PageHeader, SkeletonCard } from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const yen = (value: string) => `¥${formatDecimal(value)}`;

function Forbidden() {
  const { t } = useLocale();
  return (
    <div className="workspace-page">
      <EmptyState
        titleAs="h1"
        testId="expense-forbidden"
        title={t({ ja: '経費精算を使う権限がありません', en: 'You cannot use expense settlement' })}
        description={t(REQUIRED_ROLES_TEXT)}
        action={
          <Link to="/" className={buttonClass()}>
            {t({ ja: 'ホームへ戻る', en: 'Back to home' })}
          </Link>
        }
      />
    </div>
  );
}

export function ExpenseSettlementPage() {
  const meta = useMeta();
  if (meta.isError && !meta.data) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  // AC-20: the navigation hides the screen without the action; a direct URL explains the roles instead of failing.
  if (!meta.data.actions.some((action) => action.name === CANDIDATES_ACTION)) return <Forbidden />;
  return <Candidates key={financeIdentity()} />;
}

const CREATING: Label = { ja: '精算書を作成中…', en: 'Creating the settlement…' };

function Candidates() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const candidates = useExpenseCandidates(true);
  const draft = useDraftSettlement();
  const [pending, setPending] = useState<DraftTarget>();
  const [failed, setFailed] = useState<{ target: DraftTarget; error: unknown }>();
  if (candidates.isError && isPayrollRefusal(candidates.error)) return <Forbidden />;
  if (candidates.isError && !candidates.data)
    return <MetaError error={candidates.error} retry={() => void candidates.refetch()} />;
  const data = candidates.data;
  // The input is built from the candidates at click time, so a retry after a refetch never resends stale expenses.
  const create = async (target: DraftTarget) => {
    const input = data ? inputFor(target, data) : null;
    if (draft.isPending || !input) return;
    setFailed(undefined);
    setPending(target);
    try {
      const created = await draft.mutateAsync({ action: DRAFT_ACTION, input });
      toast.success(t({ ja: '精算書の下書きを作成しました。', en: 'Created a draft expense settlement.' }));
      await navigate({ to: '/e/$entity/$id', params: { entity: SETTLEMENT_ENTITY, id: created.id } });
    } catch (error) {
      setFailed({ target, error });
      void candidates.refetch(); // another accountant may have drafted these expenses meanwhile (CONFLICT)
    } finally {
      setPending(undefined);
    }
  };
  const retryable = failed && data && inputFor(failed.target, data) ? failed.target : undefined;
  return (
    <div className="workspace-page flex flex-col gap-4" data-testid="expense-settlement-page">
      <PageHeader
        eyebrow="EXPENSES"
        title={t({ ja: '経費精算', en: 'Expense settlement' })}
        subtitle={t({
          ja: '承認済みの経費を従業員・支払方法・拠点ごとにまとめています。「精算書を作成」で下書きを作り、精算書の画面で勘定科目・請求書区分を確認してから確定します。',
          en: 'Approved expenses grouped by employee, payment method and site. Create a draft, check the accounts and invoice kinds on the settlement, then submit it.',
        })}
        icon={<Icon name="wallet" size={24} />}
        actions={
          <>
            <Link to="/e/$entity" params={{ entity: SETTLEMENT_ENTITY }} className={buttonClass('ghost', 'sm')}>
              {t({ ja: '精算書の一覧', en: 'All settlements' })}
            </Link>
            <Link to="/e/$entity" params={{ entity: ADVANCE_ENTITY }} className={buttonClass('ghost', 'sm')}>
              {t({ ja: '仮払の一覧', en: 'All advances' })}
            </Link>
          </>
        }
      />
      <p className="sr-only" aria-live="polite" data-testid="expense-live">
        {pending ? t(CREATING) : data ? t(summaryText(data)) : t({ ja: '読み込み中…', en: 'Loading…' })}
      </p>
      {failed ? <DraftFailure failure={failed} onRetry={retryable ? () => void create(retryable) : undefined} /> : null}
      {data?.truncated ? (
        <p className="ui-notice ui-notice-warning" data-testid="expense-truncated">
          {t({
            ja: '承認済みの経費が 2,000 件を超えるため、利用日の古い順に 2,000 件だけを表示しています。精算を進めると残りが表示されます。',
            en: 'More than 2,000 approved expenses: the oldest 2,000 are shown. The rest appear as you settle.',
          })}
        </p>
      ) : null}
      <Card>
        <FormSection
          landmark
          title={t({ ja: '精算待ちの経費', en: 'Expenses awaiting settlement' })}
          description={data ? t(summaryText(data)) : undefined}
        >
          {data ? (
            <GroupList
              data={data}
              pending={pending}
              onCreate={(g) => void create({ kind: 'group', key: groupKey(g) })}
            />
          ) : (
            <div aria-busy="true">
              <SkeletonCard lines={4} />
            </div>
          )}
        </FormSection>
      </Card>
      {data && draftedOnly(data.groups).length > 0 ? (
        <Card>
          <FormSection
            title={t({ ja: '下書きの精算書に入っている経費', en: 'Expenses already in a draft settlement' })}
            description={t({
              ja: '確定待ちの精算書を開いて確定するか、不要なら下書きを削除してください。',
              en: 'Open the drafts and submit them, or delete drafts you do not need.',
            })}
          >
            <ul className="flex flex-col" data-testid="expense-drafted">
              {draftedOnly(data.groups).map((g) => (
                <li
                  key={groupKey(g)}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 basis-48 text-sm text-text">{groupTitle(g, locale)}</span>
                  <Badge tone="warning">
                    {t({ ja: `下書き ${g.inDraftCount} 件`, en: `${g.inDraftCount} in drafts` })}
                  </Badge>
                </li>
              ))}
            </ul>
            <Link
              to="/e/$entity"
              params={{ entity: SETTLEMENT_ENTITY }}
              search={{ status: 'draft' }}
              className="ui-link"
            >
              {t({ ja: '確定待ちの精算書を開く', en: 'Open draft settlements' })}
            </Link>
          </FormSection>
        </Card>
      ) : null}
      <Card>
        <FormSection
          title={t({ ja: '未精算の仮払', en: 'Open advances' })}
          description={t({
            ja: '仮払は「仮払精算」の精算書で消し込みます。使わなかった仮払は、明細のない仮払精算で全額の返金を記録します。',
            en: 'An advance is cleared by an advance settlement. Clear an unused advance with an advance settlement without lines (full refund).',
          })}
        >
          {data ? (
            <AdvanceList
              advances={data.advances}
              pending={pending}
              onClear={(a) => void create({ kind: 'advance', id: a.id })}
            />
          ) : (
            <div aria-busy="true">
              <SkeletonCard lines={2} />
            </div>
          )}
        </FormSection>
      </Card>
    </div>
  );
}

/**
 * The create button of one group or advance: aria-disabled (keeps focus) while any draft is being created, "Creating…"
 * on the one that was pressed, and absent when the group or advance cannot be drafted here (`block`).
 */
function CreateButton({
  busy,
  anyPending,
  block,
  label,
  name,
  variant,
  testId,
  onClick,
}: {
  busy: boolean;
  anyPending: boolean;
  block: Label | null;
  label: Label;
  name: string;
  variant: 'primary' | 'default';
  testId: string;
  onClick: () => void;
}) {
  const { t } = useLocale();
  if (block) return null;
  return (
    <Button
      variant={variant}
      size="sm"
      aria-disabled={anyPending || undefined}
      onClick={() => {
        if (!anyPending) onClick();
      }}
      aria-label={name}
      data-testid={testId}
    >
      {busy ? t({ ja: '作成中…', en: 'Creating…' }) : t(label)}
    </Button>
  );
}

function GroupList({
  data,
  pending,
  onCreate,
}: {
  data: SettlementCandidates;
  pending: DraftTarget | undefined;
  onCreate: (group: CandidateGroup) => void;
}) {
  const { t, locale } = useLocale();
  const groups = readyGroups(data.groups);
  if (groups.length === 0)
    return (
      <EmptyState
        titleAs="h3"
        testId="expense-empty"
        title={t({ ja: '精算待ちの承認済み経費はありません', en: 'No approved expense awaits settlement' })}
        description={t({
          ja: '従業員が提出した経費は、拠点の管理者が承認するとここに並びます。',
          en: 'Expenses appear here once a site manager approves what employees submitted.',
        })}
        action={
          <Link to="/workforce" search={{ tab: 'expenses' }} className={buttonClass('default', 'sm')}>
            {t({ ja: '経費の承認状況を見る', en: 'See expense approvals' })}
          </Link>
        }
      />
    );
  return (
    <ul className="flex flex-col" data-testid="expense-groups">
      {groups.map((g) => {
        const title = groupTitle(g, locale);
        const advances = advancesOf(data.advances, g.employeeId);
        const block = groupBlock(g, data.advances);
        const capped = cappedNote(g);
        return (
          <li
            key={groupKey(g)}
            data-testid="expense-group"
            data-method={g.paymentMethod}
            data-self={g.self || undefined}
            className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-border-subtle py-3 last:border-b-0"
          >
            <span className="min-w-0 flex-1 basis-56">
              <span className="block text-sm font-semibold text-text">{title}</span>
              <span className="block text-sm text-text-secondary">
                {t({
                  ja: `${g.count} 件 · 合計 ${yen(g.total)} · 最も古い利用日 ${g.oldestDate ?? '—'}`,
                  en: `${g.count} expense(s) · total ${yen(g.total)} · oldest ${g.oldestDate ?? '—'}`,
                })}
              </span>
              {g.inDraftCount > 0 ? (
                <span className="block text-xs text-text-muted">
                  {t({
                    ja: `ほかに ${g.inDraftCount} 件が下書きの精算書に入っています`,
                    en: `${g.inDraftCount} more already in a draft settlement`,
                  })}
                </span>
              ) : null}
              {g.kind === 'advance' && advances.length > 0 ? (
                <span className="block text-xs text-text-muted">
                  {advances.length === 1
                    ? t({
                        ja: `仮払 ${advances[0]?.number ?? ''}（${yen(advances[0]?.amount ?? '0')}）を消し込みます`,
                        en: `Clears advance ${advances[0]?.number ?? ''} (${yen(advances[0]?.amount ?? '0')})`,
                      })
                    : t({
                        ja: '未精算の仮払が複数あります。精算書の画面で選んでください',
                        en: 'Several open advances: choose one on the settlement',
                      })}
                </span>
              ) : null}
              {capped && !block ? (
                <span className="block text-xs text-text-muted" data-testid="expense-capped">
                  {t(capped)}
                </span>
              ) : null}
              {block ? (
                <span className="block text-xs text-text-secondary" data-testid="expense-blocked">
                  {t(block)}
                </span>
              ) : null}
            </span>
            <Badge tone="accent">{t(KIND_LABEL[g.kind])}</Badge>
            <CreateButton
              busy={sameTarget(pending, { kind: 'group', key: groupKey(g) })}
              anyPending={pending !== undefined}
              block={block}
              label={{ ja: '精算書を作成', en: 'Create settlement' }}
              name={t({ ja: `精算書を作成（${title}）`, en: `Create settlement (${title})` })}
              variant="primary"
              testId="expense-create"
              onClick={() => onCreate(g)}
            />
          </li>
        );
      })}
    </ul>
  );
}

function AdvanceList({
  advances,
  pending,
  onClear,
}: {
  advances: readonly OpenAdvance[];
  pending: DraftTarget | undefined;
  onClear: (advance: OpenAdvance) => void;
}) {
  const { t } = useLocale();
  if (advances.length === 0)
    return (
      <EmptyState
        titleAs="h3"
        testId="expense-advances-empty"
        title={t({ ja: '未精算の仮払はありません', en: 'No open advance' })}
        description={t({
          ja: '出張などで先に渡すお金は、仮払として記録して確定すると支払が作られ、ここに並びます。',
          en: 'Record and submit money handed out beforehand (a trip, for example) as an advance; it then appears here.',
        })}
        action={
          <Link to="/e/$entity" params={{ entity: ADVANCE_ENTITY }} className={buttonClass('default', 'sm')}>
            {t({ ja: '仮払の一覧へ', en: 'Go to advances' })}
          </Link>
        }
      />
    );
  return (
    <ul className="flex flex-col" data-testid="expense-advances">
      {advances.map((a) => {
        const block = advanceBlock(a);
        return (
          <li
            key={a.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-b-0"
          >
            <span className="min-w-0 flex-1 basis-48">
              <span className="block text-sm text-text">
                {a.number ?? '—'} · {a.employeeName}
              </span>
              <span className="block text-xs text-text-muted">
                {a.date} · {a.purpose}
              </span>
              {block ? <span className="block text-xs text-text-secondary">{t(block)}</span> : null}
            </span>
            <span className="text-sm tabular-nums text-text">{yen(a.amount)}</span>
            <Link to="/e/$entity/$id" params={{ entity: ADVANCE_ENTITY, id: a.id }} className="ui-link">
              {t({ ja: '仮払を開く', en: 'Open advance' })}
            </Link>
            <CreateButton
              busy={sameTarget(pending, { kind: 'advance', id: a.id })}
              anyPending={pending !== undefined}
              block={block}
              label={{ ja: '仮払精算を作成', en: 'Create advance clearing' }}
              variant="default"
              name={t({
                ja: `仮払精算を作成（${a.number ?? ''} ${a.employeeName}）`,
                en: `Create advance clearing (${a.number ?? ''} ${a.employeeName})`,
              })}
              testId="expense-clear-advance"
              onClick={() => onClear(a)}
            />
          </li>
        );
      })}
    </ul>
  );
}

const DRAFT_FAILED: Label = { ja: '精算書を作成できませんでした。', en: 'Could not create the settlement.' };

function DraftFailure({ failure, onRetry }: { failure: { error: unknown }; onRetry: (() => void) | undefined }) {
  const { t } = useLocale();
  const view = describeError(failure.error);
  const kind = draftFailureKind(failure.error);
  const reason = kind === 'self' ? SELF_SETTLEMENT_TEXT : kind === 'roles' ? REQUIRED_ROLES_TEXT : view.explanation;
  return (
    <div role="alert" className="ui-notice ui-notice-danger" data-testid="expense-draft-error">
      <p className="font-semibold">{t(DRAFT_FAILED)}</p>
      {reason ? <p>{t(reason)}</p> : null}
      <p>{view.message}</p>
      <ErrorDetails view={view} />
      {kind === 'other' && onRetry ? (
        <Button size="sm" onClick={onRetry}>
          {t({ ja: '再試行', en: 'Try again' })}
        </Button>
      ) : null}
    </div>
  );
}
