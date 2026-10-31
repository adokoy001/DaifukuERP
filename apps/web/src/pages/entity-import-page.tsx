// /e/:entity/import — CSV import of a master entity (docs/specs/csv-import.md AC-11..AC-14): choose a file (UTF-8 with or
// without BOM, or Shift_JIS), map its columns to fields, preview with a dry-run, execute, and download the failed rows.
// Built on the UI kit; every write goes through the derived <entity>.import action (POST /api/:entity/import).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { downloadImportTemplate, runImport } from '../api/import.ts';
import { useEntityMeta } from '../api/queries.ts';
import type { EntityMeta, FieldMeta, Label } from '../api/types.ts';
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
import { filenameFromDisposition, saveBlob } from '../lib/download.ts';
import {
  autoMapColumns,
  checkMapping,
  errorCsv,
  importableFields,
  importRows,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  messageText,
  requestBytes,
  type ColumnMapping,
  type ImportRequest,
  type ImportResult,
  type ImportRowResult,
  type OnExisting,
} from '../lib/import-map.ts';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  DataTableShell,
  EmptyState,
  FormSection,
  PageHeader,
  type BadgeTone,
} from '../ui/index.ts';
import { EntityMissing, LoadingView, MetaError } from './status-views.tsx';

const L = (ja: string, en: string): Label => ({ ja, en });
const T = {
  title: L('の取込', ' — import'),
  subtitle: L(
    'CSV ファイルの各行を 1 件として登録します。事前確認では何も変更しません。',
    'Each CSV row becomes one record. The preview changes nothing.',
  ),
  template: L('雛形をダウンロード', 'Download template'),
  fileStep: L('1. ファイルを選ぶ', '1. Choose a file'),
  fileHelp: L(
    'UTF-8（BOM の有無を問わない）または Shift_JIS の CSV。1 行目は見出し。最大 5,000 行。',
    'A UTF-8 (with or without BOM) or Shift_JIS CSV. The first row is the header. At most 5,000 rows.',
  ),
  fileLabel: L('CSV ファイル', 'CSV file'),
  encoding: L('文字コード', 'Encoding'),
  rows: L('行', 'rows'),
  mapStep: L('2. 列と項目の対応', '2. Match columns to fields'),
  mapHelp: L(
    '見出しが項目名と一致した列は自動で対応しています。対応しない列は取り込みません。',
    'Columns whose header matches a field are matched automatically. Unmatched columns are not imported.',
  ),
  sample: L('1 行目の値', 'First row'),
  ignore: L('取り込まない', 'Do not import'),
  required: L('必須', 'required'),
  duplicate: L('同じ項目に複数の列を対応させています: ', 'Several columns are matched to the same field: '),
  missing: L('必須の項目に対応する列がありません: ', 'No column for required fields: '),
  noneMapped: L('取り込む列を 1 つ以上選んでください。', 'Match at least one column to a field.'),
  optionsStep: L('3. 取込の方法', '3. How to import'),
  existing: L('同じキーの記録が既にあるとき', 'When a record with the same key exists'),
  keyNote: L(
    'キーは一意な項目（例: コード）です。キーの列が無いファイルは照合せず、すべて新規として扱います。',
    'The key is a unique field such as the code. Without a key column, every row is treated as new.',
  ),
  skip: L('変更しない（スキップ）', 'Leave it (skip)'),
  update: L('この行の値で更新する', 'Update it with this row'),
  error: L('エラーにする', 'Report an error'),
  atomic: L('1 行でもエラーがあれば何も取り込まない', 'Import nothing if any row fails'),
  preview: L('事前確認', 'Preview'),
  previewing: L('確認中…', 'Checking…'),
  previewStep: L('4. 事前確認の結果', '4. Preview'),
  errorsOnly: L('エラーの行だけ表示', 'Show only rows with errors'),
  firstRows: L('先頭 50 行を表示しています。', 'Showing the first 50 rows.'),
  allInCsv: L(
    'エラーの行はすべて「エラーの行を CSV でダウンロード」で確認できます。',
    ' Every failed row is in “Download failed rows as CSV”.',
  ),
  noErrors: L('エラーの行はありません', 'No rows with errors'),
  key: L('照合キー', 'Matching key'),
  noKey: L(
    'キーの列が無いため、既存の記録とは照合せず、すべて新規として扱います。',
    'There is no key column, so rows are not matched with existing records: every row is treated as new.',
  ),
  line: L('行', 'Line'),
  status: L('状態', 'Status'),
  record: L('内容', 'Record'),
  reason: L('理由', 'Reason'),
  ignored: L('取り込まない列', 'Ignored columns'),
  willSkipErrors: L(
    'エラーの行は取り込まれません。それ以外の行を取り込みます。',
    'Rows with errors are not imported; the other rows are.',
  ),
  atomicBlocked: L(
    'エラーがあるため、実行しても何も取り込まれません。',
    'Because some rows fail, executing imports nothing.',
  ),
  execute: L('取り込む', 'Import'),
  executing: L('取り込み中…', 'Importing…'),
  resultTitle: L('取込の結果', 'Import result'),
  nothingKept: L('エラーがあったため、何も取り込んでいません。', 'Nothing was imported because some rows failed.'),
  errorCsv: L('エラーの行を CSV でダウンロード', 'Download failed rows as CSV'),
  backToList: L('一覧へ戻る', 'Back to the list'),
  notImportable: L('この画面からは取り込めません', 'This cannot be imported here'),
  notImportableHelp: L(
    '取込は登録権限のあるマスタだけが対象です。伝票は伝票の画面から入力します。',
    'Import covers masters you may create. Documents are entered on their own screens.',
  ),
  emptyFile: L('見出しとデータの行がある CSV を選んでください。', 'Choose a CSV with a header and data rows.'),
  tooMany: L('5,000 行を超えています。ファイルを分けてください。', 'More than 5,000 rows. Split the file.'),
  tooLarge: L(
    '送信する内容が 2 MB を超えます。ファイルを分けてください。',
    'The request would exceed 2 MB. Split the file.',
  ),
  binary: L('CSV として読めないファイルです。', 'This file cannot be read as CSV.'),
  quote: L('引用符（"）が閉じていません。行: ', 'An opening quote (") is never closed. Line: '),
  wide: L(
    '見出しより多くのセルがある行があります（引用符で囲んでいないカンマなど）。値が別の項目にずれるため、カンマを含むセルを " で囲んでから選び直してください。データ行: ',
    'Some rows have more cells than the header (an unquoted comma, for example), which would shift values into other fields. Wrap cells containing commas in double quotes and choose the file again. Data rows: ',
  ),
  andMore: L(' ほか', ' and'),
  moreRows: L(' 行', ' more'),
  previewDone: L('事前確認が終わりました。', 'Preview finished.'),
  importDone: L('取込が終わりました。', 'Import finished.'),
};
const ENCODING: Record<CsvEncoding, string> = { 'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8 (BOM)', shift_jis: 'Shift_JIS' };
const STATUS: Record<ImportRowResult['status'], { preview: Label; done: Label; tone: BadgeTone }> = {
  created: { preview: L('作成予定', 'To create'), done: L('作成', 'Created'), tone: 'success' },
  updated: { preview: L('更新予定', 'To update'), done: L('更新', 'Updated'), tone: 'accent' },
  skipped: { preview: L('スキップ', 'Skip'), done: L('スキップ', 'Skipped'), tone: 'neutral' },
  error: { preview: L('エラー', 'Error'), done: L('エラー', 'Error'), tone: 'danger' },
};
const PREVIEW_ROWS = 50;
/** A file this large is not a 5,000-row master list; refuse it before decoding. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Row numbers listed in a file error before "and N more". */
const LISTED_LINES = 10;

