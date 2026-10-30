// Pure helpers for the evidence search screen (/finance/evidence, docs/specs/evidence-search.md AC-12..AC-20): the
// URL search and the form criteria, input checks, the summary of the applied criteria, where a link goes, the selection
// limits, zip entry names, and the sequential fetch of the selected files. evidence-search.test.ts.
import type { AttachmentJson, Label, Locale } from '../api/types.ts';
import { compareDecimalStrings } from './decimal.ts';
import { groupDigits } from './format.ts';

export const EVIDENCE_SEARCH_ACTION = 'attachment.evidence_search';
export const EVIDENCE_HISTORY_ACTION = 'attachment.history';
export const EVIDENCE_PAGE_SIZE = 50;
/** AC-18: one zip holds at most 50 files and 100 MB (recorded sizes). */
export const ZIP_MAX_FILES = 50;
export const ZIP_MAX_BYTES = 104_857_600;
/** AC-17: each entry name is at most 255 bytes in UTF-8. */
export const ZIP_NAME_MAX_BYTES = 255;

export const SUPERSEDED_VALUES = ['include', 'exclude', 'only'] as const;
export type SupersededValue = (typeof SUPERSEDED_VALUES)[number];

export const SUPERSEDED_LABELS: Record<SupersededValue, Label> = {
  include: { ja: 'すべて', en: 'All' },
  exclude: { ja: '最新版のみ', en: 'Current versions only' },
  only: { ja: '差替済みのみ', en: 'Superseded only' },
};

// ---- server rows ------------------------------------------------------------------------------

export interface LinkedSummary {
  entity: string;
  id: string;
  kind: 'document' | 'entity' | 'line' | 'unknown';
  readable: boolean;
  target: { entity: string; id: string } | null;
  title: string | null;
  number: string | null;
  docstatus: number | null;
}

export interface EvidenceItem extends AttachmentJson {
  linked: LinkedSummary | null;
  supersedes: number;
  incomplete: boolean;
}

export interface EvidenceResult {
  items: EvidenceItem[];
  total: number;
  limit: number;
  offset: number;
}

export type HistoryRelation = 'self' | 'newer' | 'older' | 'sibling';

export interface SupersedeRecord {
  reason: string | null;
  at: string | null;
  actorType: string | null;
  actorId: string | null;
}

export interface HistoryItem extends AttachmentJson {
  relation: HistoryRelation;
  depth: number;
  incomplete: boolean;
  supersede: SupersedeRecord | null;
}

export interface HistoryResult {
  id: string;
  items: HistoryItem[];
  truncated: boolean;
}

export const RELATION_LABELS: Record<HistoryRelation, Label> = {
  self: { ja: 'この証憑', en: 'This evidence' },
  newer: { ja: '新しい版', en: 'Newer version' },
  older: { ja: '古い版', en: 'Older version' },
  sibling: { ja: '別の分岐', en: 'Other branch' },
};

// ---- URL search and criteria (AC-13, AC-14) ---------------------------------------------------

/** The route search as the router hands it over: strings kept as typed, the page as a number. */
export interface EvidenceSearchParams {
  from?: string;
  to?: string;
  amountFrom?: string;
  amountTo?: string;
  partnerId?: string;
  kind?: string;
  superseded?: string;
  incomplete?: string;
  /** A page past the first (whole numbers up to 999,999). */
  page?: number;
  /**
   * The URL had a page that is not a whole number from 1 to 999,999 (reported as ignored, AC-14). A separate key, not a
   * second type of `page`: every route's search shares one type in the router, and other screens read `page` as a number.
   */
  pageInvalid?: true;
}

const TEXT_KEYS = ['from', 'to', 'amountFrom', 'amountTo', 'partnerId', 'kind', 'superseded', 'incomplete'] as const;
type TextKey = (typeof TEXT_KEYS)[number];

/**
 * Route validateSearch: keeps the known keys as strings. The router parses a hand-typed `?amountFrom=1000` as a JSON
 * number; a number is kept only while its text is exact (a safe integer or a short decimal), otherwise it becomes an
 * invalid value that the screen ignores and reports.
 */
export function parseEvidenceSearch(raw: Record<string, unknown>): EvidenceSearchParams {
  const out: EvidenceSearchParams = {};
  for (const key of TEXT_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 100) out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) {
      const text = String(value);
      out[key] = Number.isSafeInteger(value) || /^-?\d+\.\d{1,6}$/.test(text) ? text : 'invalid-number';
    } else if (value !== undefined && value !== null && value !== '') out[key] = 'invalid';
  }
  if (raw.page !== undefined && raw.page !== null && raw.page !== '') {
    const page = typeof raw.page === 'number' ? raw.page : typeof raw.page === 'string' ? Number(raw.page) : NaN;
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) out.pageInvalid = true;
    else if (page > 1) out.page = page;
  }
  return out;
}

