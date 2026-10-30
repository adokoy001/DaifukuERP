// Audit search screen helpers (docs/specs/access-insight.md AC-19, AC-20): URL <-> conditions, the default period (the
// last 7 days in Japan, today included), form validation with the same 366-day rule as the API, the cursor trail of
// "previous / next / first", and the text of each result row (who, what, which change, CSV export summary, link).
import type { Label } from '../api/types.ts';

export type AuditScope = 'company' | 'tenant';
export interface AuditItem {
  id: string;
  at: string;
  entity: string;
  recordId: string;
  op: string;
  action: string | null;
  actorType: string;
  actorId: string;
  actorName: string | null;
  onBehalfOf: string | null;
  onBehalfOfName: string | null;
  requestId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
export interface AuditPage {
  items: AuditItem[];
  nextCursor: string | null;
}
export interface AuditUserOption {
  id: string;
  name: string;
  active: boolean;
  kind: 'member' | 'tenant_admin' | 'former' | 'user';
  email?: string;
}
export interface AuditOptions {
  scope: AuditScope;
  users: AuditUserOption[];
  subjects: { name: string; label: Label; kind: 'entity' | 'kernel' }[];
  ops: { name: string; label: Label }[];
}

/** Same rule as the API (AC-15): days from `from` to `to` with both ends counted, at most 366. */
export const MAX_DAYS = 366;
/** Same bound as the API (kernel AUDIT_SEARCH_MIN_DATE): no earlier business date is searchable. */
export const MIN_DATE = '2000-01-01';
const DAY_MS = 86_400_000;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function isLocalDate(s: string): boolean {
  if (!LOCAL_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function periodDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}
/** Today in Japan (business dates are Asia/Tokyo; Japan has no daylight saving time). */
export function todayInJapan(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}
export function defaultPeriod(now: Date): { from: string; to: string } {
  const to = todayInJapan(now);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * The cursor shape the API accepts (kernel decodeAuditCursor): base64url JSON `[at, id]`, `at` a real UTC instant with
 * six fractional digits from year 0001 on, `id` a uuid. Anything else is an unreadable URL condition (AC-19), not a
 * search the API would refuse.
 */
export function isAuditCursor(raw: string): boolean {
  if (!CURSOR.test(raw)) return false;
  try {
    const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(value) || value.length !== 2) return false;
    const [at, id] = value as unknown[];
    if (typeof at !== 'string' || !CURSOR_AT.test(at) || at < '0001') return false;
    const ms = Date.parse(at);
    if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 23) !== at.slice(0, 23)) return false;
    return typeof id === 'string' && UUID.test(id);
  } catch {
    return false;
  }
}

export interface AuditConditions {
  from: string;
  to: string;
  user: string;
  entity: string;
  op: string;
  record: string;
  scope: AuditScope;
}
export interface AuditSearchState extends AuditConditions {
  cursor?: string | undefined;
}
export type AuditField = 'from' | 'to' | 'user' | 'entity' | 'op' | 'record' | 'scope' | 'cursor';

/**
 * URL -> conditions (AC-19). Unreadable values are ignored (the default is used) and named in `ignored` so the screen
 * can say so; `scope=tenant` is ignored for someone who is not a tenant administrator.
 */
export function parseAuditSearch(
  raw: Record<string, unknown>,
  now: Date,
  opts: { tenantAdmin: boolean },
): { state: AuditSearchState; ignored: AuditField[] } {
  const ignored: AuditField[] = [];
  const text = (key: AuditField): string | undefined => {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
      ignored.push(key);
      return undefined;
    }
    return value;
  };
  const period = defaultPeriod(now);
  const from = text('from');
  const to = text('to');
  let state: AuditSearchState = { ...period, user: '', entity: '', op: '', record: '', scope: 'company' };
  if (from !== undefined || to !== undefined) {
    const f = from ?? period.from;
    const t = to ?? period.to;
    if (isLocalDate(f) && isLocalDate(t) && f >= MIN_DATE && f <= t && periodDays(f, t) <= MAX_DAYS)
      state = { ...state, from: f, to: t };
    else ignored.push(...(['from', 'to'] as const).filter((k) => raw[k] !== undefined));
  }
  const user = text('user');
  if (user !== undefined) {
    if (user.trim() && user.length <= 200) state.user = user.trim();
    else ignored.push('user');
  }
  for (const key of ['entity', 'op'] as const) {
    const value = text(key);
    if (value === undefined) continue;
    if (NAME.test(value)) state[key] = value;
    else ignored.push(key);
  }
  const record = text('record');
  if (record !== undefined) {
    if (UUID.test(record) && state.entity) state.record = record.toLowerCase();
    else ignored.push('record');
  }
  const scope = text('scope');
  if (scope !== undefined) {
    if (scope === 'company' || (scope === 'tenant' && opts.tenantAdmin)) state.scope = scope;
    else ignored.push('scope');
  }
  const cursor = text('cursor');
  if (cursor !== undefined) {
    if (isAuditCursor(cursor)) state.cursor = cursor;
    else ignored.push('cursor');
  }
  return { state, ignored: [...new Set(ignored)] };
}

