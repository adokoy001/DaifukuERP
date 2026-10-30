// Audit search (docs/specs/access-insight.md AC-8..AC-17, ADR-0007 addendum): one company's audit records (or the
// tenant's company-less administration records) filtered by period, user, subject, operation and record id, newest
// first, keyset-paginated. Read-only: the search writes nothing, never changes audit_log grants or triggers, and reads
// audit_log like auditTrail/accessAudit do (tenant RLS plus explicit tenant and company conditions). Before/after go
// through the record audit panel's filter (auditSnapshotFilter), and rows of registry entities the caller cannot read
// are excluded in SQL so pages stay full.
import { and, desc, eq, gte, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assertAccessAdmin } from './access-admin-common.ts';
import { auditSnapshotFilter } from './audit.ts';
import type { Context } from './context.ts';
import { auditLog, companyMemberships, users } from './db/system-tables.ts';
import { PermissionDenied, StateError, ValidationError } from './errors.ts';
import { label, type Label } from './i18n.ts';
import { isLocalDate, isUuid } from './ids.ts';
import { assertAccessInsight } from './kernel-capabilities.ts';
import { can } from './permissions.ts';
import { registry } from './registry.ts';

/** Longest period, counted in days with both ends included (AC-15): 2024-01-01..2024-12-31 is 366 days. */
export const AUDIT_SEARCH_MAX_DAYS = 366;
export const AUDIT_SEARCH_DEFAULT_LIMIT = 50;
export const AUDIT_SEARCH_MAX_LIMIT = 100;
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const DAY_MS = 86_400_000;
/** Japan has no daylight saving time: a business date is a fixed +09:00 day (todayLocal's Asia/Tokyo). */
const JST_OFFSET = '+09:00';
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export type AuditScope = 'company' | 'tenant';

export interface AuditSubjectDef {
  name: string;
  label: Label;
  scope: AuditScope;
}

/**
 * Audit subjects that are not registry entities: what kernel code writes with writeAudit / writeAccessAudit. Company
 * scope rows carry the company id; tenant scope rows are company-less (writeAccessAudit(ctx, null, …)). A unit test
 * scans the writers so a new subject cannot be missed (AC-17).
 */
export const AUDIT_SUBJECTS: readonly AuditSubjectDef[] = [
  { name: 'company_settings', label: label('会社設定', 'Company settings'), scope: 'company' },
  { name: 'company', label: label('会社', 'Company'), scope: 'company' },
  { name: 'company_membership', label: label('会社への所属', 'Company membership'), scope: 'company' },
  { name: 'relay', label: label('店舗端末の接続', 'Site device connection'), scope: 'company' },
  { name: 'access_user', label: label('利用者', 'User'), scope: 'tenant' },
  { name: 'identity', label: label('本人確認・ログイン', 'Identity and sign-in'), scope: 'tenant' },
];

/** Labels of the operations kernel and modules write (the generic OPS first). Other names are shown as stored. */
export const AUDIT_OP_LABELS: Readonly<Record<string, Label>> = {
  read: label('閲覧', 'Read'),
  create: label('作成', 'Create'),
  update: label('更新', 'Update'),
  delete: label('削除', 'Delete'),
  submit: label('確定', 'Submit'),
  cancel: label('取消', 'Cancel'),
  amend: label('改訂', 'Amend'),
  export: label('CSV 出力', 'CSV export'),
  supersede: label('差し替え', 'Supersede'),
  password_change: label('パスワード変更', 'Password change'),
  sessions_revoke: label('セッション失効', 'Sessions revoked'),
  invitation_queued: label('招待の送信', 'Invitation queued'),
  invitation_accepted: label('招待の受諾', 'Invitation accepted'),
  password_reset: label('パスワード再設定', 'Password reset'),
  mfa_enabled: label('多要素認証の有効化', 'MFA enabled'),
  mfa_disabled: label('多要素認証の無効化', 'MFA disabled'),
  mfa_login: label('多要素認証でのログイン', 'MFA sign-in'),
  mfa_recovery_used: label('回復コードの使用', 'Recovery code used'),
  mfa_recovery_regenerated: label('回復コードの再発行', 'Recovery codes regenerated'),
  oidc_linked: label('外部 ID の連携', 'External ID linked'),
  oidc_unlinked: label('外部 ID の連携解除', 'External ID unlinked'),
  pairing_issued: label('接続コードの発行', 'Pairing code issued'),
  paired: label('端末の接続', 'Device paired'),
  rotated: label('端末の鍵の更新', 'Device key rotated'),
  revoked: label('端末の接続の取消', 'Device connection revoked'),
};