/** The criteria of one search (form values, already checked). Empty strings mean "not given". */
export interface EvidenceCriteria {
  from: string;
  to: string;
  amountFrom: string;
  amountTo: string;
  partnerId: string;
  kind: string;
  superseded: SupersededValue;
  incomplete: boolean;
}

export const EMPTY_CRITERIA: EvidenceCriteria = {
  from: '',
  to: '',
  amountFrom: '',
  amountTo: '',
  partnerId: '',
  kind: '',
  superseded: 'include',
  incomplete: false,
};

export type CriteriaField =
  'from' | 'to' | 'amountFrom' | 'amountTo' | 'partnerId' | 'kind' | 'superseded' | 'incomplete';

export const FIELD_LABELS: Record<CriteriaField, Label> = {
  from: { ja: '取引年月日（開始）', en: 'Transaction date (from)' },
  to: { ja: '取引年月日（終了）', en: 'Transaction date (to)' },
  amountFrom: { ja: '取引金額（下限）', en: 'Amount (from)' },
  amountTo: { ja: '取引金額（上限）', en: 'Amount (to)' },
  partnerId: { ja: '取引先', en: 'Partner' },
  kind: { ja: '種別', en: 'Kind' },
  superseded: { ja: '差替の表示', en: 'Superseded evidence' },
  incomplete: { ja: '未入力のみ', en: 'Missing keys only' },
};

/** A URL value that the screen ignored (AC-14): a criterion, or the page number. */
export type IgnoredField = CriteriaField | 'page';