/** The conditions alone: a new search always starts at the first page (AC-19, "条件変更で初期化"). */
export function conditionsOf(state: AuditConditions): AuditConditions {
  const { from, to, user, entity, op, record, scope } = state;
  return { from, to, user, entity, op, record, scope };
}

/** Conditions -> URL search (empty values left out; the period always present so a shared URL keeps it). */
export function auditSearchParams(state: AuditSearchState): Record<string, string> {
  const out: Record<string, string> = { from: state.from, to: state.to };
  if (state.user) out.user = state.user;
  if (state.entity) out.entity = state.entity;
  if (state.op) out.op = state.op;
  if (state.record && state.entity) out.record = state.record;
  if (state.scope === 'tenant') out.scope = 'tenant';
  if (state.cursor) out.cursor = state.cursor;
  return out;
}
/** Conditions -> GET /admin/audit query string. */
export function auditApiQuery(state: AuditSearchState, limit = 50): string {
  const params = new URLSearchParams({ from: state.from, to: state.to, limit: String(limit) });
  if (state.scope === 'tenant') params.set('scope', 'tenant');
  if (state.user) params.set('userId', state.user);
  if (state.entity) params.set('entity', state.entity);
  if (state.op) params.set('op', state.op);
  if (state.record && state.entity) params.set('recordId', state.record);
  if (state.cursor) params.set('cursor', state.cursor);
  return params.toString();
}
/** The conditions without the page: equal keys mean the same search (the cursor trail restarts when they change). */
export function conditionsKey(state: AuditConditions): string {
  return JSON.stringify([state.from, state.to, state.user, state.entity, state.op, state.record, state.scope]);
}

export interface FormError {
  field: 'from' | 'to' | 'record';
  message: Label;
}
/** AC-19: field errors in screen order (the first one gets focus); nothing is searched while any remains. */
export function validateAuditForm(form: AuditConditions): FormError[] {
  const errors: FormError[] = [];
  const fromReal = isLocalDate(form.from);
  const toReal = isLocalDate(form.to);
  const fromOk = fromReal && form.from >= MIN_DATE;
  const toOk = toReal && form.to >= MIN_DATE;
  const tooEarly: Label = {
    ja: `${MIN_DATE} 以降の日付を入力してください。`,
    en: `Enter a date on or after ${MIN_DATE}.`,
  };
  if (!fromOk)
    errors.push({
      field: 'from',
      message: fromReal ? tooEarly : { ja: '実在する日付を入力してください。', en: 'Enter an existing date.' },
    });
  if (!toOk)
    errors.push({
      field: 'to',
      message: toReal ? tooEarly : { ja: '実在する日付を入力してください。', en: 'Enter an existing date.' },
    });
  if (fromOk && toOk && form.from > form.to)
    errors.push({
      field: 'to',
      message: { ja: '終了日を開始日以降にしてください。', en: 'The end date must not be before the start date.' },
    });
  else if (fromOk && toOk && periodDays(form.from, form.to) > MAX_DAYS)
    errors.push({
      field: 'to',
      message: {
        ja: `期間は ${MAX_DAYS} 日（両端を含む）までにしてください。`,
        en: `Choose at most ${MAX_DAYS} days (both ends included).`,
      },
    });
  if (form.record && (!UUID.test(form.record.trim()) || !form.entity))
    errors.push({
      field: 'record',
      message: form.entity
        ? { ja: '記録 ID は UUID の形で入力してください。', en: 'Enter the record id as a UUID.' }
        : { ja: '記録 ID は対象を選んでから入力してください。', en: 'Choose a subject before entering a record id.' },
    });
  return errors;
}

/** "Previous" goes back through the pages opened on this screen; "First" clears the trail. */
export function pushTrail(trail: readonly string[], current: string | undefined): string[] {
  return [...trail, current ?? ''];
}
export function popTrail(trail: readonly string[]): { trail: string[]; cursor: string | undefined } {
  const last = trail.at(-1);
  return { trail: trail.slice(0, -1), cursor: last ? last : undefined };
}