const localDate = z.string().refine(isLocalDate, { message: 'Use an existing date as YYYY-MM-DD.' });
const limitSchema = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^\d{1,4}$/, { message: 'Use a whole number.' })
      .transform(Number),
  ])
  .pipe(z.number().int().min(1).max(AUDIT_SEARCH_MAX_LIMIT));

/** Days from `from` to `to`, both included (2024-01-01..2024-12-31 = 366). */
export function auditPeriodDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** The instants of a Japanese business-date period: [from 00:00+09:00, the day after `to` 00:00+09:00). */
export function auditPeriod(from: string, to: string): { start: Date; end: Date } {
  const start = new Date(`${from}T00:00:00${JST_OFFSET}`);
  const end = new Date(new Date(`${to}T00:00:00${JST_OFFSET}`).getTime() + DAY_MS);
  return { start, end };
}

export interface AuditCursor {
  /** UTC with microseconds, as Postgres stores `at` (a JS Date would cut it to milliseconds). */
  at: string;
  id: string;
}
export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id]), 'utf8').toString('base64url');
}
export function decodeAuditCursor(raw: string): AuditCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [at, id] = value as unknown[];
    if (typeof at !== 'string' || !CURSOR_AT.test(at) || Number.isNaN(Date.parse(at))) return null;
    if (typeof id !== 'string' || !isUuid(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export const auditSearchQuery = z
  .object({
    scope: z.enum(['company', 'tenant']).default('company'),
    from: localDate,
    to: localDate,
    userId: z.string().min(1).max(200).optional(),
    entity: z.string().regex(NAME, { message: 'Use a lower-case name of up to 64 characters.' }).optional(),
    op: z.string().regex(NAME, { message: 'Use a lower-case name of up to 64 characters.' }).optional(),
    recordId: z.uuid().optional(),
    limit: limitSchema.default(AUDIT_SEARCH_DEFAULT_LIMIT),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict()
  .superRefine((q, issue) => {
    // Zod keeps refining after a field issue: compare the period only when both ends are real dates.
    if (!isLocalDate(q.from) || !isLocalDate(q.to)) {
      // reported on the field itself
    } else if (q.from > q.to)
      issue.addIssue({ code: 'custom', path: ['to'], message: 'The end date is before the start date.' });
    else if (auditPeriodDays(q.from, q.to) > AUDIT_SEARCH_MAX_DAYS)
      issue.addIssue({
        code: 'custom',
        path: ['to'],
        message: `Choose at most ${AUDIT_SEARCH_MAX_DAYS} days (both ends included).`,
      });
    if (q.recordId && !q.entity)
      issue.addIssue({ code: 'custom', path: ['recordId'], message: 'A record id needs the subject (entity).' });
    if (q.cursor && !decodeAuditCursor(q.cursor))
      issue.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'The cursor is not valid; start from the first page.',
      });
  });
export type AuditSearchQuery = z.output<typeof auditSearchQuery>;
const optionsQuery = z.object({ scope: z.enum(['company', 'tenant']).default('company') }).strict();

function parseQuery<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success)
    throw new ValidationError(
      'Invalid audit search',
      parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
      'Fix the listed conditions; the period is required and spans at most 366 days.',
    );
  return parsed.data;
}

/** AC-11 order (2)..(4): after the base check and the query validation, the scope's own requirements. */
async function assertScope(ctx: Context, scope: AuditScope): Promise<void> {
  if (scope === 'tenant') {
    await assertAccessAdmin(ctx);
    return;
  }
  if (!ctx.companyId)
    throw new StateError(
      'The company audit search needs a selected company',
      'Choose a company first, or search the tenant administration records (scope=tenant).',
    );
}