export const IGNORED_LABELS: Record<IgnoredField, Label> = { ...FIELD_LABELS, page: { ja: '頁', en: 'Page' } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT = /^-?\d+(?:\.\d+)?$/;

/** A real calendar date written YYYY-MM-DD (2026-02-30 is not). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Amount text as typed -> a decimal string, or undefined. Thousands separators and spaces are accepted and removed. */
export function normalizeAmount(value: string): string | undefined {
  const text = value.trim().replaceAll(',', '');
  return AMOUNT.test(text) ? text : undefined;
}

/** The reason shown under a field (AC-14). */
export const FIELD_ERRORS = {
  badDate: { ja: '実在する日付を YYYY-MM-DD で入力してください。', en: 'Enter a real date as YYYY-MM-DD.' },
  dateOrder: { ja: '開始日は終了日以前にしてください。', en: 'The start date must not be after the end date.' },
  badAmount: {
    ja: '金額は数字で入力してください（例: 1200 または 1,200.50）。',
    en: 'Enter the amount as a number (e.g. 1200 or 1,200.50).',
  },
  amountOrder: { ja: '下限は上限以下にしてください。', en: 'The lower amount must not exceed the upper amount.' },
} satisfies Record<string, Label>;

export interface DraftCheck {
  criteria: EvidenceCriteria;
  /** Field -> reason; empty when the draft can be searched. Ordered like the form, so the first key is focused. */
  errors: Partial<Record<CriteriaField, Label>>;
}

/** AC-14: checks the form before searching. Amounts come back normalized (separators removed), never as numbers. */
export function checkDraft(draft: EvidenceCriteria): DraftCheck {
  const errors: Partial<Record<CriteriaField, Label>> = {};
  const from = draft.from.trim();
  const to = draft.to.trim();
  if (from && !isCalendarDate(from)) errors.from = FIELD_ERRORS.badDate;
  if (to && !isCalendarDate(to)) errors.to = FIELD_ERRORS.badDate;
  if (!errors.from && !errors.to && from && to && from > to) errors.from = FIELD_ERRORS.dateOrder;
  const amountFrom = draft.amountFrom.trim() ? normalizeAmount(draft.amountFrom) : '';
  const amountTo = draft.amountTo.trim() ? normalizeAmount(draft.amountTo) : '';
  if (amountFrom === undefined) errors.amountFrom = FIELD_ERRORS.badAmount;
  if (amountTo === undefined) errors.amountTo = FIELD_ERRORS.badAmount;
  if (amountFrom && amountTo && compareDecimalStrings(amountFrom, amountTo) === 1)
    errors.amountFrom = FIELD_ERRORS.amountOrder;
  return {
    criteria: {
      ...draft,
      from,
      to,
      amountFrom: amountFrom ?? draft.amountFrom,
      amountTo: amountTo ?? draft.amountTo,
      partnerId: draft.partnerId.trim(),
    },
    errors,
  };
}

/** Largest page number taken from a URL. */
const MAX_PAGE = 999_999;

/**
 * AC-13/AC-14: the URL search -> criteria and page. Invalid values (and both ends of a reversed range) are ignored and
 * reported by field, as the list workbench does with `?f=`. The router hands over this route's validated search spread
 * over the root route's raw one, so a raw value the validator left out (`?page=abc`, `?page=0`) can still arrive here:
 * every value is checked again rather than trusted by type.
 */
export function criteriaFromSearch(
  search: EvidenceSearchParams,
  kinds: readonly string[],
): { criteria: EvidenceCriteria; page: number; ignored: IgnoredField[] } {
  const ignored: IgnoredField[] = [];
  const c: EvidenceCriteria = { ...EMPTY_CRITERIA };
  const take = (key: TextKey, ok: (v: string) => boolean): string => {
    const v: unknown = search[key];
    if (v === undefined || v === null || v === '') return '';
    if (typeof v === 'string' && ok(v)) return v;
    ignored.push(key);
    return '';
  };
  c.from = take('from', isCalendarDate);
  c.to = take('to', isCalendarDate);
  if (c.from && c.to && c.from > c.to) {
    ignored.push('from', 'to');
    c.from = '';
    c.to = '';
  }
  c.amountFrom = take('amountFrom', (v) => normalizeAmount(v) === v);
  c.amountTo = take('amountTo', (v) => normalizeAmount(v) === v);
  if (c.amountFrom && c.amountTo && compareDecimalStrings(c.amountFrom, c.amountTo) === 1) {
    ignored.push('amountFrom', 'amountTo');
    c.amountFrom = '';
    c.amountTo = '';
  }
  c.partnerId = take('partnerId', (v) => UUID.test(v));
  c.kind = take('kind', (v) => kinds.includes(v));
  const superseded = take('superseded', (v) => (SUPERSEDED_VALUES as readonly string[]).includes(v));
  c.superseded = (superseded || 'include') as SupersededValue;
  c.incomplete = take('incomplete', (v) => v === '1') === '1';
  const raw: unknown = search.page;
  const pageOk = typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_PAGE;
  if (search.pageInvalid || (raw !== undefined && !pageOk)) ignored.push('page');
  return { criteria: c, page: pageOk ? raw : 1, ignored: [...new Set(ignored)] };
}

/** Criteria -> route search for a new search (page reset; defaults left out). */
export function searchFromCriteria(c: EvidenceCriteria, page = 1): EvidenceSearchParams {
  const out: EvidenceSearchParams = {};
  if (c.from) out.from = c.from;
  if (c.to) out.to = c.to;
  if (c.amountFrom) out.amountFrom = c.amountFrom;
  if (c.amountTo) out.amountTo = c.amountTo;
  if (c.partnerId) out.partnerId = c.partnerId;
  if (c.kind) out.kind = c.kind;
  if (c.superseded !== 'include') out.superseded = c.superseded;
  if (c.incomplete) out.incomplete = '1';
  if (page > 1) out.page = page;
  return out;
}

/** The action input for a page of results (amounts stay strings). */
export function searchInput(c: EvidenceCriteria, page: number): Record<string, unknown> {
  const input: Record<string, unknown> = {
    limit: EVIDENCE_PAGE_SIZE,
    offset: (Math.max(1, page) - 1) * EVIDENCE_PAGE_SIZE,
  };
  if (c.from) input.txnDateFrom = c.from;
  if (c.to) input.txnDateTo = c.to;
  if (c.amountFrom) input.amountFrom = c.amountFrom;
  if (c.amountTo) input.amountTo = c.amountTo;
  if (c.partnerId) input.partnerId = c.partnerId;
  if (c.kind) input.kind = c.kind;
  if (c.superseded !== 'include') input.superseded = c.superseded;
  if (c.incomplete) input.incomplete = true;
  return input;
}

/** The selection boundary (AC-18/AC-20): same criteria, same selection; the page is not part of it. */
export function criteriaKey(c: EvidenceCriteria): string {
  return JSON.stringify([c.from, c.to, c.amountFrom, c.amountTo, c.partnerId, c.kind, c.superseded, c.incomplete]);
}

export function sameCriteria(a: EvidenceCriteria, b: EvidenceCriteria): boolean {
  return criteriaKey(a) === criteriaKey(b);
}

/**
 * AC-13: the applied criteria as short phrases ("取引年月日: 2026-01-01〜2026-01-31", "Date: from 2026-01-01"); empty when
 * nothing is applied. Japanese writes ranges with 〜, English with an en dash or "from" / "up to".
 */
export function summarizeCriteria(
  c: EvidenceCriteria,
  locale: Locale,
  names: { partner?: string | undefined; kind?: string | undefined } = {},
): string[] {
  const ja = locale === 'ja';
  const range = (a: string, b: string) => {
    if (a && b && a === b) return a;
    if (ja) return `${a}〜${b}`;
    if (a && b) return `${a} – ${b}`;
    return a ? `from ${a}` : `up to ${b}`;
  };
  const out: string[] = [];
  if (c.from || c.to) out.push(`${ja ? '取引年月日' : 'Date'}: ${range(c.from, c.to)}`);
  if (c.amountFrom || c.amountTo)
    out.push(
      `${ja ? '取引金額' : 'Amount'}: ${range(c.amountFrom && groupDigits(c.amountFrom), c.amountTo && groupDigits(c.amountTo))}`,
    );
  if (c.partnerId) out.push(`${ja ? '取引先' : 'Partner'}: ${names.partner ?? c.partnerId}`);
  if (c.kind) out.push(`${ja ? '種別' : 'Kind'}: ${names.kind ?? c.kind}`);
  if (c.superseded !== 'include') out.push(`${ja ? '差替' : 'Supersede'}: ${SUPERSEDED_LABELS[c.superseded][locale]}`);
  if (c.incomplete) out.push(ja ? '検索項目の未入力のみ' : 'Missing search keys only');
  return out;
}

// ---- results (AC-15) --------------------------------------------------------------------------

export interface LinkView {
  /** Route to open, or undefined when the record cannot be opened. */
  href?: string;
  /** Number (documents), else title, else the entity label. */
  text: string;
  /** The link points at a line; the record opened is its document. */
  viaLine: boolean;
}

/** AC-15: where the "linked record" cell goes and what it says; null when the evidence has no link. */
export function linkView(
  linked: LinkedSummary | null,
  entityLabel: (entity: string) => string | undefined,
  locale: Locale,
): LinkView | null {
  if (!linked) return null;
  if (!linked.readable || !linked.target) {
    return { text: locale === 'ja' ? '参照できない記録' : 'A record you cannot open', viaLine: false };
  }
  const label = entityLabel(linked.target.entity) ?? linked.target.entity;
  const name = linked.number ?? linked.title;
  return {
    href: `/e/${linked.target.entity}/${linked.target.id}`,
    text: name ? `${label} ${name}` : label,
    viaLine: linked.kind === 'line',
  };
}

export function formatBytes(bytes: number, locale: Locale): string {
  const unit = locale === 'ja' ? ['バイト', 'KB', 'MB'] : ['bytes', 'KB', 'MB'];
  if (bytes < 1024) return `${groupDigits(String(bytes))} ${unit[0]}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${unit[1]}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${unit[2]}`;
}

// ---- selection (AC-18) ------------------------------------------------------------------------

export interface SelectionState {
  count: number;
  bytes: number;
  /** The recorded sizes add up to more than ZIP_MAX_BYTES: the download is disabled. */
  overSize: boolean;
  /** The count cap is reached: further rows cannot be selected. */
  full: boolean;
  canDownload: boolean;
}

export function selectionState(selected: readonly Pick<EvidenceItem, 'size'>[]): SelectionState {
  const bytes = selected.reduce((sum, item) => sum + (Number.isFinite(item.size) ? item.size : 0), 0);
  const overSize = bytes > ZIP_MAX_BYTES;
  return {
    count: selected.length,
    bytes,
    overSize,
    full: selected.length >= ZIP_MAX_FILES,
    canDownload: selected.length > 0 && !overSize && selected.length <= ZIP_MAX_FILES,
  };
}

// ---- zip entry names (AC-17) ------------------------------------------------------------------

/** Characters Windows does not allow in a file name (control characters are checked by code point). */
const FORBIDDEN = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);
/**
 * Control (C0, DEL, C1) and invisible format characters, and the line/paragraph separators. The format class covers the
 * bidi controls (U+061C, U+200E/U+200F, U+202A..U+202E, U+2066..U+2069), the zero-width characters and U+FEFF, which
 * could make an extracted `請求書<U+202E>fdp.exe` read as `…exe.pdf` (right-to-left override spoofing).
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const encoder = new TextEncoder();

function byteLength(s: string): number {
  return encoder.encode(s).length;
}

/** Cuts `s` to at most `max` UTF-8 bytes on a character (code point) boundary. */
export function truncateUtf8(s: string, max: number): string {
  if (byteLength(s) <= max) return s;
  let out = '';
  let used = 0;
  for (const ch of s) {
    const n = byteLength(ch);
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1 || name.length - dot > 16) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/** A name safe on Windows, macOS and Linux: forbidden characters and a trailing dot/space replaced, reserved names prefixed. */
export function safeFilename(name: string): string {
  let out = [...name]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f || FORBIDDEN.has(ch) || INVISIBLE.test(ch) ? '_' : ch;
    })
    .join('')
    .replace(/[. ]+$/, (m) => '_'.repeat(m.length));
  if (out === '') out = '_';
  const { stem } = splitExtension(out);
  if (RESERVED.test(stem) || RESERVED.test(out)) out = `_${out}`;
  return out;
}