const SHORT = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…` : id);
const ACTOR_TYPES: Record<string, Label> = {
  user: { ja: '利用者', en: 'User' },
  agent: { ja: 'AI 代理', en: 'AI agent' },
  system: { ja: 'システム', en: 'System' },
  relay: { ja: '店舗端末', en: 'Site device' },
};
/** AC-20: the person; an AI agent as "name (AI agent: id)"; system / relay / unknown kinds as kind and id. */
export function actorText(item: AuditItem): Label {
  if (item.actorType === 'user') {
    const name = item.actorName ?? SHORT(item.actorId);
    return { ja: name, en: name };
  }
  if (item.actorType === 'agent') {
    const person = item.onBehalfOfName ?? (item.onBehalfOf ? SHORT(item.onBehalfOf) : '—');
    return { ja: `${person}（AI 代理: ${item.actorId}）`, en: `${person} (AI agent: ${item.actorId})` };
  }
  const kind = ACTOR_TYPES[item.actorType] ?? { ja: item.actorType, en: item.actorType };
  return { ja: `${kind.ja}: ${item.actorId}`, en: `${kind.en}: ${item.actorId}` };
}
export function userOptionText(user: AuditUserOption): Label {
  const suffix: Record<AuditUserOption['kind'], Label> = {
    member: { ja: '', en: '' },
    user: { ja: '', en: '' },
    tenant_admin: { ja: '（テナント管理者）', en: ' (tenant administrator)' },
    former: { ja: '（所属解除済み）', en: ' (membership removed)' },
  };
  const inactive: Label = user.active ? { ja: '', en: '' } : { ja: '（無効）', en: ' (inactive)' };
  const email = user.email ? ` <${user.email}>` : '';
  return {
    ja: `${user.name}${suffix[user.kind].ja}${inactive.ja}${email}`,
    en: `${user.name}${suffix[user.kind].en}${inactive.en}${email}`,
  };
}

export function subjectLabel(name: string, options: AuditOptions | undefined, metaLabel?: Label): Label {
  return metaLabel ?? options?.subjects.find((s) => s.name === name)?.label ?? { ja: name, en: name };
}
export function opLabel(op: string, options: AuditOptions | undefined): Label {
  return options?.ops.find((o) => o.name === op)?.label ?? { ja: op, en: op };
}

interface ExportAudit {
  rows?: unknown;
  total?: unknown;
  truncated?: unknown;
  columns?: unknown;
  where?: unknown;
  search?: unknown;
}
export function exportOf(item: AuditItem): ExportAudit | null {
  if (item.op !== 'export') return null;
  const value = item.after?.export;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ExportAudit) : null;
}
/** AC-20: "n rows (of m; cut at the limit) · columns · criteria" of a CSV export audit. */
export function exportSummary(item: AuditItem): Label | null {
  const e = exportOf(item);
  if (!e) return null;
  const rows = Number(e.rows ?? 0);
  const total = Number(e.total ?? rows);
  const columns = Array.isArray(e.columns) ? e.columns.map(String).join(', ') : '—';
  const criteria = [
    e.where && Object.keys(e.where as object).length ? JSON.stringify(e.where) : '',
    typeof e.search === 'string' && e.search ? `"${e.search}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const cut = e.truncated === true;
  return {
    ja: `${rows} 行（全 ${total} 件${cut ? '。上限で打ち切り' : ''}）・列: ${columns}・条件: ${criteria || 'なし'}`,
    en: `${rows} rows (of ${total}${cut ? '; cut at the limit' : ''}) · columns: ${columns} · criteria: ${criteria || 'none'}`,
  };
}
/** AC-20: a readable entity record opens its form, except for deletions and exports (no record to open). */
export function recordHref(item: AuditItem, readable: ReadonlySet<string>): string | null {
  if (!readable.has(item.entity) || item.op === 'delete' || item.op === 'export') return null;
  return `/e/${item.entity}/${item.recordId}`;
}
/**
 * AC-20: the page label. `null` is a later page this screen did not reach itself (a reload, Back or a shared link with
 * a cursor): its number is unknown, so none is claimed.
 */
export function pageLabel(page: number | null): Label {
  return page === null ? { ja: '続きのページ', en: 'A later page' } : { ja: `${page} ページ目`, en: `Page ${page}` };
}
/** AC-20: what the live region announces after a page loads. */
export function pageAnnouncement(count: number, more: boolean, page: number | null): Label {
  const name = pageLabel(page);
  return {
    ja: `${name.ja}: ${count} 件を表示${more ? '。続きがあります' : '。これで最後です'}。`,
    en: `${name.en}: ${count} records shown${more ? '; more follow' : '; this is the last page'}.`,
  };
}
