// /admin/audit (docs/specs/access-insight.md AC-19..AC-21), built with the UI kit: the audit records of the current
// company (or, for tenant administrators, the company-less administration records) by period, user, subject,
// operation and record id. Conditions and the page cursor live in the URL; "Previous" walks back through the pages
// opened on this screen. Read-only: every row links to the record form when there is one to open.
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { isApiError } from '../api/client.ts';
import { useCurrencyScale, useMe } from '../api/company.tsx';
import { useAuditOptions, useAuditSearch } from '../api/access-insight.ts';
import { useMeta } from '../api/queries.ts';
import type { EntityMeta, Label } from '../api/types.ts';
import { ErrorDetails } from '../components/error-details.tsx';
import { Icon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import {
  actorText,
  auditSearchParams,
  conditionsKey,
  conditionsOf,
  exportSummary,
  opLabel,
  pageAnnouncement,
  pageLabel,
  parseAuditSearch,
  popTrail,
  pushTrail,
  recordHref,
  subjectLabel,
  userOptionText,
  validateAuditForm,
  type AuditConditions,
  type AuditField,
  type AuditItem,
  type AuditOptions,
  type AuditSearchState,
  type FormError,
} from '../lib/audit-search.ts';
import { describeError } from '../lib/error-view.ts';
import { changeValueText, fieldChanges, formatTimestamp } from '../lib/format.ts';
import { Badge, Button, Card, EmptyState, FormSection, PageHeader, SkeletonRows } from '../ui/index.ts';
import { AdminOnly, canUseAccessInsight } from './permissions-page.tsx';
import { LoadingView, MetaError } from './status-views.tsx';

const OTHER_USER = '__other';
const FIELD_TEXT: Record<AuditField, Label> = {
  from: { ja: '開始日', en: 'From' },
  to: { ja: '終了日', en: 'To' },
  user: { ja: '利用者', en: 'User' },
  entity: { ja: '対象', en: 'Subject' },
  op: { ja: '操作', en: 'Operation' },
  record: { ja: '記録 ID', en: 'Record id' },
  scope: { ja: '範囲', en: 'Scope' },
  cursor: { ja: 'ページ', en: 'Page' },
};

function Changes({ item, entity }: { item: AuditItem; entity: EntityMeta | undefined }) {
  const { t, locale } = useLocale();
  const currencyScale = useCurrencyScale();
  const summary = exportSummary(item);
  if (summary) return <p data-testid="audit-export-summary">{t(summary)}</p>;
  const changes = fieldChanges(item);
  if (!changes.length)
    return <p className="text-text-muted">{t({ ja: '変更された項目はありません', en: 'No changed fields' })}</p>;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5" data-testid="audit-changes">
      {changes.map((c) => {
        const field = entity?.fields.find((f) => f.name === c.name);
        const after = changeValueText(field, c.after, locale, { currencyScale });
        return (
          <li key={c.name} className="break-words">
            <span className="text-text-secondary">{t(field?.label, c.name)}</span>
            {item.before === null ? (
              <span className="ml-1 font-mono">{after}</span>
            ) : (
              <>
                <span className="ml-1 font-mono text-text-muted line-through">
                  {changeValueText(field, c.before, locale, { currencyScale })}
                </span>
                <span className="mx-0.5 text-text-muted" aria-hidden="true">
                  →
                </span>
                <span className="sr-only">{t({ ja: 'から', en: 'to' })}</span>
                <span className="font-mono">{after}</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AuditRow({
  item,
  options,
  entities,
}: {
  item: AuditItem;
  options: AuditOptions | undefined;
  entities: ReadonlyMap<string, EntityMeta>;
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const entity = entities.get(item.entity);
  const href = recordHref(item, new Set(entities.keys()));
  const time = formatTimestamp(item.at, locale, 'Asia/Tokyo');
  const subject = t(subjectLabel(item.entity, options, entity?.label));
  // Each row's link and button name its subject and time, so a list of links or buttons tells the rows apart.
  const context = (
    <span className="sr-only">{locale === 'ja' ? `（${subject} ${time}）` : ` (${subject}, ${time})`}</span>
  );
  return (
    <li
      className="flex flex-col gap-1 border-b border-border-subtle py-3 last:border-b-0"
      data-testid="audit-row"
      data-op={item.op}
      data-id={item.id}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-mono text-text-secondary">
          <time dateTime={item.at}>{time}</time>
          <abbr className="ml-1 text-xs text-text-muted no-underline" title={t({ ja: '日本時間', en: 'Japan time' })}>
            JST
          </abbr>
        </span>
        <span className="font-semibold text-text" data-testid="audit-actor">
          {t(actorText(item))}
        </span>
        <span data-testid="audit-subject">{subject}</span>
        <Badge
          tone={item.op === 'delete' ? 'danger' : item.op === 'export' ? 'warning' : 'neutral'}
          data-testid="audit-op"
        >
          {t(opLabel(item.op, options))}
        </Badge>
        {item.action ? <span className="font-mono text-xs text-text-muted">{item.action}</span> : null}
      </div>
      <div className="text-sm">
        <Changes item={item} entity={entity} />
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        {href ? (
          <Link to={href} className="ui-link" data-testid="audit-record-link">
            {t({ ja: '記録を開く', en: 'Open the record' })}
            {context}
          </Link>
        ) : null}
        <button
          type="button"
          className="ui-link"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((v) => !v)}
        >
          {open
            ? t({ ja: '詳細を閉じる', en: 'Hide details' })
            : t({ ja: '変更前後をすべて見る', en: 'Show all values' })}
          {context}
        </button>
      </div>
      <div id={detailsId} hidden={!open} className="grid gap-2 md:grid-cols-2">
        {open
          ? (['before', 'after'] as const).map((side) => (
              <div key={side} className="min-w-0">
                <p className="text-xs font-semibold text-text-secondary">
                  {side === 'before' ? t({ ja: '変更前', en: 'Before' }) : t({ ja: '変更後', en: 'After' })}
                </p>
                <pre className="ui-code max-h-64 overflow-auto text-xs break-all whitespace-pre-wrap">
                  {item[side] === null ? '—' : JSON.stringify(item[side], null, 2)}
                </pre>
              </div>
            ))
          : null}
        {open ? (
          <p className="text-xs text-text-muted md:col-span-2">
            {t({ ja: '記録 ID', en: 'Record id' })}: <span className="font-mono">{item.recordId}</span>
            {item.requestId ? (
              <>
                {' · '}
                {t({ ja: '要求 ID', en: 'Request id' })}: <span className="font-mono">{item.requestId}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function AuditForm({
  state,
  enabled,
  tenantAdmin,
  refusedEntity,
  onSearch,
}: {
  state: AuditSearchState;
  enabled: boolean;
  tenantAdmin: boolean;
  /** The subject of the URL that the API refused (403): this company cannot read its audit (an unapplied pack…). */
  refusedEntity: string | undefined;
  onSearch: (next: AuditConditions) => void;
}) {
  const { t } = useLocale();
  const ids = useId();
  // The form holds conditions only: the page cursor stays in the URL, so a new search starts at the first page.
  const [form, setForm] = useState<AuditConditions>(() => conditionsOf(state));
  const [errors, setErrors] = useState<FormError[]>([]);
  // The choices follow the scope selected in the form, not the last searched one.
  const options = useAuditOptions(form.scope, enabled).data;
  const knownUser = !state.user || options?.users.some((u) => u.id === state.user) !== false;
  const [userMode, setUserMode] = useState<'list' | 'other'>(knownUser ? 'list' : 'other');
  const key = conditionsKey(state);
  useEffect(() => {
    // The URL changed (back, reload, a shared link): the form follows it.
    setForm(conditionsOf(state));
    setErrors([]);
  }, [key]);
  useEffect(() => {
    if (state.user && options && !options.users.some((u) => u.id === state.user)) setUserMode('other');
  }, [options, state.user]);
  const entityRefused = refusedEntity !== undefined && form.entity === refusedEntity;
  const set = (patch: Partial<AuditConditions>) => setForm((f) => ({ ...f, ...patch }));
  const errorOf = (field: FormError['field']) => errors.find((e) => e.field === field);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateAuditForm(form);
    setErrors(found);
    if (found.length) {
      document.getElementById(`${ids}-${found[0]?.field}`)?.focus();
      return;
    }
    onSearch({ ...form, record: form.entity ? form.record.trim().toLowerCase() : '' });
  };
  const describedBy = (field: FormError['field']) => (errorOf(field) ? `${ids}-${field}-error` : undefined);
  const entityErrorId = `${ids}-entity-error`;
  const fieldClass = 'flex min-w-0 flex-col gap-1 text-sm font-semibold text-text-secondary';
  const errorText = (field: FormError['field']) => {
    const error = errorOf(field);
    return error ? (
      <span id={`${ids}-${field}-error`} className="ui-field-error" data-testid={`audit-error-${field}`}>
        {t(error.message)}
      </span>
    ) : null;
  };
  const opNames = new Set(options?.ops.map((o) => o.name));
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t({ ja: '監査の検索条件', en: 'Audit search conditions' })}
      data-testid="audit-form"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tenantAdmin ? (
          <label className={fieldClass} htmlFor={`${ids}-scope`}>
            {t(FIELD_TEXT.scope)}
            <select
              id={`${ids}-scope`}
              className="input"
              value={form.scope}
              onChange={(e) =>
                set({
                  scope: e.target.value === 'tenant' ? 'tenant' : 'company',
                  entity: '',
                  op: '',
                  record: '',
                  user: '',
                })
              }
              data-testid="audit-scope"
            >
              <option value="company">{t({ ja: 'この会社', en: 'This company' })}</option>
              <option value="tenant">
                {t({ ja: 'テナントの管理操作（利用者・本人確認）', en: 'Tenant administration (users, identity)' })}
              </option>
            </select>
          </label>
        ) : null}
        <label className={fieldClass} htmlFor={`${ids}-from`}>
          {t(FIELD_TEXT.from)}
          <input
            id={`${ids}-from`}
            className="input"
            type="date"
            value={form.from}
            onChange={(e) => set({ from: e.target.value })}
            aria-invalid={errorOf('from') ? true : undefined}
            aria-describedby={describedBy('from')}
            data-testid="audit-from"
          />
          {errorText('from')}
        </label>
        <label className={fieldClass} htmlFor={`${ids}-to`}>
          {t(FIELD_TEXT.to)}
          <input
            id={`${ids}-to`}
            className="input"
            type="date"
            value={form.to}
            onChange={(e) => set({ to: e.target.value })}
            aria-invalid={errorOf('to') ? true : undefined}
            aria-describedby={describedBy('to')}
            data-testid="audit-to"
          />
          {errorText('to')}
        </label>
        <div className={fieldClass}>
          <label htmlFor={`${ids}-user`}>{t(FIELD_TEXT.user)}</label>
          <select
            id={`${ids}-user`}
            className="input"
            value={userMode === 'other' ? OTHER_USER : form.user}
            onChange={(e) => {
              if (e.target.value === OTHER_USER) {
                setUserMode('other');
                set({ user: '' });
              } else {
                setUserMode('list');
                set({ user: e.target.value });
              }
            }}
            data-testid="audit-user"
          >
            <option value="">{t({ ja: 'すべての利用者', en: 'Every user' })}</option>
            {(options?.users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {t(userOptionText(u))}
              </option>
            ))}
            <option value={OTHER_USER}>
              {t({ ja: 'ID を直接入力（システム・端末・AI など）', en: 'Enter an id (system, device, AI…)' })}
            </option>
          </select>
          {userMode === 'other' ? (
            <input
              className="input"
              aria-label={t({ ja: '利用者・実行者の ID', en: 'User or actor id' })}
              value={form.user}
              maxLength={200}
              onChange={(e) => set({ user: e.target.value.trim() })}
              data-testid="audit-user-id"
            />
          ) : null}
        </div>
        <label className={fieldClass} htmlFor={`${ids}-entity`}>
          {t(FIELD_TEXT.entity)}
          <select
            id={`${ids}-entity`}
            className="input"
            value={form.entity}
            onChange={(e) => set({ entity: e.target.value, ...(e.target.value ? {} : { record: '' }) })}
            aria-invalid={entityRefused || undefined}
            aria-describedby={entityRefused ? entityErrorId : undefined}
            data-testid="audit-entity"
          >
            <option value="">{t({ ja: 'すべての対象', en: 'Every subject' })}</option>
            {form.entity && !options?.subjects.some((s) => s.name === form.entity) ? (
              <option value={form.entity}>{form.entity}</option>
            ) : null}
            {(options?.subjects ?? []).map((s) => (
              <option key={s.name} value={s.name}>
                {t(s.label)}
              </option>
            ))}
          </select>
          {entityRefused ? (
            <span id={entityErrorId} className="ui-field-error" data-testid="audit-error-entity">
              {t({
                ja: 'この会社ではこの対象の監査を読めません（未適用のパックなど）。対象を選び直してください。',
                en: 'This company cannot read the audit of this subject (a pack not applied, for example). Choose another subject.',
              })}
            </span>
          ) : null}
        </label>
        <label className={fieldClass} htmlFor={`${ids}-op`}>
          {t(FIELD_TEXT.op)}
          <select
            id={`${ids}-op`}
            className="input"
            value={form.op}
            onChange={(e) => set({ op: e.target.value })}
            data-testid="audit-op-filter"
          >
            <option value="">{t({ ja: 'すべての操作', en: 'Every operation' })}</option>
            {form.op && !opNames.has(form.op) ? <option value={form.op}>{form.op}</option> : null}
            {(options?.ops ?? []).map((o) => (
              <option key={o.name} value={o.name}>
                {t(o.label)}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldClass} htmlFor={`${ids}-record`}>
          {t(FIELD_TEXT.record)}
          <input
            id={`${ids}-record`}
            className="input font-mono"
            value={form.record}
            disabled={!form.entity}
            placeholder={
              form.entity
                ? '00000000-0000-0000-0000-000000000000'
                : t({ ja: '対象を選ぶと入力できます', en: 'Choose a subject first' })
            }
            onChange={(e) => set({ record: e.target.value })}
            aria-invalid={errorOf('record') ? true : undefined}
            aria-describedby={describedBy('record')}
            data-testid="audit-record"
          />
          {errorText('record')}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" data-testid="audit-submit">
          {t({ ja: '検索', en: 'Search' })}
        </Button>
      </div>
    </form>
  );
}

export function AuditPage() {
  const { t } = useLocale();
  const meta = useMeta();
  const me = useMe();
  const navigate = useNavigate();
  const raw = useSearch({ strict: false }) as Record<string, unknown>;
  const tenantAdmin = me.data?.user.tenantAdmin === true;
  // The default period follows the day the screen is opened (Japan time).
  const [now] = useState(() => new Date());
  const { state, ignored } = useMemo(() => parseAuditSearch(raw, now, { tenantAdmin }), [raw, now, tenantAdmin]);
  const allowed = canUseAccessInsight(meta.data?.roles);
  // Labels of the result rows come from the searched scope's options (the form fetches its own scope's choices).
  const options = useAuditOptions(state.scope, allowed);
  const result = useAuditSearch(allowed && me.data ? state : null);
  const key = conditionsKey(state);
  const [trail, setTrail] = useState<{ key: string; cursors: string[] }>({ key, cursors: [] });
  const expectedCursor = useRef<string | undefined>(state.cursor);
  const cursors = trail.key === key ? trail.cursors : [];
  useEffect(() => {
    // A cursor this screen did not open (back button, reload, a shared link) starts a new trail.
    if (expectedCursor.current !== state.cursor) setTrail({ key, cursors: [] });
    expectedCursor.current = state.cursor;
  }, [state.cursor, key]);
  const [announcement, setAnnouncement] = useState('');
  const entities = useMemo(() => new Map((meta.data?.entities ?? []).map((e) => [e.name, e])), [meta.data]);
  // A cursor this screen did not reach itself (reload, Back, a shared link) is a later page of unknown number.
  const page = state.cursor && !cursors.length ? null : cursors.length + 1;
  useEffect(() => {
    if (result.data && !result.isFetching)
      setAnnouncement(t(pageAnnouncement(result.data.items.length, result.data.nextCursor !== null, page)));
  }, [result.data, result.isFetching]);
  if ((meta.isError && !meta.data) || (me.isError && !me.data))
    return <MetaError error={meta.error ?? me.error} retry={() => void Promise.all([meta.refetch(), me.refetch()])} />;
  if (!meta.data || !me.data) return <LoadingView />;
  const searchRefused = result.isError && isApiError(result.error) && result.error.status === 403;
  // A 403 for a chosen subject is about that subject (AC-13), not about the admin role: the form stays.
  const refusedEntity = searchRefused && state.entity ? state.entity : undefined;
  const refused =
    (searchRefused && !state.entity) || (options.isError && isApiError(options.error) && options.error.status === 403);
  if (!allowed || refused)
    return (
      <AdminOnly
        testId="audit-forbidden"
        title={{ ja: '監査ログの検索を開く権限がありません', en: 'You cannot open the audit search' }}
      />
    );
  const go = (next: AuditSearchState, replace = false) => {
    expectedCursor.current = next.cursor;
    void navigate({ to: '/admin/audit', search: auditSearchParams(next), replace });
  };
  const onSearch = (conditions: AuditConditions) => {
    const next = conditionsOf(conditions);
    if (conditionsKey(next) === key && !state.cursor && !ignored.length) {
      // The same search on the first page: fetch again (rows written since), the URL would not change.
      void result.refetch();
      void options.refetch();
      return;
    }
    setTrail({ key: conditionsKey(next), cursors: [] });
    go(next);
  };
  const nextPage = () => {
    if (!result.data?.nextCursor) return;
    setTrail({ key, cursors: pushTrail(cursors, state.cursor) });
    go({ ...state, cursor: result.data.nextCursor });
  };
  const previousPage = () => {
    if (!cursors.length) return;
    const { trail: rest, cursor } = popTrail(cursors);
    setTrail({ key, cursors: rest });
    go({ ...state, ...(cursor ? { cursor } : { cursor: undefined }) });
  };
  const firstPage = () => {
    if (!state.cursor) return;
    setTrail({ key, cursors: [] });
    go({ ...state, cursor: undefined });
  };
  const failure = result.isError && !refusedEntity ? describeError(result.error) : null;
  // A refused subject searched nothing: no earlier page is kept on screen under the new conditions.
  const items = refusedEntity ? [] : (result.data?.items ?? []);
  return (
    <div className="workspace-page flex min-w-0 flex-col gap-4" data-testid="audit-page">
      <PageHeader
        eyebrow="AUDIT"
        title={t({ ja: '監査ログの検索', en: 'Audit search' })}
        subtitle={t({
          ja: 'だれが・いつ・何を変更したか、CSV で出力したかを期間・利用者・対象・操作で探します。閲覧だけで、記録は変更できません。',
          en: 'Find who changed or exported what, and when, by period, user, subject and operation. Read-only: records cannot be changed here.',
        })}
        icon={<Icon name="search" size={24} />}
      />
      {ignored.length ? (
        <div className="ui-notice ui-notice-warning" role="status" data-testid="audit-ignored">
          {t({
            ja: `URL の条件のうち読めないもの（${ignored.map((f) => FIELD_TEXT[f].ja).join('、')}）は使わず、既定値で表示しています。`,
            en: `Unreadable conditions in the URL (${ignored.map((f) => FIELD_TEXT[f].en).join(', ')}) were ignored; defaults are shown.`,
          })}
        </div>
      ) : null}
      <Card>
        <AuditForm
          state={state}
          enabled={allowed}
          tenantAdmin={tenantAdmin}
          refusedEntity={refusedEntity}
          onSearch={onSearch}
        />
      </Card>
      <p className="sr-only" aria-live="polite" data-testid="audit-live">
        {result.isFetching ? t({ ja: '検索しています…', en: 'Searching…' }) : announcement}
      </p>
      {refusedEntity ? (
        <div className="ui-notice ui-notice-warning" role="status" data-testid="audit-entity-refused">
          {t({
            ja: `対象「${refusedEntity}」の監査はこの会社では読めないため、検索していません。対象を変えて検索してください。`,
            en: `The audit of “${refusedEntity}” cannot be read in this company, so nothing was searched. Choose another subject and search.`,
          })}
        </div>
      ) : null}
      {failure ? (
        <div className="ui-notice ui-notice-danger" data-testid="audit-error">
          <p className="font-semibold">
            {t({
              ja: '検索できませんでした。条件はそのまま残っています。',
              en: 'The search failed; your conditions are kept.',
            })}
          </p>
          {failure.explanation ? <p>{t(failure.explanation)}</p> : null}
          <p>{failure.message}</p>
          <ErrorDetails view={failure} />
          <Button size="sm" onClick={() => void result.refetch()}>
            {t({ ja: '再試行', en: 'Try again' })}
          </Button>
        </div>
      ) : null}
      <Card>
        <FormSection
          landmark
          title={t({ ja: '検索結果', en: 'Results' })}
          description={t({
            ja: `日時は日本時間。${state.scope === 'tenant' ? 'テナントの管理操作' : 'この会社'}の記録を新しい順に 50 件ずつ表示します。`,
            en: `Times are Japan time. ${state.scope === 'tenant' ? 'Tenant administration' : 'This company’s'} records, newest first, 50 at a time.`,
          })}
        >
          {refusedEntity ? null : result.isPending && !result.data ? (
            <div aria-busy="true">
              <table className="w-full">
                <tbody>
                  <SkeletonRows rows={4} columns={3} />
                </tbody>
              </table>
            </div>
          ) : items.length === 0 && !failure ? (
            <EmptyState
              testId="audit-empty"
              title={t({ ja: '条件に合う監査記録はありません', en: 'No audit records match' })}
              description={t({
                ja: '期間を広げるか、利用者・対象・操作の条件を外してください。',
                en: 'Widen the period or clear the user, subject or operation condition.',
              })}
            />
          ) : (
            <ol className="flex flex-col" data-testid="audit-results" aria-busy={result.isFetching || undefined}>
              {items.map((item) => (
                <AuditRow key={item.id} item={item} options={options.data} entities={entities} />
              ))}
            </ol>
          )}
          <nav className="mt-3 flex flex-wrap items-center gap-2" aria-label={t({ ja: 'ページ', en: 'Pages' })}>
            {/* aria-disabled, not disabled: the pressed button keeps keyboard focus when it becomes unavailable. */}
            <Button size="sm" onClick={firstPage} aria-disabled={!state.cursor || undefined} data-testid="audit-first">
              {t({ ja: '最初へ', en: 'First' })}
            </Button>
            <Button
              size="sm"
              onClick={previousPage}
              aria-disabled={!cursors.length || undefined}
              data-testid="audit-prev"
            >
              {t({ ja: '前へ', en: 'Previous' })}
            </Button>
            <Button
              size="sm"
              onClick={nextPage}
              aria-disabled={!result.data?.nextCursor || undefined}
              data-testid="audit-next"
            >
              {t({ ja: '次へ', en: 'Next' })}
            </Button>
            <span className="text-sm text-text-secondary" data-testid="audit-page-number">
              {t(pageLabel(page))}
            </span>
          </nav>
        </FormSection>
      </Card>
    </div>
  );
}
