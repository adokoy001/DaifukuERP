// /finance/opening — the opening balance import (docs/specs/opening-balances.md AC-31..AC-39), built with the UI kit.
// Three steps (opening journal, receivables + payables, stock), each: choose a CSV (lib/csv-parse.ts, as the B5 import
// screen), preview with a dry-run, then import after a kit Dialog. Every write is one of the four import actions or the
// reversal of the opening journal; the screen adds no read or write path of its own.
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useId, useLayoutEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { isApiError } from '../api/client.ts';
import { financeIdentity } from '../api/finance.ts';
import {
  openingStatusKey,
  reverseOpeningJournal,
  runOpeningImport,
  useOpeningCount,
  useOpeningStatus,
} from '../api/opening-balances.ts';
import { useMeta } from '../api/queries.ts';
import type { AppMeta, Label } from '../api/types.ts';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import {
  CsvParseError,
  csvTable,
  decodeCsvBytes,
  parseCsv,
  type CsvEncoding,
  type CsvTable,
} from '../lib/csv-parse.ts';
import { saveBlob } from '../lib/download.ts';
import { formatDecimal } from '../lib/format.ts';
import {
  errorCsv,
  fileLine,
  matchHeaders,
  messageLine,
  OPEN_FISCAL_YEAR_ACTION,
  OPENING_MAX_BYTES,
  OPENING_MAX_ROWS,
  OPENING_REVERSE_ACTION,
  OPENING_STATUS_ACTION,
  requestBytes,
  requestRows,
  sectionBlocked,
  templateCsv,
  templateFilename,
  totalsList,
  YEAR_REASON_TEXT,
  type OpeningBalanceStatus,
  type OpeningImportResult,
  type OpeningSection,
} from '../lib/opening-balances.ts';
import { S } from '../strings.ts';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  DataTableShell,
  Dialog,
  EmptyState,
  FormSection,
  PageHeader,
  SkeletonCard,
  type BadgeTone,
} from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const L = (ja: string, en: string): Label => ({ ja, en });
const PREVIEW_ROWS = 50;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ENCODING: Record<CsvEncoding, string> = { 'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8 (BOM)', shift_jis: 'Shift_JIS' };
const T = {
  title: L('期首残高の取込', 'Opening balances'),
  subtitle: L(
    '利用開始の会計年度の期首時点の残高を、開始仕訳・売掛金と買掛金・在庫の CSV で取り込みます。事前確認では何も変更しません。',
    'Import the balances at the start of the first fiscal year from CSV files: the opening journal, receivables and payables, and stock. The preview changes nothing.',
  ),
  noAccess: L('期首残高の取込を使う権限がありません', 'You cannot use the opening balance import'),
  noAccessHelp: L(
    '経理または管理者の役割が必要です。必要なら管理者に役割の追加を依頼してください。',
    'The accounting or admin role is required. Ask your administrator to add it if you need it.',
  ),
  home: L('ホームへ戻る', 'Back to home'),
  noYear: L('会計年度がまだありません', 'There is no fiscal year yet'),
  noYearHelp: L(
    '期首残高は最初の会計年度の期首日の前日付で入ります。先に会計年度を開設してください。',
    'Opening balances are dated the day before the first fiscal year. Open the fiscal year first.',
  ),
  openYear: L('会計年度を開設', 'Open a fiscal year'),
  year: L('会計年度', 'Fiscal year'),
  yearHelp: L(
    '期首残高を取り込めるのは、会社の最初の会計年度だけです。',
    'Opening balances can be imported only into the company’s first fiscal year.',
  ),
  status: L('取込の状況', 'Import status'),
  openingDate: L('期首残高日', 'Opening date'),
  journal: L('開始仕訳', 'Opening journal'),
  notImported: L('未取込', 'Not imported'),
  reversed: L('取り消した開始仕訳', 'Reversed opening journals'),
  reverse: L('開始仕訳を取り消す', 'Reverse the opening journal'),
  reverseTitle: L('開始仕訳を取り消しますか？', 'Reverse the opening journal?'),
  reverseHelp: L(
    '期首残高日付の逆仕訳を作ります。期首請求書と期首在庫の入庫はそのまま残ります（それぞれの一覧から取り消します）。',
    'A reversing entry dated the opening date is posted. Opening invoices and stock receipts stay (cancel them from their lists).',
  ),
  reversedDone: L('開始仕訳を取り消しました', 'The opening journal was reversed'),
  clearing: L('期首残高仮勘定', 'Opening balance clearing account'),
  clearingZero: L('残高は 0 です（取込の合計が一致しています）。', 'The balance is 0 (the imports agree).'),
  clearingOff: L(
    '残高が 0 ではありません。仮勘定へ回した科目の合計と、売掛金・買掛金の取込額が一致していません。',
    'The balance is not 0: the accounts moved to the clearing account and the imported receivables/payables differ.',
  ),
  clearingMoved: L('仮勘定へ回した明細', 'Lines moved to the clearing account'),
  clearingUsed: L(
    '期首残高日以外の日付の明細があります（期首残高以外にも使われています）',
    'It has lines dated other than the opening date (used for something else too)',
  ),
  documents: L('期首残高の伝票', 'Opening documents'),
  salesInvoices: L('期首の売上請求書', 'Opening sales invoices'),
  purchaseInvoices: L('期首の仕入請求書', 'Opening purchase invoices'),
  stockEntries: L('期首在庫の入庫', 'Opening stock receipts'),
  openList: L('一覧を開く', 'Open the list'),
  docsHelp: L(
    '期首請求書と期首在庫の入庫は一覧から取り消せます（期首残高日付で取り消すと取り込み直せます）。',
    'Cancel opening invoices and stock receipts from their lists (cancelled on the opening date, they can be imported again).',
  ),
  step1: L('1. 開始仕訳', '1. Opening journal'),
  step1Help: L(
    '試算表の貸借対照表の科目の期首残高。取引先なしの売掛金・買掛金の合計行は期首残高仮勘定へ計上し、2 の取込で取引先別に振り替えます。',
    'Balance-sheet accounts of the opening trial balance. Receivable/payable totals without a partner go to the clearing account; step 2 moves them per partner.',
  ),
  step2: L('2. 売掛金・買掛金', '2. Receivables and payables'),
  step2Help: L(
    '取引先ごとの未入金・未払の残高。1 行が 1 件の期首請求書になり、消込と年齢表の対象になります（発行はしません）。',
    'Open balances per partner. Each row becomes one opening invoice for allocation and aging (it is never issued).',
  ),
  receivables: L('売掛金', 'Receivables'),
  payables: L('買掛金', 'Payables'),
  step3: L('3. 在庫', '3. Stock'),
  step3Help: L(
    '品目 × 倉庫ごとの期首数量と単価。単価が移動平均の最初の単価になります。仕訳は作りません（在庫科目は 1 で入れます）。',
    'Opening quantity and unit cost per product and warehouse; the cost starts the moving average. No journal (the inventory account is in step 1).',
  ),
  order: L(
    '順番は 1 → 2 → 3 を勧めますが、どの順でも仮勘定は合計で一致します。',
    'The order 1 → 2 → 3 is suggested; in any order the clearing account nets to zero when the files agree.',
  ),
  template: L('雛形をダウンロード', 'Download template'),
  file: L('CSV ファイル', 'CSV file'),
  fileHelp: L(
    'UTF-8（BOM の有無を問わない）または Shift_JIS。1 行目は見出し（日本語・英語の見出しか項目名）。',
    'UTF-8 (with or without BOM) or Shift_JIS. The first row is the header (Japanese or English labels, or field names).',
  ),
  encoding: L('文字コード', 'Encoding'),
  rows: L('行', 'rows'),
  tooLarge: L(
    'ファイルが大きすぎます（2 MB まで）。分けて取り込んでください。',
    'The file is too large (2 MB at most). Split it.',
  ),
  tooMany: L('行が多すぎます。ファイルを分けてください。上限: ', 'Too many rows; split the file. Limit: '),
  emptyFile: L('見出しとデータの行がありません。', 'The file has no header and data rows.'),
  binary: L('CSV として読めませんでした。', 'The file could not be read as CSV.'),
  quote: L('引用符が閉じていません。行: ', 'A quoted cell is not closed. Row: '),
  wide: L(
    '見出しより多いセルのある行があります（カンマのずれ）。行: ',
    'Rows have more cells than the header (shifted commas). Rows: ',
  ),
  missing: L('必須の列がありません: ', 'Required columns are missing: '),
  unknown: L('知らない列があります: ', 'Unknown columns: '),
  duplicate: L('同じ列に当たる見出しが重複しています: ', 'Headers name the same column twice: '),
  preview: L('事前確認', 'Preview'),
  previewing: L('確認中…', 'Checking…'),
  execute: L('取り込む', 'Import'),
  executing: L('取込中…', 'Importing…'),
  needPreview: L('先に事前確認をしてください。', 'Run the preview first.'),
  fixErrors: L('エラーと問題を直してから取り込めます。', 'Fix the errors and issues before importing.'),
  confirmTitle: L('取り込みますか？', 'Import now?'),
  confirmHelp: L(
    '事前確認と同じ内容を確定します。直すときは取消と再取込で行います（確定した伝票は編集できません）。',
    'This posts what the preview showed. Corrections are a cancel and a re-import (posted documents are never edited).',
  ),
  previewTitle: L('事前確認の結果', 'Preview result'),
  resultTitle: L('取込の結果', 'Import result'),
  nothingKept: L(
    '何も取り込んでいません（事前確認の後に状態が変わりました）。理由を確かめてやり直してください。',
    'Nothing was imported (something changed after the preview). Check the reasons and try again.',
  ),
  accepted: L('受付', 'Accepted'),
  clearingRows: L('仮勘定へ', 'To clearing'),
  skipped: L('スキップ', 'Skipped'),
  errors: L('エラー', 'Errors'),
  clearingChange: L('期首残高仮勘定の残高', 'Clearing account balance'),
  issues: L('取り込めない理由', 'Why it cannot be imported'),
  notices: L('お知らせ', 'Notices'),
  errorsOnly: L('エラーの行だけ表示', 'Show error rows only'),
  line: L('行番号', 'Row'),
  rowStatus: L('状態', 'Status'),
  reason: L('理由', 'Reason'),
  noErrors: L('エラーの行はありません。', 'No error rows.'),
  firstRows: L(`先頭 ${PREVIEW_ROWS} 行だけ表示しています。`, `Only the first ${PREVIEW_ROWS} rows are shown.`),
  errorCsv: L('エラーの行を CSV でダウンロード', 'Download error rows as CSV'),
  created: L('作成した伝票', 'Created documents'),
  previewDone: L('事前確認が終わりました', 'The preview is done'),
  importDone: L('取り込みました', 'Imported'),
};
const STATUS: Record<'ok' | 'clearing' | 'skipped' | 'error', { label: Label; tone: BadgeTone }> = {
  ok: { label: L('受付', 'Accepted'), tone: 'success' },
  clearing: { label: L('仮勘定へ', 'To clearing'), tone: 'accent' },
  skipped: { label: L('スキップ', 'Skipped'), tone: 'neutral' },
  error: { label: L('エラー', 'Error'), tone: 'danger' },
};
const DOC_ROUTE: Record<string, string> = {
  journal_entry: 'journal_entry',
  sales_invoice: 'sales_invoice',
  purchase_invoice: 'purchase_invoice',
  stock_entry: 'stock_entry',
};

