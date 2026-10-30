// /finance/evidence — the evidence search (docs/specs/evidence-search.md AC-12..AC-21), built with the UI kit. The
// 電子帳簿保存法 search keys (取引年月日 range, 取引金額 range, 取引先) combine with AND; the criteria live in the URL.
// Results link to the record each piece of evidence is attached to (as far as the caller may read it), show the
// supersede state and open the supersede history; selected evidence downloads as one zip built in the browser from the
// existing download route. No new read or write path: attachment.evidence_search / attachment.history and
// GET /api/attachments/:id/download, all with the caller's permissions.
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { downloadAttachment } from '../api/attachments.ts';
import { useCurrencyScale } from '../api/company.tsx';
import { useEvidenceSearch } from '../api/evidence.ts';
import { financeIdentity } from '../api/finance.ts';
import { useMeta, useRefLabelMaps } from '../api/queries.ts';
import type { AppMeta, FieldMeta, Label, RecordJson } from '../api/types.ts';
import { ErrorDetails } from '../components/error-details.tsx';
import { EvidenceDownload } from '../components/evidence-download.tsx';
import { EvidenceHistoryDialog } from '../components/evidence-history-dialog.tsx';
import { RefField } from '../components/fields/ref-field.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import { describeError } from '../lib/error-view.ts';
import {
  checkDraft,
  criteriaFromSearch,
  criteriaKey,
  EMPTY_CRITERIA,
  EVIDENCE_PAGE_SIZE,
  EVIDENCE_SEARCH_ACTION,
  FIELD_LABELS,
  linkView,
  sameCriteria,
  searchFromCriteria,
  searchInput,
  SUPERSEDED_LABELS,
  SUPERSEDED_VALUES,
  summarizeCriteria,
  ZIP_MAX_FILES,
  type CriteriaField,
  type EvidenceCriteria,
  type EvidenceItem,
  type SupersededValue,
} from '../lib/evidence-search.ts';
import { docstatusLabel, formatValue } from '../lib/format.ts';
import { toggleSelection, togglePageSelection, type RowSelectionMap } from '../lib/list-workbench.ts';
import { S } from '../strings.ts';
import { Badge, Button, buttonClass, Card, DataTableShell, EmptyState, PageHeader } from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const TITLE: Label = { ja: '証憑の検索', en: 'Evidence search' };
const NO_SELECTION: RowSelectionMap = new Map();
const COLUMNS = 9;

export function EvidencePage() {
  const { t } = useLocale();
  const meta = useMeta();
  if (!meta.data) {
    if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
    return <LoadingView />;
  }
  // AC-12: the navigation hides the screen without the action; a direct URL explains instead of failing.
  if (!meta.data.actions.some((action) => action.name === EVIDENCE_SEARCH_ACTION))
    return (
      <div className="workspace-page">
        <EmptyState
          titleAs="h1"
          title={t({ ja: '証憑の検索を使う権限がありません', en: 'You cannot use the evidence search' })}
          description={t({
            ja: '証憑（添付）を読む権限（経理・営業・購買・閲覧・管理者のいずれかの役割）が必要です。必要なら管理者に役割の追加を依頼してください。',
            en: 'Reading evidence (attachments) requires the accounting, sales, purchasing, viewer or admin role. Ask your administrator to add one if you need it.',
          })}
          action={
            <Link to="/" className={buttonClass()}>
              {t({ ja: 'ホームへ戻る', en: 'Back to home' })}
            </Link>
          }
        />
      </div>
    );
  return <EvidenceSearch key={financeIdentity()} meta={meta.data} />;
}

function fieldOf(meta: AppMeta, name: string): FieldMeta | undefined {
  return meta.entities.find((e) => e.name === 'attachment')?.fields.find((f) => f.name === name);
}

