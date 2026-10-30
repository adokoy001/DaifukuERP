// Opening balances screen logic (docs/specs/opening-balances.md AC-31..AC-39): the fixed columns of each section, header
// matching (ja / en headers or field names through headerKey), the request rows, the header-only template, the error
// CSV and the ja/en explanation of every row / issue code. Pure; opening-balances.test.ts.
import type { AppMeta, Label, Locale } from '../api/types.ts';
import type { CsvTable } from './csv-parse.ts';
import { errorExplanation } from './error-view.ts';
import { guardCell, headerKey, unguardCell } from './import-map.ts';

export const OPENING_STATUS_ACTION = 'accounting.opening_balance_status';
export const OPENING_REVERSE_ACTION = 'accounting.reverse_opening_balances';
export const OPEN_FISCAL_YEAR_ACTION = 'accounting.open_fiscal_year';

export type OpeningSection = 'journal' | 'receivables' | 'payables' | 'stock';
export const OPENING_SECTIONS: readonly OpeningSection[] = ['journal', 'receivables', 'payables', 'stock'];

/** Server-side limits (accounting/sales/purchase/inventory import actions); checked here so a file is not sent in vain. */
export const OPENING_MAX_BYTES = 2 * 1024 * 1024;
export const OPENING_MAX_ROWS: Record<OpeningSection, number> = {
  journal: 1000,
  receivables: 200,
  payables: 200,
  stock: 2000,
};

export const SECTION_ACTION: Record<OpeningSection, string> = {
  journal: 'accounting.import_opening_balances',
  receivables: 'sales.import_opening_receivables',
  payables: 'purchase.import_opening_payables',
  stock: 'inventory.import_opening_stock',
};

/** The document each section creates (the list links of AC-32 and the ops check of AC-38). */
export const SECTION_ENTITY: Record<OpeningSection, string> = {
  journal: 'journal_entry',
  receivables: 'sales_invoice',
  payables: 'purchase_invoice',
  stock: 'stock_entry',
};

export interface OpeningColumn {
  field: string;
  label: Label;
  required: boolean;
}

const col = (field: string, ja: string, en: string, required = false): OpeningColumn => ({
  field,
  label: { ja, en },
  required,
});
const INVOICE_COLUMNS: readonly OpeningColumn[] = [
  col('partnerCode', '取引先コード', 'Partner code', true),
  col('amount', '金額', 'Amount', true),
  col('dueDate', '支払期日', 'Due date'),
  col('reference', '元請求書番号', 'Original invoice no.'),
  col('originalDate', '元請求日', 'Original invoice date'),
  col('memo', '備考', 'Memo'),
];

/** AC-33 / AC-34: the fixed columns of each file. */
export const SECTION_COLUMNS: Record<OpeningSection, readonly OpeningColumn[]> = {
  journal: [
    col('accountCode', '科目コード', 'Account code', true),
    col('partnerCode', '取引先コード', 'Partner code'),
    col('debit', '借方', 'Debit', true),
    col('credit', '貸方', 'Credit', true),
    col('memo', '摘要', 'Memo'),
  ],
  receivables: INVOICE_COLUMNS,
  payables: INVOICE_COLUMNS,
  stock: [
    col('warehouseCode', '倉庫コード', 'Warehouse code'),
    col('productCode', '品目コード', 'Product code', true),
    col('quantity', '数量', 'Quantity', true),
    col('unitCost', '単価', 'Unit cost', true),
  ],
};

export type HeaderMatch =
  { ok: true; fields: string[] } | { ok: false; missing: OpeningColumn[]; unknown: string[]; duplicate: string[] };

/** AC-34: each header names one column (field name or ja/en label, compared with headerKey); every required column is present. */
export function matchHeaders(headers: readonly string[], section: OpeningSection): HeaderMatch {
  const columns = SECTION_COLUMNS[section];
  const fields: string[] = [];
  const unknown: string[] = [];
  const duplicate: string[] = [];
  for (const raw of headers) {
    const key = headerKey(unguardCell(raw));
    const column = columns.find((c) => [c.field, c.label.ja, c.label.en].some((name) => headerKey(name) === key));
    if (!column) {
      unknown.push(raw);
      fields.push('');
    } else if (fields.includes(column.field)) {
      duplicate.push(raw);
      fields.push('');
    } else fields.push(column.field);
  }
  const missing = columns.filter((c) => c.required && !fields.includes(c.field));
  return missing.length || unknown.length || duplicate.length
    ? { ok: false, missing, unknown, duplicate }
    : { ok: true, fields };
}