/**
 * File extensions that match each stored content type (attachments AC-2's allowlist); the first is added when a name does
 * not end with one. The server checks the declared type against the allowlist but does not tie it to the name, so a row
 * named `invoice.exe` and declared `application/pdf` becomes `invoice.exe.pdf` in the zip and opens as what it claims.
 */
const TYPE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg', '.jpe', '.jfif'],
  'text/csv': ['.csv'],
  'application/xml': ['.xml'],
  'text/xml': ['.xml'],
  'text/plain': ['.txt'],
};

/** `name` with the content type's extension added when it does not already end with one (unknown types: unchanged). */
export function withTypeExtension(name: string, contentType: string | undefined): string {
  const known = contentType ? TYPE_EXTENSIONS[contentType.toLowerCase()] : undefined;
  if (!known) return name;
  const lower = name.toLowerCase();
  return known.some((ext) => lower.endsWith(ext)) ? name : `${name}${known[0] ?? ''}`;
}

type ZipNameSource = Pick<EvidenceItem, 'txnDate' | 'filename' | 'supersededById'> & { contentType?: string };

/**
 * `<date or no-date>_<filename>`, `superseded_` first for superseded evidence, with the extension of the stored content
 * type (before uniqueness and length limits).
 */
export function zipBaseName(item: ZipNameSource): string {
  const prefix = item.supersededById ? 'superseded_' : '';
  return withTypeExtension(safeFilename(`${prefix}${item.txnDate ?? 'no-date'}_${item.filename}`), item.contentType);
}