function SearchForm({
  draft,
  setDraft,
  errors,
  kindField,
  partnerField,
  onSubmit,
  onClear,
}: {
  draft: EvidenceCriteria;
  setDraft: (update: (d: EvidenceCriteria) => EvidenceCriteria) => void;
  errors: Partial<Record<CriteriaField, Label>>;
  kindField: FieldMeta | undefined;
  partnerField: FieldMeta | undefined;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
}) {
  const { t, locale } = useLocale();
  const uid = useId();
  const set = (key: keyof EvidenceCriteria, value: string | boolean) => setDraft((d) => ({ ...d, [key]: value }));
  const errorId = (key: CriteriaField) => `${uid}-${key}-error`;
  const text = (key: 'from' | 'to' | 'amountFrom' | 'amountTo', type: 'date' | 'text') => {
    const error = errors[key];
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={`${uid}-${key}`} className="text-xs text-text-secondary">
          {t(FIELD_LABELS[key])}
        </label>
        <input
          id={`${uid}-${key}`}
          name={key}
          type={type}
          inputMode={type === 'text' ? 'decimal' : undefined}
          autoComplete="off"
          className={`input w-full ${error ? 'input-error' : ''}`}
          value={draft[key]}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId(key) : undefined}
          onChange={(event) => set(key, event.target.value)}
        />
        {error ? (
          <p id={errorId(key)} className="ui-field-error">
            {t(error)}
          </p>
        ) : null}
      </div>
    );
  };
  return (
    <Card
      as="form"
      onSubmit={onSubmit}
      noValidate
      aria-label={t({ ja: '検索条件', en: 'Search criteria' })}
      data-testid="evidence-form"
    >
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
        <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-semibold text-text-secondary">
            {t({ ja: '取引年月日', en: 'Transaction date' })}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {text('from', 'date')}
            {text('to', 'date')}
          </div>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-semibold text-text-secondary">
            {t({ ja: '取引金額', en: 'Amount' })}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {text('amountFrom', 'text')}
            {text('amountTo', 'text')}
          </div>
        </fieldset>
        <div className="flex min-w-0 flex-col">
          <label htmlFor={`${uid}-partner`} className="mb-1 text-xs font-semibold text-text-secondary">
            {t(FIELD_LABELS.partnerId)}
          </label>
          {partnerField ? (
            <RefField
              id={`${uid}-partner`}
              field={partnerField}
              value={draft.partnerId}
              onChange={(v) => set('partnerId', typeof v === 'string' ? v : '')}
              disabled={false}
              invalid={false}
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col">
          <label htmlFor={`${uid}-kind`} className="mb-1 text-xs font-semibold text-text-secondary">
            {t(FIELD_LABELS.kind)}
          </label>
          <select
            id={`${uid}-kind`}
            className="input w-full"
            value={draft.kind}
            onChange={(e) => set('kind', e.target.value)}
          >
            <option value="">{t({ ja: 'すべて', en: 'All' })}</option>
            {(kindField?.values ?? []).map((v) => (
              <option key={v} value={v}>
                {kindField?.valueLabels?.[v]?.[locale] ?? v}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col">
          <label htmlFor={`${uid}-superseded`} className="mb-1 text-xs font-semibold text-text-secondary">
            {t(FIELD_LABELS.superseded)}
          </label>
          <select
            id={`${uid}-superseded`}
            className="input w-full"
            value={draft.superseded}
            onChange={(e) => set('superseded', e.target.value as SupersededValue)}
          >
            {SUPERSEDED_VALUES.map((v) => (
              <option key={v} value={v}>
                {t(SUPERSEDED_LABELS[v])}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col justify-end">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="ui-row-check"
              checked={draft.incomplete}
              onChange={(e) => set('incomplete', e.target.checked)}
            />
            {t({ ja: '検索項目が未入力の証憑のみ', en: 'Only evidence missing a search key' })}
          </label>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          {t(S.search)}
        </Button>
        <Button onClick={onClear}>{t({ ja: '条件をクリア', en: 'Clear criteria' })}</Button>
      </div>
    </Card>
  );
}

function ResultRow({
  item,
  selected,
  onSelect,
  onHistory,
  partnerField,
  partnerLabel,
  kindField,
  amountField,
  currencyScale,
  entityLabel,
}: {
  item: EvidenceItem;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onHistory: () => void;
  partnerField: FieldMeta | undefined;
  partnerLabel: string | undefined;
  kindField: FieldMeta | undefined;
  amountField: FieldMeta | undefined;
  currencyScale: number;
  entityLabel: (entity: string) => string | undefined;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const link = linkView(item.linked, entityLabel, locale);
  const amount = item.amount === null ? '' : formatValue(amountField, item.amount, locale, { currencyScale }).text;
  const partner =
    item.partnerId === null
      ? ''
      : formatValue(partnerField, item.partnerId, locale, partnerLabel ? { refLabel: partnerLabel } : {}).text;
  return (
    <tr className={selected ? 'ui-row-link is-selected' : undefined} data-testid={`evidence-row-${item.id}`}>
      <td className="ui-select-cell">
        <input
          type="checkbox"
          className="ui-row-check"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={t({ ja: `選択: ${item.filename}`, en: `Select ${item.filename}` })}
        />
      </td>
      <td className="font-mono">{item.txnDate ?? ''}</td>
      <td className="ui-cell-num font-mono">{amount}</td>
      <td>{partner}</td>
      <td>{item.kind ? (kindField?.valueLabels?.[item.kind]?.[locale] ?? item.kind) : ''}</td>
      <td>
        <span className="inline-flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void downloadAttachment(item).catch((error: unknown) => toast.error(error))}
            aria-label={t({ ja: `${item.filename} をダウンロード`, en: `Download ${item.filename}` })}
          >
            {item.filename}
          </Button>
          {item.incomplete ? (
            <Badge tone="warning" data-testid="evidence-incomplete">
              {t({ ja: '未入力', en: 'Missing keys' })}
            </Badge>
          ) : null}
        </span>
      </td>
      <td data-testid="evidence-linked">
        {link ? (
          link.href && item.linked?.target ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              <Link
                to="/e/$entity/$id"
                params={{ entity: item.linked.target.entity, id: item.linked.target.id }}
                className="ui-link"
              >
                {link.text}
              </Link>
              {item.linked?.docstatus !== null && item.linked?.docstatus !== undefined ? (
                <Badge>{t(docstatusLabel(item.linked.docstatus))}</Badge>
              ) : null}
              {link.viaLine ? (
                <span className="text-xs text-text-muted">{t({ ja: '（明細から）', en: '(from a line)' })}</span>
              ) : null}
            </span>
          ) : (
            <span className="text-text-muted">{link.text}</span>
          )
        ) : (
          ''
        )}
      </td>
      <td data-testid="evidence-supersede">
        <span className="inline-flex flex-wrap items-center gap-1">
          {item.supersededById ? (
            <>
              <Badge tone="neutral">{t({ ja: '差替済み', en: 'Superseded' })}</Badge>
              <Link
                to="/e/$entity/$id"
                params={{ entity: 'attachment', id: item.supersededById }}
                className="ui-link text-xs"
              >
                {t({ ja: '差替先', en: 'Replacement' })}
              </Link>
            </>
          ) : null}
          {item.supersedes > 0 ? (
            <Badge tone="accent">{t({ ja: `差替前 ${item.supersedes} 件`, en: `${item.supersedes} earlier` })}</Badge>
          ) : null}
        </span>
      </td>
      <td>
        <span className="inline-flex items-center gap-2">
          <Button
            size="sm"
            onClick={onHistory}
            aria-label={t({ ja: `履歴: ${item.filename}`, en: `History: ${item.filename}` })}
          >
            {t({ ja: '履歴', en: 'History' })}
          </Button>
          <Link
            to="/e/$entity/$id"
            params={{ entity: 'attachment', id: item.id }}
            className="ui-link text-xs"
            aria-label={t({ ja: `証憑の記録: ${item.filename}`, en: `Evidence record: ${item.filename}` })}
          >
            {t({ ja: '記録', en: 'Record' })}
          </Link>
        </span>
      </td>
    </tr>
  );
}

function EvidenceSearch({ meta }: { meta: AppMeta }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/finance/evidence' });
  const currencyScale = useCurrencyScale();
  const kindField = fieldOf(meta, 'kind');
  const partnerField = fieldOf(meta, 'partnerId');
  const amountField = fieldOf(meta, 'amount');
  const kinds = kindField?.values;
  const { criteria, page, ignored } = useMemo(() => criteriaFromSearch(search, kinds ?? []), [search, kinds]);
  const appliedKey = criteriaKey(criteria);
  const input = useMemo(() => searchInput(criteria, page), [criteria, page]);
  const result = useEvidenceSearch(input, true);
  const items = result.isError ? [] : (result.data?.items ?? []);

  // The form edits a draft; it follows the URL whenever the applied criteria change (back/forward, a shared link).
  const [draft, setDraftState] = useState<EvidenceCriteria>(criteria);
  const [errors, setErrors] = useState<Partial<Record<CriteriaField, Label>>>({});
  const synced = useRef(appliedKey);
  useEffect(() => {
    if (synced.current === appliedKey) return;
    synced.current = appliedKey;
    setDraftState(criteria);
    setErrors({});
  }, [appliedKey, criteria]);
  const setDraft = (update: (d: EvidenceCriteria) => EvidenceCriteria) => {
    setDraftState(update);
    setErrors({});
  };
  const formRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useRef(false);
  useEffect(() => {
    if (!focusInvalid.current) return;
    focusInvalid.current = false;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  // AC-18 / AC-20: the selection lives as long as the applied criteria (pages included) and this company / user.
  const [selection, setSelection] = useState<{ key: string; rows: RowSelectionMap; refused: boolean }>({
    key: appliedKey,
    rows: NO_SELECTION,
    refused: false,
  });
  const rows = selection.key === appliedKey ? selection.rows : NO_SELECTION;
  const refused = selection.key === appliedKey && selection.refused;
  const selected = useMemo(() => [...rows.values()] as EvidenceItem[], [rows]);
  const select = (item: EvidenceItem, on: boolean) => {
    const next = toggleSelection(rows, item, on, ZIP_MAX_FILES);
    setSelection({ key: appliedKey, rows: next, refused: on && next === rows && !rows.has(item.id) });
  };
  const selectPage = (on: boolean) => {
    const next = togglePageSelection(rows, items, on, ZIP_MAX_FILES);
    setSelection({ key: appliedKey, rows: next, refused: on && items.some((item) => !next.has(item.id)) });
  };
  const pageSelected = items.length > 0 && items.every((item) => rows.has(item.id));

  const [history, setHistory] = useState<{ id: string; filename: string } | null>(null);

  const labelRows = useMemo(
    () =>
      criteria.partnerId
        ? [...items, { id: 'criteria', partnerId: criteria.partnerId } as unknown as RecordJson]
        : items,
    [items, criteria.partnerId],
  );
  const refLabel = useRefLabelMaps(partnerField ? [partnerField] : [], labelRows);
  const partnerLabel = (id: string | null) => (partnerField && id ? refLabel(partnerField, id) : undefined);
  const entityLabel = (entity: string) => {
    const found = meta.entities.find((e) => e.name === entity);
    return found ? t(found.label) : undefined;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const check = checkDraft(draft);
    if (Object.keys(check.errors).length > 0) {
      focusInvalid.current = true;
      setErrors(check.errors);
      return;
    }
    setErrors({});
    setDraftState(check.criteria);
    // AC-13: searching again with the same criteria reads again; other criteria start at the first page.
    if (sameCriteria(check.criteria, criteria) && page === 1) void result.refetch();
    else void navigate({ to: '/finance/evidence', search: searchFromCriteria(check.criteria) });
  };
  const clear = () => {
    setErrors({});
    setDraftState(EMPTY_CRITERIA); // also when the URL already has no criteria (only the draft was edited)
    void navigate({ to: '/finance/evidence', search: {} });
  };
  const goPage = (next: number) =>
    void navigate({ to: '/finance/evidence', search: searchFromCriteria(criteria, next) });

  const summary = summarizeCriteria(criteria, locale, {
    partner: partnerLabel(criteria.partnerId || null),
    kind: criteria.kind ? kindField?.valueLabels?.[criteria.kind]?.[locale] : undefined,
  });
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / EVIDENCE_PAGE_SIZE));
  const firstRow = total === 0 ? 0 : (page - 1) * EVIDENCE_PAGE_SIZE + 1;
  const lastRow = Math.min(total, page * EVIDENCE_PAGE_SIZE);
  const view = result.isError ? describeError(result.error) : undefined;

  return (
    <div className="workspace-page evidence-page flex flex-col gap-4" data-testid="evidence-page">
      <PageHeader
        title={t(TITLE)}
        subtitle={t({
          ja: '取引年月日・取引金額・取引先で証憑を探します。指定した条件はすべて満たす（AND）ものだけを表示します（電子帳簿保存法の検索要件）。',
          en: 'Find evidence by transaction date, amount and partner. Only evidence matching every given criterion (AND) is shown (the 電子帳簿保存法 search requirement).',
        })}
      />
      <div ref={formRef}>
        <SearchForm
          draft={draft}
          setDraft={setDraft}
          errors={errors}
          kindField={kindField}
          partnerField={partnerField}
          onSubmit={submit}
          onClear={clear}
        />
      </div>
      {ignored.length > 0 ? (
        <p className="ui-notice ui-notice-warning text-sm" data-testid="evidence-ignored">
          {t({ ja: 'URL の条件のうち、正しくない値を無視しました: ', en: 'Invalid values in the URL were ignored: ' })}
          {ignored.map((key) => t(FIELD_LABELS[key])).join(locale === 'ja' ? '、' : ', ')}
        </p>
      ) : null}
      <section className="flex flex-col gap-2" aria-labelledby="evidence-results-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="evidence-results-heading" className="text-base font-bold text-text-heading">
            {t({ ja: '検索結果', en: 'Results' })}
          </h2>
          <p className="text-sm text-text-secondary" data-testid="evidence-summary" aria-live="polite">
            {result.isPending || view
              ? ''
              : summary.length
                ? t({
                    ja: `指定した条件をすべて満たす証憑: ${total} 件`,
                    en: `Evidence matching all criteria: ${total}`,
                  })
                : t({ ja: `条件なし（すべての証憑）: ${total} 件`, en: `No criteria (all evidence): ${total}` })}
          </p>
        </div>
        {summary.length ? (
          <ul
            className="ui-chips"
            data-testid="evidence-criteria"
            aria-label={t({ ja: '適用中の条件', en: 'Applied criteria' })}
          >
            {summary.map((phrase) => (
              <li key={phrase} className="ui-chip">
                {phrase}
              </li>
            ))}
          </ul>
        ) : null}
        <EvidenceDownload
          selected={selected}
          refused={refused}
          onClear={() => setSelection({ key: appliedKey, rows: NO_SELECTION, refused: false })}
        />
        {view ? (
          <div
            className="ui-notice ui-notice-danger flex flex-col items-start gap-1"
            role="alert"
            data-testid="evidence-error"
          >
            <p className="font-semibold">{t({ ja: '検索できませんでした', en: 'The search failed' })}</p>
            <p>{view.explanation ? t(view.explanation) : view.message}</p>
            {view.explanation ? <p className="text-xs">{view.message}</p> : null}
            <ErrorDetails view={view} />
            <Button size="sm" onClick={() => void result.refetch()}>
              {t(S.retry)}
            </Button>
          </div>
        ) : (
          <>
            <DataTableShell
              testId="evidence-results"
              label={t({ ja: '証憑の検索結果', en: 'Evidence search results' })}
              columnCount={COLUMNS}
              skeleton={result.isPending}
              busy={result.isFetching}
              loadingLabel={t(S.loading)}
              isEmpty={!result.isPending && items.length === 0}
              empty={
                <EmptyState
                  title={t({ ja: '条件に合う証憑はありません', en: 'No evidence matches these criteria' })}
                  description={t({
                    ja: '条件を減らすか範囲を広げて、もう一度検索してください。取引年月日・取引金額・取引先が未入力の証憑は、その項目の検索には出ません（「検索項目が未入力の証憑のみ」で探せます）。',
                    en: 'Remove a criterion or widen a range and search again. Evidence missing a date, amount or partner never matches a search on that key (use "Only evidence missing a search key" to find it).',
                  })}
                />
              }
              head={
                <tr>
                  <th scope="col" className="ui-select-cell">
                    <input
                      type="checkbox"
                      className="ui-row-check"
                      checked={pageSelected}
                      disabled={items.length === 0}
                      onChange={(e) => selectPage(e.target.checked)}
                      aria-label={t({ ja: 'この頁の証憑をすべて選択', en: 'Select all evidence on this page' })}
                    />
                  </th>
                  <th scope="col">{t({ ja: '取引年月日', en: 'Date' })}</th>
                  <th scope="col" className="ui-cell-num">
                    {t({ ja: '取引金額', en: 'Amount' })}
                  </th>
                  <th scope="col">{t({ ja: '取引先', en: 'Partner' })}</th>
                  <th scope="col">{t({ ja: '種別', en: 'Kind' })}</th>
                  <th scope="col">{t({ ja: 'ファイル名', en: 'File' })}</th>
                  <th scope="col">{t({ ja: 'リンク先', en: 'Linked record' })}</th>
                  <th scope="col">{t({ ja: '差替', en: 'Supersede' })}</th>
                  <th scope="col">{t({ ja: '操作', en: 'Actions' })}</th>
                </tr>
              }
            >
              {items.map((item) => (
                <ResultRow
                  key={item.id}
                  item={item}
                  selected={rows.has(item.id)}
                  onSelect={(on) => select(item, on)}
                  onHistory={() => setHistory({ id: item.id, filename: item.filename })}
                  partnerField={partnerField}
                  partnerLabel={partnerLabel(item.partnerId)}
                  kindField={kindField}
                  amountField={amountField}
                  currencyScale={currencyScale}
                  entityLabel={entityLabel}
                />
              ))}
            </DataTableShell>
            {total > 0 ? (
              <div
                className="flex flex-wrap items-center gap-2 text-xs text-text-secondary"
                data-testid="evidence-pager"
              >
                <span className="font-mono tabular-nums">
                  {firstRow}–{lastRow} / {total} {t(S.total)}
                </span>
                <Button size="sm" disabled={page <= 1} onClick={() => goPage(page - 1)}>
                  {t(S.prev)}
                </Button>
                <span className="font-mono tabular-nums">
                  {page} / {pages}
                </span>
                <Button size="sm" disabled={page >= pages} onClick={() => goPage(page + 1)}>
                  {t(S.next)}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
      {history ? (
        <EvidenceHistoryDialog
          id={history.id}
          filename={history.filename}
          amountField={amountField}
          currencyScale={currencyScale}
          onClose={() => setHistory(null)}
        />
      ) : null}
    </div>
  );
}