/** Registry entities the caller cannot read (e.g. a pack not applied to this company): their rows are left out. */
export function unreadableEntities(ctx: Context): string[] {
  return registry
    .allEntities()
    .filter((def) => !can(ctx, def, 'read'))
    .map((def) => def.name)
    .sort();
}

export interface AuditSearchItem {
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
export interface AuditSearchResult {
  items: AuditSearchItem[];
  nextCursor: string | null;
}

async function userNames(ctx: Context, ids: Iterable<string>): Promise<Map<string, string>> {
  const list = [...new Set(ids)].filter(isUuid);
  if (!list.length) return new Map();
  const rows = await ctx.db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.tenantId, ctx.tenantId), inArray(users.id, list)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** The SQL of one search page (exported for the index measurement in the work log, via `.toSQL()`). */
export function auditSearchStatement(ctx: Context, q: AuditSearchQuery, hidden: readonly string[]) {
  const { start, end } = auditPeriod(q.from, q.to);
  const cursor = q.cursor ? decodeAuditCursor(q.cursor) : null;
  const atText = sql<string>`to_char(${auditLog.at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  return ctx.db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      atText,
      entity: auditLog.entity,
      recordId: auditLog.recordId,
      op: auditLog.op,
      action: auditLog.action,
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      onBehalfOf: auditLog.onBehalfOf,
      requestId: auditLog.requestId,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tenantId, ctx.tenantId),
        q.scope === 'tenant' ? isNull(auditLog.companyId) : eq(auditLog.companyId, ctx.companyId ?? ''),
        gte(auditLog.at, start),
        lt(auditLog.at, end),
        q.userId ? or(eq(auditLog.actorId, q.userId), eq(auditLog.onBehalfOf, q.userId)) : undefined,
        q.entity ? eq(auditLog.entity, q.entity) : undefined,
        q.op ? eq(auditLog.op, q.op) : undefined,
        q.recordId ? eq(auditLog.recordId, q.recordId) : undefined,
        hidden.length ? notInArray(auditLog.entity, [...hidden]) : undefined,
        cursor ? sql`(${auditLog.at}, ${auditLog.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(q.limit + 1);
}

/** GET /admin/audit (AC-8..AC-16). Check order: access (403), query (400), tenant scope (403), company (409). */
export async function searchAudit(ctx: Context, raw: unknown): Promise<AuditSearchResult> {
  assertAccessInsight(ctx);
  const q = parseQuery(auditSearchQuery, raw);
  await assertScope(ctx, q.scope);
  const hidden = unreadableEntities(ctx);
  if (q.entity && hidden.includes(q.entity)) throw new PermissionDenied(q.entity, 'audit', ctx.roles);
  const rows = await auditSearchStatement(ctx, q, hidden);
  const page = rows.slice(0, q.limit);
  const names = await userNames(
    ctx,
    page.flatMap((r) => [...(r.actorType === 'user' ? [r.actorId] : []), ...(r.onBehalfOf ? [r.onBehalfOf] : [])]),
  );
  const filters = new Map<string, ReturnType<typeof auditSnapshotFilter>>();
  const filterFor = (entity: string) => {
    let filter = filters.get(entity);
    if (!filter) {
      filter = auditSnapshotFilter(ctx, registry.hasEntity(entity) ? registry.entity(entity) : undefined);
      filters.set(entity, filter);
    }
    return filter;
  };
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      entity: r.entity,
      recordId: r.recordId,
      op: r.op,
      action: r.action,
      actorType: r.actorType,
      actorId: r.actorId,
      actorName: r.actorType === 'user' ? (names.get(r.actorId) ?? null) : null,
      onBehalfOf: r.onBehalfOf,
      onBehalfOfName: r.onBehalfOf ? (names.get(r.onBehalfOf) ?? null) : null,
      requestId: r.requestId,
      before: filterFor(r.entity)(r.before),
      after: filterFor(r.entity)(r.after),
    })),
    nextCursor: rows.length > q.limit && last ? encodeAuditCursor({ at: last.atText, id: last.id }) : null,
  };
}