/** Fits `stem + suffix + ext` into ZIP_NAME_MAX_BYTES, cutting the stem (the extension is kept). */
function fitName(stem: string, suffix: string, ext: string): string {
  const room = ZIP_NAME_MAX_BYTES - byteLength(suffix) - byteLength(ext);
  return safeFilename(`${truncateUtf8(stem, Math.max(1, room))}${suffix}${ext}`);
}

/** AC-17: entry names in selection order, unique (case-insensitively, as Windows compares) and at most 255 bytes. */
export function zipEntryNames(items: readonly ZipNameSource[]): string[] {
  const used = new Set<string>();
  return items.map((item) => {
    const { stem, ext } = splitExtension(zipBaseName(item));
    let name = fitName(stem, '', ext);
    for (let n = 2; used.has(name.toLowerCase()); n++) name = fitName(stem, ` (${n})`, ext);
    used.add(name.toLowerCase());
    return name;
  });
}

/** `evidence_<UTC YYYYMMDDHHMMSS>.zip` */
export function zipFilename(now: Date): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `evidence_${stamp}.zip`;
}

// ---- fetching the selected files (AC-17, AC-19) -----------------------------------------------

export type FetchFailure = 'denied' | 'mismatch' | 'network' | 'size' | 'other';

export const FAILURE_LABELS: Record<FetchFailure, Label> = {
  denied: { ja: '権限が無いか、見つかりません（403 / 404）', en: 'Not permitted or not found (403 / 404)' },
  mismatch: {
    ja: '保存内容が記録と一致しません（409）。管理者に確認してください',
    en: 'The stored file does not match its record (409). Ask an administrator',
  },
  network: { ja: '通信に失敗しました', en: 'The connection failed' },
  size: { ja: '受信したサイズが記録と異なります', en: 'The received size differs from the record' },
  other: { ja: '取得に失敗しました', en: 'The download failed' },
};