export function OpeningBalancesPage() {
  const { t } = useLocale();
  const meta = useMeta();
  if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  // AC-31: the navigation hides the screen without the action; a direct URL explains instead of failing.
  if (!meta.data.actions.some((a) => a.name === OPENING_STATUS_ACTION))
    return (
      <div className="workspace-page">
        <EmptyState
          titleAs="h1"
          title={t(T.noAccess)}
          description={t(T.noAccessHelp)}
          action={
            <Link to="/" className={buttonClass()}>
              {t(T.home)}
            </Link>
          }
        />
      </div>
    );
  return <OpeningBalances key={financeIdentity()} meta={meta.data} />;
}

function OpeningBalances({ meta }: { meta: AppMeta }) {
  const { t } = useLocale();
  const search = useSearch({ from: '/app/finance/opening' });
  const status = useOpeningStatus(search.fiscalYearId);
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const reason = status.isError && isApiError(status.error) ? status.error.details?.reason : undefined;
  if (reason === 'no_fiscal_year')
    return (
      <div className="workspace-page">
        <EmptyState
          titleAs="h1"
          title={t(T.noYear)}
          description={t(T.noYearHelp)}
          testId="opening-no-year"
          action={
            meta.actions.some((a) => a.name === OPEN_FISCAL_YEAR_ACTION) ? (
              <Link to="/a/$action" params={{ action: OPEN_FISCAL_YEAR_ACTION }} className={buttonClass('primary')}>
                {t(T.openYear)}
              </Link>
            ) : null
          }
        />
      </div>
    );
  if (status.isError) return <MetaError error={status.error} retry={() => void status.refetch()} />;
  const data = status.data;
  return (
    <div className="flex min-w-0 flex-col gap-3 p-3" data-testid="opening-page">
      <PageHeader title={t(T.title)} subtitle={t(T.subtitle)} titleTestId="opening-title" />
      {data ? (
        <>
          <YearPicker data={data} />
          <StatusCard data={data} meta={meta} headingRef={statusHeading} />
          <p className="text-sm text-text-secondary">{t(T.order)}</p>
          <Card>
            <FormSection landmark title={t(T.step1)} description={t(T.step1Help)}>
              <SectionImport key={`${data.selected.id}:journal`} section="journal" data={data} meta={meta} />
            </FormSection>
          </Card>
          <Card>
            <FormSection landmark title={t(T.step2)} description={t(T.step2Help)}>
              <div className="flex flex-col gap-6">
                <SectionImport
                  key={`${data.selected.id}:receivables`}
                  section="receivables"
                  title={t(T.receivables)}
                  data={data}
                  meta={meta}
                />
                <SectionImport
                  key={`${data.selected.id}:payables`}
                  section="payables"
                  title={t(T.payables)}
                  data={data}
                  meta={meta}
                />
              </div>
            </FormSection>
          </Card>
          <Card>
            <FormSection landmark title={t(T.step3)} description={t(T.step3Help)}>
              <SectionImport key={`${data.selected.id}:stock`} section="stock" data={data} meta={meta} />
            </FormSection>
          </Card>
        </>
      ) : (
        <SkeletonCard />
      )}
    </div>
  );
}