export type AuditUserKind = 'member' | 'tenant_admin' | 'former' | 'user';
export interface AuditUserOption {
  id: string;
  name: string;
  active: boolean;
  kind: AuditUserKind;
  /** Tenant scope only (tenant administrators already see the user directory). */
  email?: string;
}
export interface AuditSubjectOption {
  name: string;
  label: Label;
  kind: 'entity' | 'kernel';
}
export interface AuditSearchOptions {
  scope: AuditScope;
  users: AuditUserOption[];
  subjects: AuditSubjectOption[];
  ops: { name: string; label: Label }[];
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id);

async function companyUsers(ctx: Context): Promise<AuditUserOption[]> {
  const companyId = ctx.companyId ?? '';
  const members = await ctx.db
    .select({ id: users.id, name: users.name, active: users.active })
    .from(users)
    .innerJoin(
      companyMemberships,
      and(
        eq(companyMemberships.tenantId, users.tenantId),
        eq(companyMemberships.userId, users.id),
        eq(companyMemberships.companyId, companyId),
      ),
    )
    .where(eq(users.tenantId, ctx.tenantId));
  const admins = await ctx.db
    .select({ id: users.id, name: users.name, active: users.active })
    .from(users)
    .where(and(eq(users.tenantId, ctx.tenantId), eq(users.tenantAdmin, true)));
  // Former members: membership audit rows of this company name them (record_id = the user), served by
  // audit_log_record_idx (tenant_id, entity, record_id).
  const past = await ctx.db
    .selectDistinct({ id: auditLog.recordId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tenantId, ctx.tenantId),
        eq(auditLog.entity, 'company_membership'),
        eq(auditLog.companyId, companyId),
      ),
    );
  const seen = new Set<string>();
  const out: AuditUserOption[] = [];
  const push = (rows: { id: string; name: string; active: boolean }[], kind: AuditUserKind) => {
    for (const row of rows)
      if (!seen.has(row.id)) {
        seen.add(row.id);
        out.push({ id: row.id, name: row.name, active: row.active, kind });
      }
  };
  push(members, 'member');
  push(admins, 'tenant_admin');
  const formerIds = past.map((r) => r.id).filter((id) => !seen.has(id));
  if (formerIds.length)
    push(
      await ctx.db
        .select({ id: users.id, name: users.name, active: users.active })
        .from(users)
        .where(and(eq(users.tenantId, ctx.tenantId), inArray(users.id, formerIds))),
      'former',
    );
  return out.sort(byName);
}

/** GET /admin/audit/options (AC-17): the filter choices of a scope. */
export async function auditSearchOptions(ctx: Context, raw: unknown): Promise<AuditSearchOptions> {
  assertAccessInsight(ctx);
  const { scope } = parseQuery(optionsQuery, raw);
  await assertScope(ctx, scope);
  const ops = Object.entries(AUDIT_OP_LABELS).map(([name, l]) => ({ name, label: l }));
  const kernel = AUDIT_SUBJECTS.filter((s) => s.scope === scope).map((s) => ({
    name: s.name,
    label: s.label,
    kind: 'kernel' as const,
  }));
  if (scope === 'tenant') {
    const people = await ctx.db
      .select({ id: users.id, name: users.name, email: users.email, active: users.active })
      .from(users)
      .where(eq(users.tenantId, ctx.tenantId));
    return {
      scope,
      users: people.map((p) => ({ ...p, kind: 'user' as const })).sort(byName),
      subjects: kernel,
      ops,
    };
  }
  const entities = registry
    .allEntities()
    .filter((def) => can(ctx, def, 'read'))
    .map((def) => ({
      name: def.name,
      label: registry.labelOverrides(def.name, ctx.appliedPacks ?? [])?.entity ?? def.config.label,
      kind: 'entity' as const,
    }))
    .sort((a, b) => a.label.ja.localeCompare(b.label.ja, 'ja') || a.name.localeCompare(b.name));
  return { scope, users: await companyUsers(ctx), subjects: [...entities, ...kernel], ops };
}