interface LoadedFile {
  name: string;
  encoding: CsvEncoding;
  table: CsvTable;
}

/** What the preview and result cards read: the loaded file, its mapping and the entity's importable fields. */
interface ImportViewState {
  file: LoadedFile;
  mapping: ColumnMapping;
  entity: EntityMeta;
  fields: FieldMeta[];
}

/** Kept as a label (plus row numbers) and translated while rendering, so a language switch applies to it too. */
interface FileError {
  label: Label;
  lines?: number[];
}

function Summary({ result, done }: { result: ImportResult; done: boolean }) {
  const { t } = useLocale();
  const items: [ImportRowResult['status'], number][] = [
    ['created', result.summary.created],
    ['updated', result.summary.updated],
    ['skipped', result.summary.skipped],
    ['error', result.summary.errors],
  ];
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="import-summary">
      {items.map(([status, n]) => (
        <div key={status} className="flex items-center gap-1" data-status={status}>
          <dt>
            <Badge tone={STATUS[status].tone}>{t(done ? STATUS[status].done : STATUS[status].preview)}</Badge>
          </dt>
          <dd className="font-mono tabular-nums">{n}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * `done`: the rows were kept (past-tense labels). A dry-run and a rolled-back atomic run use the "to create" labels: their
 * statuses say what would have happened. An executed run opens on its errors.
 */
function ResultTable({ result, view, done }: { result: ImportResult; view: ImportViewState; done: boolean }) {
  const { file, mapping, entity, fields } = view;
  const { t, locale } = useLocale();
  const executed = result.mode === 'execute';
  const [errorsOnly, setErrorsOnly] = useState(executed && result.summary.errors > 0);
  const id = useId();
  const filtered = errorsOnly ? result.rows.filter((r) => r.status === 'error') : result.rows;
  const shown = filtered.slice(0, PREVIEW_ROWS);
  // What identifies the row to a person: the key column and the display column when the file has them.
  const columns = [result.keyField, entity.displayField]
    .map((field) => (field ? mapping.indexOf(field) : -1))
    .filter((i, n, all) => i >= 0 && all.indexOf(i) === n);
  const identify = (row: ImportRowResult) => {
    const record = file.table.rows[row.line - 1] ?? [];
    const picked = columns.length ? columns : mapping.flatMap((f, i) => (f ? [i] : [])).slice(0, 2);
    return picked.map((i) => record[i] ?? '').join(' / ');
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="flex w-max items-center gap-2 text-sm" htmlFor={`${id}-errors`}>
        <input
          id={`${id}-errors`}
          type="checkbox"
          checked={errorsOnly}
          onChange={(e) => setErrorsOnly(e.target.checked)}
        />
        {t(T.errorsOnly)}
      </label>
      <DataTableShell
        label={t(executed ? T.resultTitle : T.previewStep)}
        columnCount={4}
        testId={executed ? 'import-result-table' : 'import-preview-table'}
        isEmpty={shown.length === 0}
        empty={<EmptyState title={t(T.noErrors)} testId="import-no-error-rows" />}
        head={
          <tr>
            <th scope="col" className="ui-cell-num">
              {t(T.line)}
            </th>
            <th scope="col">{t(T.status)}</th>
            <th scope="col">{t(T.record)}</th>
            <th scope="col" className="min-w-64">
              {t(T.reason)}
            </th>
          </tr>
        }
      >
        {shown.map((row) => (
          <tr key={row.line} data-testid="import-row" data-status={row.status}>
            <td className="ui-cell-num">{file.table.lines[row.line - 1] ?? row.line}</td>
            <td>
              <Badge tone={STATUS[row.status].tone}>
                {t(done ? STATUS[row.status].done : STATUS[row.status].preview)}
              </Badge>
            </td>
            <td className="min-w-32">{identify(row)}</td>
            <td className="min-w-64 whitespace-pre-line">
              {(row.messages ?? []).map((m) => messageText(m, fields, locale)).join('\n')}
            </td>
          </tr>
        ))}
      </DataTableShell>
      {filtered.length > PREVIEW_ROWS ? (
        <p className="text-xs text-text-secondary" data-testid="import-first-rows">
          {t(T.firstRows)}
          {executed ? t(T.allInCsv) : ''}
        </p>
      ) : null}
    </div>
  );
}

/** Columns left unmatched are not sent; the server's notices name columns an API caller sent but the server ignored. */
function ignoredColumns({ file, mapping }: ImportViewState, result: ImportResult): string[] {
  return [
    ...new Set([
      ...file.table.headers.flatMap((h, i) => (mapping[i] ? [] : [h || `#${i + 1}`])),
      ...result.notices.map((n) => n.column),
    ]),
  ];
}

function fieldLabelOf(fields: readonly FieldMeta[], name: string): Label | string {
  return fields.find((f) => f.name === name)?.label ?? name;
}

/** AC-12: step 4 — what the dry-run found (counts, matching key, ignored columns, rows), then "Import". */
function PreviewCard({
  preview,
  view,
  atomic,
  execute,
}: {
  preview: ImportResult;
  view: ImportViewState;
  atomic: boolean;
  execute: { disabled: boolean; pending: boolean; run: () => void };
}) {
  const { t } = useLocale();
  const ignored = ignoredColumns(view, preview);
  const keyLabel = preview.keyField ? fieldLabelOf(view.fields, preview.keyField) : undefined;
  return (
    <Card data-testid="import-preview">
      <FormSection title={t(T.previewStep)}>
        <Summary result={preview} done={false} />
        {keyLabel !== undefined ? (
          <p className="text-sm" data-testid="import-key">
            {t(T.key)}: {typeof keyLabel === 'string' ? keyLabel : t(keyLabel)}
          </p>
        ) : (
          // AC-5: without the key column nothing is matched, whichever "existing record" option is chosen.
          <p className="text-sm text-warning-on-soft" data-testid="import-key">
            {t(T.noKey)}
          </p>
        )}
        {ignored.length ? (
          <p className="text-xs break-words text-text-secondary" data-testid="import-ignored">
            {t(T.ignored)}: {ignored.join(', ')}
          </p>
        ) : null}
        <ResultTable result={preview} view={view} done={false} />
        {preview.summary.errors > 0 ? (
          <p className="text-sm text-warning-on-soft" data-testid="import-error-note">
            {t(atomic ? T.atomicBlocked : T.willSkipErrors)}
          </p>
        ) : null}
        <div>
          <Button variant="primary" disabled={execute.disabled} onClick={execute.run}>
            {t(execute.pending ? T.executing : T.execute)}
          </Button>
        </div>
      </FormSection>
    </Card>
  );
}

/**
 * AC-13: the outcome and the failed rows as CSV. A rolled-back atomic run keeps the "to create" labels next to "nothing
 * was imported". "Import" sat in the preview card this card replaces, so focus moves to this heading, not to <body>.
 */
function ResultCard({ result, view }: { result: ImportResult; view: ImportViewState }) {
  const { t, locale } = useLocale();
  const heading = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [result]);
  const downloadErrors = () => {
    const csv = errorCsv(view.file.table, result, view.fields, locale, { line: T.line, reason: T.reason });
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${view.entity.name}-import-errors.csv`);
  };
  return (
    <Card data-testid="import-result">
      <FormSection
        title={
          <span ref={heading} tabIndex={-1} data-testid="import-result-heading">
            {t(T.resultTitle)}
          </span>
        }
      >
        <Summary result={result} done={result.committed} />
        {!result.committed ? <p className="text-sm text-danger-text">{t(T.nothingKept)}</p> : null}
        {result.summary.errors > 0 ? (
          <>
            <ResultTable result={result} view={view} done={result.committed} />
            <div>
              <Button onClick={downloadErrors}>{t(T.errorCsv)}</Button>
            </div>
          </>
        ) : null}
        <div>
          <Link to="/e/$entity" params={{ entity: view.entity.name }} className={buttonClass()}>
            {t(T.backToList)}
          </Link>
        </div>
      </FormSection>
    </Card>
  );
}

function ImportView({ entity }: { entity: EntityMeta }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const formId = useId();
  const fields = useMemo(() => importableFields(entity), [entity]);
  const [file, setFile] = useState<LoadedFile>();
  const [fileError, setFileError] = useState<FileError>();
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [onExisting, setOnExisting] = useState<OnExisting>('skip');
  const [atomic, setAtomic] = useState(false);
  const [preview, setPreview] = useState<ImportResult>();
  const [done, setDone] = useState<ImportResult>();
  const [announce, setAnnounce] = useState<Label>();
  // Any change of file, mapping or options makes an earlier preview (or a late answer to it) stale.
  const generation = useRef(0);
  const check = useMemo(() => checkMapping(mapping, fields), [mapping, fields]);
  const run = useMutation({ mutationFn: (body: ImportRequest) => runImport(entity.name, body) });
  const invalidate = () => {
    generation.current++;
    setPreview(undefined);
    setDone(undefined);
    setAnnounce(undefined);
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    invalidate();
    const mine = generation.current;
    setFile(undefined);
    setFileError(undefined);
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    if (chosen.size > MAX_FILE_BYTES) return setFileError({ label: T.tooLarge });
    try {
      const decoded = decodeCsvBytes(new Uint8Array(await chosen.arrayBuffer()));
      if (mine !== generation.current) return;
      if (decoded.text.includes('\0')) return setFileError({ label: T.binary });
      const table = csvTable(parseCsv(decoded.text));
      if (!table.headers.length || !table.rows.length) return setFileError({ label: T.emptyFile });
      if (table.rows.length > IMPORT_MAX_ROWS) return setFileError({ label: T.tooMany });
      // A shifted row would import its cells into the wrong fields: refuse the file (csv-parse.ts `wide`).
      if (table.wide.length) return setFileError({ label: T.wide, lines: table.wide });
      setFile({ name: chosen.name, encoding: decoded.encoding, table });
      setMapping(autoMapColumns(table.headers, fields));
    } catch (e) {
      if (e instanceof CsvParseError) setFileError({ label: T.quote, lines: [e.line] });
      else setFileError({ label: T.binary });
    }
  };

  const send = (mode: ImportRequest['mode']) => {
    if (!file || run.isPending || check.duplicates.length > 0 || check.mapped === 0) return;
    const body: ImportRequest = {
      rows: importRows(file.table, mapping),
      mode,
      onExisting,
      ...(atomic ? { atomic: true } : {}),
    };
    if (requestBytes(body) > IMPORT_MAX_BYTES) return setFileError({ label: T.tooLarge });
    setFileError(undefined);
    const mine = generation.current;
    run.mutate(body, {
      onSuccess: async (result) => {
        if (mine !== generation.current) return;
        if (mode === 'dry-run') {
          // A new preview replaces an earlier result: two summaries would contradict each other.
          setDone(undefined);
          setPreview(result);
          setAnnounce(T.previewDone);
          return;
        }
        setPreview(undefined);
        setDone(result);
        setAnnounce(T.importDone);
        await qc.invalidateQueries({ queryKey: ['list', entity.name] });
      },
      onError: (e) => toast.error(e),
    });
  };

  const fileErrorText = (error: FileError) => {
    const lines = error.lines ?? [];
    const listed = lines.slice(0, LISTED_LINES).join(', ');
    const more = lines.length > LISTED_LINES ? `${t(T.andMore)} ${lines.length - LISTED_LINES}${t(T.moreRows)}` : '';
    return `${t(error.label)}${listed}${more}`;
  };

  const template = async () => {
    try {
      const res = await downloadImportTemplate(entity.name, locale);
      saveBlob(res.blob, filenameFromDisposition(res.contentDisposition, `${entity.name}-import-template.csv`));
    } catch (e) {
      toast.error(e);
    }
  };

  const fieldLabel = (name: string) => {
    const f = fields.find((x) => x.name === name);
    return f ? t(f.label) : name;
  };
  const blocked = !file || check.duplicates.length > 0 || check.mapped === 0;
  const pendingMode = run.isPending ? run.variables?.mode : undefined;
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="import-page">
      <PageHeader
        back={
          <Link to="/e/$entity" params={{ entity: entity.name }} className="ui-link w-max">
            ← {t(entity.label)}
          </Link>
        }
        title={`${t(entity.label)}${t(T.title)}`}
        subtitle={t(T.subtitle)}
        meta={<span className="ui-code">{entity.name}</span>}
        actions={<Button onClick={() => void template()}>{t(T.template)}</Button>}
      />
      <p className="sr-only" aria-live="polite">
        {announce ? t(announce) : ''}
      </p>
      <Card>
        <FormSection title={t(T.fileStep)} description={t(T.fileHelp)}>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${formId}-file`} className="text-sm font-medium">
              {t(T.fileLabel)}
            </label>
            <input
              id={`${formId}-file`}
              data-testid="import-file"
              type="file"
              accept=".csv,text/csv"
              className="max-w-full text-sm"
              aria-describedby={fileError ? `${formId}-file-error` : undefined}
              // Browsers fire no change event when the same file is chosen again (e.g. after fixing it): clear first.
              onClick={(e) => {
                e.currentTarget.value = '';
              }}
              onChange={(e) => void choose(e)}
            />
            {file ? (
              <p className="text-sm text-text-secondary" data-testid="import-file-info">
                <span className="break-all">{file.name}</span> · {t(T.encoding)}:{' '}
                <span data-testid="import-encoding">{ENCODING[file.encoding]}</span> ·{' '}
                <span className="font-mono tabular-nums">{file.table.rows.length}</span> {t(T.rows)}
              </p>
            ) : null}
            {fileError ? (
              <p
                id={`${formId}-file-error`}
                role="alert"
                className="text-sm break-words text-danger-text"
                data-testid="import-file-error"
              >
                {fileErrorText(fileError)}
              </p>
            ) : null}
          </div>
        </FormSection>
      </Card>
      {file ? (
        <Card>
          <FormSection title={t(T.mapStep)} description={t(T.mapHelp)}>
            <ul className="flex flex-col gap-2" data-testid="import-mapping">
              {file.table.headers.map((header, i) => (
                <li key={`${i}-${header}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <label htmlFor={`${formId}-col-${i}`} className="min-w-0 flex-1 basis-40 text-sm">
                    <span className="font-medium break-all">{header || `#${i + 1}`}</span>
                    <span className="block truncate text-xs text-text-secondary">
                      {t(T.sample)}: {file.table.rows[0]?.[i] ?? ''}
                    </span>
                  </label>
                  <select
                    id={`${formId}-col-${i}`}
                    className="input min-w-0 flex-1 basis-48"
                    value={mapping[i] ?? ''}
                    onChange={(e) => {
                      invalidate();
                      setMapping((prev) => prev.map((name, j) => (j === i ? e.target.value : name)));
                    }}
                  >
                    <option value="">{t(T.ignore)}</option>
                    {fields.map((f) => (
                      <option key={f.name} value={f.name}>
                        {t(f.label)}
                        {f.required && !f.hasDefault ? ` (${t(T.required)})` : ''}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            {check.duplicates.length ? (
              <p role="alert" className="text-sm text-danger-text">
                {t(T.duplicate)}
                {check.duplicates.map(fieldLabel).join(', ')}
              </p>
            ) : null}
            {check.mapped === 0 ? <p className="text-sm text-danger-text">{t(T.noneMapped)}</p> : null}
            {check.missingRequired.length ? (
              <p className="text-sm text-warning-on-soft" data-testid="import-missing-required">
                {t(T.missing)}
                {check.missingRequired.map((f) => t(f.label)).join(', ')}
              </p>
            ) : null}
          </FormSection>
        </Card>
      ) : null}
      {file ? (
        <Card>
          <FormSection title={t(T.optionsStep)}>
            <fieldset className="flex flex-col gap-1 text-sm">
              <legend className="font-medium">{t(T.existing)}</legend>
              <p className="text-xs text-text-secondary">{t(T.keyNote)}</p>
              {(['skip', 'update', 'error'] as const).map((value) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${formId}-existing`}
                    value={value}
                    checked={onExisting === value}
                    onChange={() => {
                      invalidate();
                      setOnExisting(value);
                    }}
                  />
                  {t(T[value])}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={atomic}
                onChange={(e) => {
                  invalidate();
                  setAtomic(e.target.checked);
                }}
              />
              {t(T.atomic)}
            </label>
            <div>
              <Button
                variant={preview ? 'default' : 'primary'}
                disabled={blocked || run.isPending}
                onClick={() => send('dry-run')}
              >
                {t(pendingMode === 'dry-run' ? T.previewing : T.preview)}
              </Button>
            </div>
          </FormSection>
        </Card>
      ) : null}
      {file && preview ? (
        <PreviewCard
          preview={preview}
          view={{ file, mapping, entity, fields }}
          atomic={atomic}
          execute={{
            disabled: blocked || run.isPending,
            pending: pendingMode === 'execute',
            run: () => send('execute'),
          }}
        />
      ) : null}
      {file && done ? <ResultCard result={done} view={{ file, mapping, entity, fields }} /> : null}
    </div>
  );
}

export function EntityImportPage() {
  const { t } = useLocale();
  const params = useParams({ strict: false }) as { entity?: string };
  const name = params.entity ?? '';
  const { meta, entity } = useEntityMeta(name);
  if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (meta.isPending) return <LoadingView />;
  if (!entity) return <EntityMissing name={name} />;
  const importable =
    entity.ops.includes('create') && (meta.data?.actions ?? []).some((a) => a.name === `${entity.name}.import`);
  if (!importable)
    return (
      <div className="p-3">
        <EmptyState
          titleAs="h1"
          title={t(T.notImportable)}
          description={t(T.notImportableHelp)}
          action={
            <Link to="/e/$entity" params={{ entity: entity.name }} className={buttonClass()}>
              {t(T.backToList)}
            </Link>
          }
        />
      </div>
    );
  return <ImportView key={entity.name} entity={entity} />;
}