/** What a failed request means for one file; `unauthorized` (401) stops the whole download. */
export function classifyFailure(status: number | undefined): FetchFailure | 'unauthorized' {
  if (status === 401) return 'unauthorized';
  if (status === 403 || status === 404) return 'denied';
  if (status === 409) return 'mismatch';
  if (status === 0) return 'network';
  return 'other';
}

export interface FetchedFile {
  item: EvidenceItem;
  blob: Blob;
}

export interface CollectResult {
  files: FetchedFile[];
  failures: { item: EvidenceItem; reason: FetchFailure; status?: number }[];
  /** The user pressed "stop" or the screen was left: nothing is saved. */
  aborted: boolean;
  /** A 401 ended the session: nothing is saved (the client already went to the login screen). */
  unauthorized: boolean;
}

/** HTTP status of a thrown value (ApiError carries `status`; a transport failure is 0). */
function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number')
    return (error as { status: number }).status;
  return undefined;
}

/**
 * AC-17/AC-19: fetches the selected files one after another through `fetchOne` (the existing download route). A failed
 * file is recorded and the rest continue; a received size that differs from the record is a failure; a 401 or an abort
 * stops at once and keeps nothing.
 */
export async function collectFiles(
  items: readonly EvidenceItem[],
  fetchOne: (item: EvidenceItem, signal: AbortSignal) => Promise<Blob>,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<CollectResult> {
  const result: CollectResult = { files: [], failures: [], aborted: false, unauthorized: false };
  for (const [index, item] of items.entries()) {
    if (signal.aborted) return { ...result, files: [], aborted: true };
    try {
      const blob = await fetchOne(item, signal);
      if (signal.aborted) return { ...result, files: [], aborted: true };
      if (blob.size !== item.size) result.failures.push({ item, reason: 'size' });
      else result.files.push({ item, blob });
    } catch (error) {
      if (signal.aborted) return { ...result, files: [], aborted: true };
      const status = statusOf(error);
      const kind = classifyFailure(status);
      if (kind === 'unauthorized') return { ...result, files: [], unauthorized: true };
      result.failures.push(status === undefined ? { item, reason: kind } : { item, reason: kind, status });
    }
    onProgress?.(index + 1, items.length);
  }
  return result;
}

/** What one press of "download as zip" ended with (AC-17, AC-19). */
export type ZipOutcome =
  | { kind: 'saved'; saved: number; failures: CollectResult['failures'] }
  | { kind: 'none'; failures: CollectResult['failures'] }
  | { kind: 'aborted' }
  /** A 401 ended the session: nothing is saved and nothing is shown (the client went to the login screen). */
  | { kind: 'unauthorized' }
  /** Building or saving the zip threw (for example out of memory near the size cap): nothing is saved. */
  | { kind: 'failed'; error: unknown; failures: CollectResult['failures'] };

export interface ZipSteps {
  /** One file through the existing download route. */
  fetchOne: (item: EvidenceItem, signal: AbortSignal) => Promise<Blob>;
  build: (entries: { name: string; data: Blob; date: Date }[]) => Promise<Blob>;
  save: (zip: Blob, filename: string) => void;
  now: () => Date;
}

/**
 * AC-17/AC-19: fetches the selected files, builds the zip and saves it. Never rejects: a failure while building or
 * saving becomes `failed` (with the per-file failures collected so far), so the screen can say that nothing was saved.
 */
export async function runEvidenceZip(
  items: readonly EvidenceItem[],
  steps: ZipSteps,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<ZipOutcome> {
  let failures: CollectResult['failures'] = [];
  try {
    const result = await collectFiles(items, steps.fetchOne, signal, onProgress);
    failures = result.failures;
    if (result.unauthorized) return { kind: 'unauthorized' };
    if (result.aborted) return { kind: 'aborted' };
    if (result.files.length === 0) return { kind: 'none', failures };
    const names = zipEntryNames(result.files.map((f) => f.item));
    const zip = await steps.build(
      result.files.map((f, i) => ({ name: names[i] as string, data: f.blob, date: new Date(f.item.createdAt) })),
    );
    if (signal.aborted) return { kind: 'aborted' };
    steps.save(zip, zipFilename(steps.now()));
    return { kind: 'saved', saved: result.files.length, failures };
  } catch (error) {
    if (signal.aborted) return { kind: 'aborted' };
    return { kind: 'failed', error, failures };
  }
}