/** AC-34: the request rows (cells as written, formula guard removed; blank cells become null). */
export function requestRows(table: CsvTable, fields: readonly string[]): Record<string, string | null>[] {
  return table.rows.map((record) => {
    const row: Record<string, string | null> = {};
    fields.forEach((field, i) => {
      if (!field) return;
      const cell = unguardCell(record[i] ?? '');
      row[field] = cell.trim() === '' ? null : cell;
    });
    return row;
  });
}

export function requestBytes(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

function csvCell(raw: string): string {
  const s = guardCell(raw);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** AC-33: a header-only template in the display language (UTF-8 with BOM, CRLF). */
export function templateCsv(section: OpeningSection, locale: Locale): string {
  return `\uFEFF${SECTION_COLUMNS[section].map((c) => csvCell(c.label[locale])).join(',')}\r\n`;
}

export function templateFilename(section: OpeningSection): string {
  return `opening-${section}-template.csv`;
}

// ---- results ----------------------------------------------------------------------------------------

export interface OpeningMessage {
  code: string;
  message: string;
  field?: string;
  column?: string;
  hint?: string;
}

export interface OpeningRowResult {
  line: number;
  status: 'ok' | 'clearing' | 'skipped' | 'error';
  messages?: OpeningMessage[];
}

export interface OpeningImportResult {
  mode: 'dry-run' | 'execute';
  committed: boolean;
  fiscalYear: { id: string; code: string; startDate: string };
  openingDate: string;
  summary: { rows: number; accepted: number; clearing: number; skipped: number; errors: number };
  totals: Record<string, string>;
  clearingBalance?: { before: string; after: string };
  clearingAccounts?: { code: string; name: string; debit: string; credit: string }[];
  issues: OpeningMessage[];
  notices: OpeningMessage[];
  rows: OpeningRowResult[];
  documents: { entity: string; id: string; number: string | null }[];
}

export interface OpeningYearStatus {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  openingDate: string;
  importable: boolean;
  reason: string | null;
}

export interface OpeningBalanceStatus {
  years: OpeningYearStatus[];
  selected: OpeningYearStatus & {
    entry: { id: string; number: string | null; debit: string; credit: string } | null;
    reversedCount: number;
  };
  clearing: {
    ok: boolean;
    code: string;
    name: string | null;
    reason: string | null;
    message: string | null;
    balance: string | null;
    foreignPostings: number;
    lines: { memo: string | null; debit: string; credit: string }[];
  };
}

/** AC-39: every row and issue code of the four imports, in both languages. */
export const REASON_TEXT: Readonly<Record<string, Label>> = {
  zero_amount: { ja: '金額が空か 0 です', en: 'The amount is blank or 0' },
  invalid_value: { ja: '値の形式が正しくありません', en: 'Invalid value' },
  negative_amount: { ja: '金額が負です', en: 'The amount is negative' },
  both_sides: { ja: '借方と貸方の両方に金額があります', en: 'Both debit and credit have an amount' },
  not_whole_yen: { ja: '円未満の端数があります', en: 'The amount has a fraction of a yen' },
  ref_not_found: { ja: 'コードが見つかりません', en: 'Code not found' },
  ref_ambiguous: {
    ja: '同じ名称が複数あります（コードで指定してください）',
    en: 'Several match the name (use the code)',
  },
  pl_account: {
    ja: '損益の科目です（期首残高は貸借対照表の科目だけ）',
    en: 'A profit-and-loss account (opening balances are balance-sheet accounts only)',
  },
  clearing_account: {
    ja: '期首残高仮勘定は指定できません（自動で計上します）',
    en: 'The clearing account cannot be imported (it is posted automatically)',
  },
  journal_only_open_item: {
    ja: '取引先付きで計上しますが、消込・年齢表の対象になりません',
    en: 'Posted with the partner, but not an open item for allocation or aging',
  },
  exists: { ja: 'この取引先の期首請求書が既にあります', en: 'The partner already has an opening invoice' },
  cancelled_in_year: {
    ja: '期中の日付で取り消した期首請求書があるため取り込めません（期中の請求書か仕訳で訂正してください）',
    en: 'An opening invoice was cancelled in-year; correct the balance with an in-year invoice or journal',
  },
  non_positive_quantity: { ja: '数量は 0 より大きくしてください', en: 'The quantity must be greater than 0' },
  scale_exceeded: { ja: '小数は 6 桁までです', en: 'At most 6 decimals' },
  service_product: { ja: 'サービスの品目には在庫がありません', en: 'Service products have no stock' },
  duplicate: { ja: '同じ品目 × 倉庫の行が重複しています', en: 'The same product and warehouse appear twice' },
  stock_exists: {
    ja: 'この品目 × 倉庫には在庫か期首残高日より後の移動があります',
    en: 'This product and warehouse already have stock or later movements',
  },
  unbalanced: { ja: '借方合計と貸方合計が一致しません', en: 'Debit and credit totals differ' },
  no_lines: { ja: '受け付けた行が 2 行未満です', en: 'Fewer than 2 accepted rows' },
  submit_failed: { ja: '伝票を確定できませんでした', en: 'The document could not be submitted' },
  clearing_account_used: {
    ja: '期首残高仮勘定が期首残高以外の伝票にも使われています',
    en: 'The clearing account is also used by other postings',
  },
  database: { ja: 'データベースが行を受け付けませんでした', en: 'The database rejected the row' },
};

export function reasonText(code: string, locale: Locale): string | undefined {
  const known = Object.hasOwn(REASON_TEXT, code) ? REASON_TEXT[code] : errorExplanation(code, undefined);
  return known?.[locale];
}

/** "<column>: <reason> (<server message>)" for a row message; issues and notices have no column. */
export function messageLine(section: OpeningSection, m: OpeningMessage, locale: Locale): string {
  const column = m.field ? SECTION_COLUMNS[section].find((c) => c.field === m.field) : undefined;
  const where = column ? column.label[locale] : m.column;
  const reason = reasonText(m.code, locale);
  const what = reason ? `${reason} (${m.message})` : m.message;
  return where ? `${where}: ${what}` : what;
}

/** AC-35: the failed rows as written, then the data row number and the reasons (UTF-8 BOM, formula guard). */
export function errorCsv(
  section: OpeningSection,
  table: CsvTable,
  result: OpeningImportResult,
  locale: Locale,
): string {
  const labels = { line: { ja: '行番号', en: 'Row' }, reason: { ja: '理由', en: 'Reason' } };
  const out = [[...table.headers.map(csvCell), labels.line[locale], labels.reason[locale]].join(',')];
  for (const row of result.rows) {
    if (row.status !== 'error') continue;
    const record = table.rows[row.line - 1] ?? [];
    const reasons = (row.messages ?? []).map((m) => messageLine(section, m, locale)).join(' / ');
    out.push(
      [
        ...table.headers.map((_, i) => csvCell(record[i] ?? '')),
        String(table.lines[row.line - 1] ?? row.line),
        csvCell(reasons),
      ].join(','),
    );
  }
  return `\uFEFF${out.join('\r\n')}\r\n`;
}

/** AC-35: the file's data row number of a result row (blank records are not sent). */
export function fileLine(table: CsvTable, line: number): number {
  return table.lines[line - 1] ?? line;
}

// ---- availability (AC-31, AC-38) -------------------------------------------------------------------

const ROLE_HINT: Record<OpeningSection, Label> = {
  journal: { ja: '経理または管理者の役割が必要です。', en: 'The accounting or admin role is required.' },
  receivables: {
    ja: '売上請求書を作る役割（営業）か管理者が必要です。',
    en: 'A role that creates sales invoices (sales) or admin is required.',
  },
  payables: {
    ja: '仕入請求書を作る役割（購買）か管理者が必要です。',
    en: 'A role that creates purchase invoices (purchasing) or admin is required.',
  },
  stock: {
    ja: '入庫できる役割（在庫・購買）か管理者と、品目を読める役割（閲覧・営業・購買など）が必要です。営業の役割では入庫できません。',
    en: 'A role that receives stock (inventory or purchasing) or admin is required, plus a role that reads products (viewer, sales or purchasing, for example). The sales role cannot receive stock.',
  },
};

const opsOf = (meta: AppMeta, entity: string): readonly string[] =>
  meta.entities.find((e) => e.name === entity)?.ops ?? [];

/** AC-38: why a section is disabled for this user, or undefined when it can be used. */
export function sectionBlocked(section: OpeningSection, meta: AppMeta): Label | undefined {
  if (!meta.actions.some((a) => a.name === SECTION_ACTION[section])) return ROLE_HINT[section];
  if (section === 'journal') return undefined;
  const ops = opsOf(meta, SECTION_ENTITY[section]);
  if (!ops.includes('create') || !ops.includes('submit')) return ROLE_HINT[section];
  if (section !== 'stock') return undefined;
  // server rule roleAllowsEntry(roles, 'receipt', false): sales holds stock_entry ops but may not receive
  if (!meta.roles.some((r) => r === 'admin' || r === 'inventory' || r === 'purchasing')) return ROLE_HINT.stock;
  // AC-6: the server also resolves product and warehouse codes with the caller's own read permission
  if (!opsOf(meta, 'product').includes('read') || !opsOf(meta, 'warehouse').includes('read')) return ROLE_HINT.stock;
  return undefined;
}

/** AC-28: the sections that post against the opening balance clearing account (stock posts no journal). */
export function usesClearingAccount(section: OpeningSection): boolean {
  return section !== 'stock';
}

/** AC-28 / AC-37: why the clearing account cannot be used and how to fix it (the server message stays as detail). */
export function clearingReasonText(reason: string | null, code: string): Label {
  const where = {
    ja: '「設定」の「会計」タブの「期首残高の取込」',
    en: 'Settings → Accounting → Opening balance import',
  };
  if (reason === 'clearing_account_missing')
    return {
      ja: `期首残高仮勘定の科目 ${code} がありません。科目を作る（l10n/jp の科目表では 3900 期首残高仮勘定、純資産）か、${where.ja}で使う科目コードを変えてください。`,
      en: `The clearing account ${code} does not exist. Create it (3900 期首残高仮勘定, equity, in the l10n/jp chart of accounts) or change the account code in ${where.en}.`,
    };
  return {
    ja: `科目 ${code} は期首残高仮勘定に使えません（無効・損益の科目・取引先必須・税の役割のいずれかに当たります）。科目を直すか、${where.ja}で別の科目コードにしてください。`,
    en: `Account ${code} cannot be the clearing account (it is inactive, a profit-and-loss account, requires a partner or has a tax role). Fix the account or choose another account code in ${where.en}.`,
  };
}

export const YEAR_REASON_TEXT: Readonly<Record<string, Label>> = {
  not_earliest: {
    ja: 'これより前の会計年度があるため取り込めません（前の年度の残高がそのまま繰り越されます）。',
    en: 'An earlier fiscal year exists, so this year cannot take opening balances (its balances carry forward).',
  },
  year_closed: { ja: 'この会計年度は締め済みです。', en: 'This fiscal year is closed.' },
  first_period_closed: {
    ja: '最初の会計期間が締め済みです。期間を再開してから取り込んでください。',
    en: 'The first period is closed. Reopen it before importing.',
  },
  no_first_period: {
    ja: '期首日から始まる会計期間がありません。',
    en: 'No fiscal period starts on the first day of the year.',
  },
};

/**
 * AC-19 / AC-20: an opening invoice (`openingBalance`) is an internal record: it is never printed as a qualified invoice
 * and a draft amended from it can never be submitted, so the record page offers neither.
 */
export function isOpeningDocument(record: Readonly<Record<string, unknown>>): boolean {
  return record.openingBalance === true;
}

/**
 * AC-39: the suffix that names the section in a repeated control (" (Opening journal)" / "（開始仕訳）"), so the four
 * "Preview" / "Import" / "Download template" buttons have distinct accessible names.
 */
export function nameSuffix(name: string, locale: Locale): string {
  return locale === 'ja' ? `（${name}）` : ` (${name})`;
}

/** AC-32 / AC-39: a fiscal year option with the separators of the UI language. */
export function yearOptionLabel(year: { code: string; startDate: string; endDate: string }, locale: Locale): string {
  return locale === 'ja'
    ? `${year.code}（${year.startDate}〜${year.endDate}）`
    : `${year.code} (${year.startDate} – ${year.endDate})`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OpeningSearch {
  fiscalYearId?: string;
}

/** AC-32: `?fiscalYearId=` keeps the chosen year. */
export function parseOpeningSearch(raw: Record<string, unknown>): OpeningSearch {
  return typeof raw.fiscalYearId === 'string' && UUID.test(raw.fiscalYearId) ? { fiscalYearId: raw.fiscalYearId } : {};
}

/** Totals of a result as label / value pairs for the summary (AC-35). */
export function totalsList(section: OpeningSection, result: OpeningImportResult): { label: Label; value: string }[] {
  const t = result.totals;
  if (section === 'journal')
    return [
      { label: { ja: '借方合計', en: 'Debit total' }, value: t.debit ?? '0' },
      { label: { ja: '貸方合計', en: 'Credit total' }, value: t.credit ?? '0' },
      { label: { ja: '差額', en: 'Difference' }, value: t.difference ?? '0' },
    ];
  if (section === 'stock')
    return [
      { label: { ja: '数量合計', en: 'Total quantity' }, value: t.quantity ?? '0' },
      { label: { ja: '金額合計', en: 'Total value' }, value: t.value ?? '0' },
    ];
  return [{ label: { ja: '金額合計', en: 'Total amount' }, value: t.amount ?? '0' }];
}