/** AC-32: the year choice, kept in `?fiscalYearId=` (replace). */
function YearPicker({ data }: { data: OpeningBalanceStatus }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const id = useId();
  return (
    <Card>
      <FormSection title={t(T.year)} description={t(T.yearHelp)}>
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-sm font-semibold text-text-secondary">
            {t(T.year)}
          </label>
          <select
            id={id}
            className="input w-full sm:max-w-md"
            data-testid="opening-year"
            value={data.selected.id}
            onChange={(e) =>
              void navigate({ to: '/finance/opening', search: { fiscalYearId: e.target.value }, replace: true })
            }
          >
            {data.years.map((y) => (
              <option key={y.id} value={y.id}>
                {`${y.code}（${y.startDate}〜${y.endDate}）`}
              </option>
            ))}
          </select>
        </div>
      </FormSection>
    </Card>
  );
}

function CountLink({
  entity,
  label,
  where,
  date,
  readable,
}: {
  entity: string;
  label: Label;
  where: Record<string, unknown>;
  date: string;
  readable: boolean;
}) {
  const { t } = useLocale();
  const count = useOpeningCount(entity, where, readable);
  if (!readable) return null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-0 flex-1 basis-48 text-sm">{t(label)}</span>
      <Badge tone="neutral" data-testid={`opening-count-${entity}`}>
        {count.data ? String(count.data.total) : '…'}
      </Badge>
      <Link
        to="/e/$entity"
        params={{ entity }}
        search={{ status: 'submitted', from: date, to: date }}
        className="ui-link"
        aria-label={`${t(T.openList)}（${t(label)}）`}
      >
        {t(T.openList)}
      </Link>
    </li>
  );
}

/** AC-32 / AC-37: opening date, why the year cannot take balances, the journal, the clearing account and the documents. */
function StatusCard({
  data,
  meta,
  headingRef,
}: {
  data: OpeningBalanceStatus;
  meta: AppMeta;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const year = data.selected;
  const entry = year.entry;
  const balance = data.clearing.balance;
  const canReverse = meta.actions.some((a) => a.name === OPENING_REVERSE_ACTION);
  const readable = (entity: string) => meta.entities.some((e) => e.name === entity && e.ops.includes('read'));
  const reverse = async () => {
    setBusy(true);
    try {
      await reverseOpeningJournal(year.id);
      toast.success(t(T.reversedDone));
      setConfirm(false);
      await qc.invalidateQueries({ queryKey: ['finance', financeIdentity()] });
      headingRef.current?.focus();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="opening-status">
      <div className="flex flex-col gap-3 p-1">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-text-heading">
          {t(T.status)} · {year.code}
        </h2>
        <p className="text-sm">
          {t(T.openingDate)}:{' '}
          <span className="font-mono tabular-nums" data-testid="opening-date">
            {year.openingDate}
          </span>
        </p>
        {year.reason ? (
          <div className="ui-notice ui-notice-warning" data-testid="opening-year-reason">
            <p>{t(YEAR_REASON_TEXT[year.reason] ?? L(year.reason, year.reason))}</p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="opening-journal-status">
          <span className="text-sm font-semibold">{t(T.journal)}:</span>
          {entry ? (
            <>
              <Link to="/e/$entity/$id" params={{ entity: 'journal_entry', id: entry.id }} className="ui-link">
                {entry.number ?? entry.id}
              </Link>
              <span className="text-sm font-mono tabular-nums">
                {formatDecimal(entry.debit)} / {formatDecimal(entry.credit)}
              </span>
              {canReverse && !year.reason ? (
                <Button size="sm" variant="danger" onClick={() => setConfirm(true)} disabled={busy}>
                  {t(T.reverse)}
                </Button>
              ) : null}
            </>
          ) : (
            <Badge tone="neutral">{t(T.notImported)}</Badge>
          )}
          {year.reversedCount > 0 ? (
            <span className="text-xs text-text-secondary">
              {t(T.reversed)}: {year.reversedCount}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1" data-testid="opening-clearing">
          <p className="text-sm">
            <span className="font-semibold">{t(T.clearing)}</span>{' '}
            <span className="ui-code">
              {data.clearing.code}
              {data.clearing.name ? ` ${data.clearing.name}` : ''}
            </span>
            {balance !== null ? (
              <>
                {': '}
                <span className="font-mono tabular-nums" data-testid="opening-clearing-balance">
                  {formatDecimal(balance)}
                </span>
              </>
            ) : null}
          </p>
          {!data.clearing.ok ? (
            <div className="ui-notice ui-notice-danger">
              <p>{data.clearing.message}</p>
            </div>
          ) : balance !== null && balance !== '0' ? (
            <div className="ui-notice ui-notice-warning" data-testid="opening-clearing-warning">
              <p>{t(T.clearingOff)}</p>
              {data.clearing.lines.length ? (
                <ul className="list-disc pl-5 text-sm">
                  {data.clearing.lines.map((l, i) => (
                    <li key={i} className="break-words">
                      {l.memo ?? ''} {l.debit !== '0' ? `+${formatDecimal(l.debit)}` : `−${formatDecimal(l.credit)}`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : balance === '0' ? (
            <p className="text-sm text-text-secondary">{t(T.clearingZero)}</p>
          ) : null}
          {data.clearing.foreignPostings > 0 ? (
            <p className="text-sm text-warning-on-soft">
              {t(T.clearingUsed)} ({data.clearing.foreignPostings})
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t(T.documents)}</h3>
          <ul className="flex flex-col gap-2">
            <CountLink
              entity="sales_invoice"
              label={T.salesInvoices}
              where={{ openingBalance: true, docstatus: 1, date: year.openingDate }}
              date={year.openingDate}
              readable={readable('sales_invoice')}
            />
            <CountLink
              entity="purchase_invoice"
              label={T.purchaseInvoices}
              where={{ openingBalance: true, docstatus: 1, date: year.openingDate }}
              date={year.openingDate}
              readable={readable('purchase_invoice')}
            />
            <CountLink
              entity="stock_entry"
              label={T.stockEntries}
              where={{ sourceEntity: 'fiscal_year', sourceId: year.id, docstatus: 1 }}
              date={year.openingDate}
              readable={readable('stock_entry')}
            />
          </ul>
          <p className="text-xs text-text-secondary">{t(T.docsHelp)}</p>
        </div>
      </div>
      {confirm ? (
        <Dialog
          title={t(T.reverseTitle)}
          description={t(T.reverseHelp)}
          closeLabel={t(S.close)}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Button onClick={() => setConfirm(false)}>{t(S.cancel)}</Button>
              <Button variant="danger" onClick={() => void reverse()} disabled={busy} data-autofocus>
                {t(T.reverse)}
              </Button>
            </>
          }
        />
      ) : null}
    </Card>
  );
}

interface LoadedFile {
  name: string;
  encoding: CsvEncoding;
  table: CsvTable;
  rows: Record<string, string | null>[];
}

/** AC-33..AC-36: one file of one section — template, file, preview, import, result. */
function SectionImport({
  section,
  title,
  data,
  meta,
}: {
  section: OpeningSection;
  title?: string;
  data: OpeningBalanceStatus;
  meta: AppMeta;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [file, setFile] = useState<LoadedFile>();
  const [fileError, setFileError] = useState<string>();
  const [preview, setPreview] = useState<OpeningImportResult>();
  const [done, setDone] = useState<OpeningImportResult>();
  const [pending, setPending] = useState<'dry-run' | 'execute'>();
  const [confirm, setConfirm] = useState(false);
  const [announce, setAnnounce] = useState('');
  const generation = useRef(0);
  const blocked = sectionBlocked(section, meta);
  const yearBlocked = data.selected.reason !== null;
  const reset = () => {
    generation.current++;
    setPreview(undefined);
    setDone(undefined);
    setAnnounce('');
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    reset();
    const mine = generation.current;
    setFile(undefined);
    setFileError(undefined);
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    if (chosen.size > MAX_FILE_BYTES) return setFileError(t(T.tooLarge));
    try {
      const decoded = decodeCsvBytes(new Uint8Array(await chosen.arrayBuffer()));
      if (mine !== generation.current) return;
      if (decoded.text.includes('\0')) return setFileError(t(T.binary));
      const table = csvTable(parseCsv(decoded.text));
      if (!table.headers.length || !table.rows.length) return setFileError(t(T.emptyFile));
      if (table.rows.length > OPENING_MAX_ROWS[section])
        return setFileError(`${t(T.tooMany)}${OPENING_MAX_ROWS[section].toLocaleString()}`);
      if (table.wide.length) return setFileError(`${t(T.wide)}${table.wide.slice(0, 10).join(', ')}`);
      const match = matchHeaders(table.headers, section);
      if (!match.ok) {
        const parts = [
          match.missing.length ? `${t(T.missing)}${match.missing.map((c) => t(c.label)).join(', ')}` : '',
          match.unknown.length ? `${t(T.unknown)}${match.unknown.join(', ')}` : '',
          match.duplicate.length ? `${t(T.duplicate)}${match.duplicate.join(', ')}` : '',
        ];
        return setFileError(parts.filter(Boolean).join(' / '));
      }
      const rows = requestRows(table, match.fields);
      if (requestBytes({ fiscalYearId: data.selected.id, mode: 'execute', rows }) > OPENING_MAX_BYTES)
        return setFileError(t(T.tooLarge));
      setFile({ name: chosen.name, encoding: decoded.encoding, table, rows });
    } catch (e) {
      setFileError(e instanceof CsvParseError ? `${t(T.quote)}${e.line}` : t(T.binary));
    }
  };

  const send = async (mode: 'dry-run' | 'execute') => {
    if (!file || pending) return;
    const mine = generation.current;
    setPending(mode);
    try {
      const result = await runOpeningImport(section, { fiscalYearId: data.selected.id, mode, rows: file.rows });
      if (mine !== generation.current) return;
      if (mode === 'dry-run') {
        setDone(undefined);
        setPreview(result);
        setAnnounce(t(T.previewDone));
      } else {
        setConfirm(false);
        setPreview(undefined);
        setDone(result);
        setAnnounce(t(T.importDone));
        await qc.invalidateQueries({ queryKey: openingStatusKey(data.selected.id) });
        await qc.invalidateQueries({ queryKey: ['finance', financeIdentity()] });
      }
    } catch (e) {
      setConfirm(false);
      toast.error(e);
    } finally {
      setPending(undefined);
    }
  };

  const disabled = blocked !== undefined || yearBlocked;
  const executeReason = !preview
    ? t(T.needPreview)
    : preview.summary.errors > 0 || preview.issues.length > 0
      ? t(T.fixErrors)
      : '';
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid={`opening-section-${section}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {title ? <h3 className="text-base font-semibold text-text-heading">{title}</h3> : <span />}
        <Button
          size="sm"
          onClick={() =>
            saveBlob(
              new Blob([templateCsv(section, locale)], { type: 'text/csv;charset=utf-8' }),
              templateFilename(section),
            )
          }
        >
          {t(T.template)}
        </Button>
      </div>
      {blocked ? (
        <p className="ui-notice ui-notice-info text-sm" data-testid={`opening-blocked-${section}`}>
          {t(blocked)}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-file`} className="text-sm font-medium">
          {title ? `${title} — ${t(T.file)}` : t(T.file)}
        </label>
        <span className="text-xs text-text-secondary">{t(T.fileHelp)}</span>
        <input
          id={`${id}-file`}
          data-testid={`opening-file-${section}`}
          type="file"
          accept=".csv,text/csv"
          className="max-w-full text-sm"
          disabled={disabled}
          aria-describedby={fileError ? `${id}-file-error` : undefined}
          onClick={(e) => {
            e.currentTarget.value = '';
          }}
          onChange={(e) => void choose(e)}
        />
        {file ? (
          <p className="text-sm text-text-secondary">
            <span className="break-all">{file.name}</span> · {t(T.encoding)}: {ENCODING[file.encoding]} ·{' '}
            <span className="font-mono tabular-nums">{file.table.rows.length}</span> {t(T.rows)}
          </p>
        ) : null}
        {fileError ? (
          <p
            id={`${id}-file-error`}
            role="alert"
            className="text-sm break-words text-danger-text"
            data-testid={`opening-file-error-${section}`}
          >
            {fileError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void send('dry-run')} disabled={!file || disabled || pending !== undefined}>
          {t(pending === 'dry-run' ? T.previewing : T.preview)}
        </Button>
        <Button
          variant="primary"
          onClick={() => setConfirm(true)}
          disabled={disabled || !file || executeReason !== '' || pending !== undefined}
          aria-describedby={executeReason ? `${id}-execute-reason` : undefined}
          data-testid={`opening-execute-${section}`}
        >
          {t(pending === 'execute' ? T.executing : T.execute)}
        </Button>
        {file && executeReason ? (
          <span id={`${id}-execute-reason`} className="text-sm text-text-secondary">
            {executeReason}
          </span>
        ) : null}
      </div>
      {preview && file ? <ResultView section={section} result={preview} file={file} /> : null}
      {done && file ? <ResultView section={section} result={done} file={file} executed /> : null}
      {confirm ? (
        <Dialog
          title={t(T.confirmTitle)}
          description={t(T.confirmHelp)}
          closeLabel={t(S.close)}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Button onClick={() => setConfirm(false)}>{t(S.cancel)}</Button>
              <Button
                variant="primary"
                onClick={() => void send('execute')}
                disabled={pending !== undefined}
                data-autofocus
                data-testid={`opening-confirm-${section}`}
              >
                {t(pending === 'execute' ? T.executing : T.execute)}
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  );
}

/** AC-35 / AC-36: counts, totals, clearing balance, issues, notices, rows and the error CSV (preview or result). */
function ResultView({
  section,
  result,
  file,
  executed = false,
}: {
  section: OpeningSection;
  result: OpeningImportResult;
  file: LoadedFile;
  executed?: boolean;
}) {
  const { t, locale } = useLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  const tableId = useId();
  const [errorsOnly, setErrorsOnly] = useState(executed && result.summary.errors > 0);
  // A layout effect: it runs right after the confirm dialog's cleanup, so focus lands here and not back on the
  // (now disabled) "Import" button the dialog would otherwise return it to (AC-36).
  useLayoutEffect(() => {
    if (executed) heading.current?.focus();
  }, [executed, result]);
  const rows = errorsOnly ? result.rows.filter((r) => r.status === 'error') : result.rows;
  const shown = rows.slice(0, PREVIEW_ROWS);
  const downloadErrors = () =>
    saveBlob(
      new Blob([errorCsv(section, file.table, result, locale)], { type: 'text/csv;charset=utf-8' }),
      `opening-${section}-errors.csv`,
    );
  const counts: [Label, number][] = [
    [T.accepted, result.summary.accepted],
    ...(section === 'journal' ? ([[T.clearingRows, result.summary.clearing]] as [Label, number][]) : []),
    [T.skipped, result.summary.skipped],
    [T.errors, result.summary.errors],
  ];
  return (
    <section
      className="flex min-w-0 flex-col gap-2 rounded-md border border-border-subtle p-3"
      data-testid={executed ? `opening-result-${section}` : `opening-preview-${section}`}
      aria-labelledby={`${tableId}-heading`}
    >
      <h4 id={`${tableId}-heading`} ref={heading} tabIndex={-1} className="text-base font-semibold text-text-heading">
        {t(executed ? T.resultTitle : T.previewTitle)}
      </h4>
      {executed && !result.committed ? (
        <p className="text-sm text-danger-text" data-testid={`opening-not-committed-${section}`}>
          {t(T.nothingKept)}
        </p>
      ) : null}
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {counts.map(([label, n]) => (
          <div key={label.en} className="flex gap-2">
            <dt className="text-text-secondary">{t(label)}</dt>
            <dd className="font-mono tabular-nums">{n}</dd>
          </div>
        ))}
        {totalsList(section, result).map((item) => (
          <div key={item.label.en} className="flex gap-2">
            <dt className="text-text-secondary">{t(item.label)}</dt>
            <dd className="font-mono tabular-nums" data-testid={`opening-total-${section}-${item.label.en}`}>
              {formatDecimal(item.value)}
            </dd>
          </div>
        ))}
        {result.clearingBalance ? (
          <div className="flex gap-2">
            <dt className="text-text-secondary">{t(T.clearingChange)}</dt>
            <dd className="font-mono tabular-nums" data-testid={`opening-clearing-change-${section}`}>
              {formatDecimal(result.clearingBalance.before)} → {formatDecimal(result.clearingBalance.after)}
            </dd>
          </div>
        ) : null}
      </dl>
      {result.clearingAccounts?.length ? (
        <p className="text-sm text-text-secondary break-words">
          {t(T.clearingMoved)}:{' '}
          {result.clearingAccounts
            .map(
              (a) =>
                `${a.code} ${a.name} ${a.debit !== '0' ? `+${formatDecimal(a.debit)}` : `−${formatDecimal(a.credit)}`}`,
            )
            .join(' / ')}
        </p>
      ) : null}
      {result.issues.length ? (
        <div className="ui-notice ui-notice-danger" data-testid={`opening-issues-${section}`}>
          <p className="font-semibold">{t(T.issues)}</p>
          <ul className="list-disc pl-5 text-sm">
            {result.issues.map((m, i) => (
              <li key={i} className="break-words">
                {messageLine(section, m, locale)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.notices.length ? (
        <div className="ui-notice ui-notice-info">
          <p className="font-semibold">{t(T.notices)}</p>
          <ul className="list-disc pl-5 text-sm">
            {result.notices.map((m, i) => (
              <li key={i} className="break-words">
                {messageLine(section, m, locale)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {executed && result.documents.length ? (
        <div className="text-sm">
          <span className="text-text-secondary">{t(T.created)}: </span>
          <ul className="inline-flex flex-wrap gap-x-3">
            {result.documents.slice(0, 20).map((d) => (
              <li key={d.id}>
                <Link
                  to="/e/$entity/$id"
                  params={{ entity: DOC_ROUTE[d.entity] ?? d.entity, id: d.id }}
                  className="ui-link"
                >
                  {d.number ?? d.id}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <label className="flex w-max items-center gap-2 text-sm" htmlFor={`${tableId}-errors`}>
        <input
          id={`${tableId}-errors`}
          type="checkbox"
          checked={errorsOnly}
          onChange={(e) => setErrorsOnly(e.target.checked)}
        />
        {t(T.errorsOnly)}
      </label>
      <DataTableShell
        label={t(executed ? T.resultTitle : T.previewTitle)}
        columnCount={3}
        testId={`opening-rows-${section}`}
        isEmpty={shown.length === 0}
        empty={<EmptyState title={t(T.noErrors)} testId={`opening-no-error-rows-${section}`} />}
        head={
          <tr>
            <th scope="col" className="ui-cell-num">
              {t(T.line)}
            </th>
            <th scope="col">{t(T.rowStatus)}</th>
            <th scope="col" className="min-w-64">
              {t(T.reason)}
            </th>
          </tr>
        }
      >
        {shown.map((row) => (
          <tr key={row.line} data-testid="opening-row" data-status={row.status}>
            <td className="ui-cell-num">{fileLine(file.table, row.line)}</td>
            <td>
              <Badge tone={STATUS[row.status].tone}>{t(STATUS[row.status].label)}</Badge>
            </td>
            <td className="min-w-64 whitespace-pre-line break-words">
              {(row.messages ?? []).map((m) => messageLine(section, m, locale)).join('\n')}
            </td>
          </tr>
        ))}
      </DataTableShell>
      {rows.length > PREVIEW_ROWS ? <p className="text-xs text-text-secondary">{t(T.firstRows)}</p> : null}
      {result.summary.errors > 0 ? (
        <div>
          <Button size="sm" onClick={downloadErrors} data-testid={`opening-error-csv-${section}`}>
            {t(T.errorCsv)}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
