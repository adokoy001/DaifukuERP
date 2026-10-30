// Machine credentials (API keys): docs/specs/machine-credentials.md, ADR-0023 addendum (2026-10-30).
// A tenant administrator issues a key bound to one company, roles, a purpose (mcp | integration) and an expiry. The
// key resolves to a normal ContextParams with actor `{ type: 'machine', id: <credential id> }`, so every read and
// write goes through the same Repository / action checks as a person. Only the SHA-256 hash of the secret is stored.
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  actorUser,
  assertAccessAdmin,
  availableRoles,
  managedCompany,
  parseAccess,
  writeAccessAudit,
} from './access-admin-common.ts';
import type { Context, ContextParams } from './context.ts';
import { withContext, type Database } from './db/client.ts';
import { machineCredentials } from './db/machine-tables.ts';
import { auditLog, companies, users } from './db/system-tables.ts';
import { Conflict, DaifukuError, NotFound, PermissionDenied, ValidationError } from './errors.ts';
import { isUuid, newId } from './ids.ts';
import { consumeStepUp, lockIdentity } from './identity/common.ts';
import { opaqueToken, tokenHash } from './identity/crypto.ts';
import { assertIdentityBudget, identityRateLimit } from './identity/rate-limit.ts';

export { machineCredentials } from './db/machine-tables.ts';

export const MACHINE_TOKEN_PREFIX = 'dfk_';
export const MACHINE_PURPOSES = ['mcp', 'integration'] as const;
export type MachinePurpose = (typeof MACHINE_PURPOSES)[number];
export const MACHINE_LIMITS = { maxActive: 100, maxDays: 365 } as const;
/** Rows of GET /admin/tokens (AC-20): every live key plus the newest revoked / expired ones up to this total. */
export const MACHINE_LIST_LIMIT = 500;
/** use_denied entries returned by the history (AC-21); issue / revoke are always returned. */
export const MACHINE_DENIED_HISTORY = 50;
/** AC-13: attempts per 5-minute window, for unknown keys per IP and for refused known keys per credential. */
export const MACHINE_AUTH_BUDGET = 100;
const LAST_USED_INTERVAL_MS = 60_000;
const DENIED_AUDIT_INTERVAL_MS = 3_600_000;
const ENTITY = 'machine_credential';
const DAY_MS = 86_400_000;

export type MachineDenialReason = 'revoked' | 'expired' | 'purpose_mismatch' | 'issuer_inactive' | 'company_mismatch';
export type MachineCredentialStatus = 'revoked' | 'expired' | 'suspended' | 'active';
export type MachineRevokeReason = 'issuer_deactivated' | 'issuer_demoted';

const TOKEN_FORMAT = /^dfk_[A-Za-z0-9_-]{43}$/;
/** `dfk_` + 43 base64url characters (32 random bytes). Anything else is never looked up. */
export const isMachineTokenFormat = (value: string): boolean => TOKEN_FORMAT.test(value);
export const newMachineToken = (): string => MACHINE_TOKEN_PREFIX + opaqueToken();

export const issueMachineCredentialSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    purpose: z.enum(MACHINE_PURPOSES),
    companyId: z.uuid(),
    roles: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
      .min(1)
      .max(50),
    expiresInDays: z.number().int().min(1).max(MACHINE_LIMITS.maxDays),
    stepUpToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const revokeMachineCredentialSchema = z.object({ reason: z.string().trim().max(200).optional() }).strict();

export interface MachinePrincipal {
  credentialId: string;
  tenantId: string;
  companyId: string;
  name: string;
  purpose: MachinePurpose;
  roles: string[];
  expiresAt: Date;
}

export interface MachineCredentialView {
  id: string;
  name: string;
  purpose: MachinePurpose;
  companyId: string;
  companyCode: string;
  companyName: string;
  roles: string[];
  issuedBy: { id: string; name: string };
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  lastDeniedAt: string | null;
  revokedAt: string | null;
  revokedBy: { id: string; name: string } | null;
  revokeReason: string | null;
  status: MachineCredentialStatus;
}

type CredentialRow = typeof machineCredentials.$inferSelect;
interface IssuerState {
  active: boolean;
  tenantAdmin: boolean;
}

/** One body for every refusal (AC-8): the reason is only in the audit (AC-14), never in the response. */
export const machineDenied = (): DaifukuError =>
  new DaifukuError(
    'PERMISSION_DENIED',
    'API key is invalid, expired or revoked.',
    'Ask a tenant administrator to issue a new API key (Administration > API keys).',
    undefined,
    401,
  );
const companyMismatch = (): DaifukuError =>
  new DaifukuError(
    'PERMISSION_DENIED',
    'The API key is bound to another company.',
    'Omit x-company-id or send the company of the API key; a key never switches companies.',
    undefined,
    403,
  );

/** AC-20 status, in this order: revoked, expired, suspended (issuer no longer an active tenant admin), active. */
export function machineCredentialStatus(
  row: { revokedAt: Date | null; expiresAt: Date },
  issuer: IssuerState | null | undefined,
  now: Date,
): MachineCredentialStatus {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (!issuer || !issuer.active || !issuer.tenantAdmin) return 'suspended';
  return 'active';
}

/** AC-8 / AC-10 refusal reason for a known key, or null when it may be used. */
export function machineDenialReason(
  row: { revokedAt: Date | null; expiresAt: Date; purpose: string; companyId: string },
  issuer: IssuerState | null | undefined,
  purpose: MachinePurpose,
  companyHeader: string | undefined,
  now: Date,
): MachineDenialReason | null {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (row.purpose !== purpose) return 'purpose_mismatch';
  if (!issuer || !issuer.active || !issuer.tenantAdmin) return 'issuer_inactive';
  if (companyHeader !== undefined && companyHeader !== row.companyId) return 'company_mismatch';
  return null;
}

/** AC-7: the request context of a key. tenantId and companyId come only from the credential row. */
export function machineContextParams(principal: MachinePrincipal): ContextParams {
  return {
    tenantId: principal.tenantId,
    companyId: principal.companyId,
    actor: { type: 'machine', id: principal.credentialId },
    roles: [...principal.roles],
    tenantAdmin: false,
    accessScope: 'all',
    storeIds: [],
    siteIds: [],
    mfaVerified: false,
  };
}

function principalOf(row: CredentialRow): MachinePrincipal {
  return {
    credentialId: row.id,
    tenantId: row.tenantId,
    companyId: row.companyId,
    name: row.name,
    purpose: row.purpose as MachinePurpose,
    roles: [...row.roles],
    expiresAt: row.expiresAt,
  };
}

/** AC-4: a tenant administrator's own human session; never an agent, a key, a relay or the system. */
async function assertKeyAdmin(ctx: Context, lock = false): Promise<number> {
  if (ctx.actor.type !== 'user' || ctx.sessionVersion === undefined)
    throw new PermissionDenied(ENTITY, 'manage', ctx.roles);
  await assertAccessAdmin(ctx, lock);
  return ctx.sessionVersion;
}

const issuer = alias(users, 'machine_issuer');
const revoker = alias(users, 'machine_revoker');

async function views(ctx: Context, where: ReturnType<typeof and>, limit?: number): Promise<MachineCredentialView[]> {
  const query = ctx.db
    .select({
      row: machineCredentials,
      companyCode: companies.code,
      companyName: companies.name,
      issuerName: issuer.name,
      issuerActive: issuer.active,
      issuerAdmin: issuer.tenantAdmin,
      revokerName: revoker.name,
    })
    .from(machineCredentials)
    .innerJoin(
      companies,
      and(eq(companies.tenantId, machineCredentials.tenantId), eq(companies.id, machineCredentials.companyId)),
    )
    .innerJoin(
      issuer,
      and(eq(issuer.tenantId, machineCredentials.tenantId), eq(issuer.id, machineCredentials.issuedBy)),
    )
    .leftJoin(
      revoker,
      and(eq(revoker.tenantId, machineCredentials.tenantId), eq(revoker.id, machineCredentials.revokedBy)),
    )
    .where(and(eq(machineCredentials.tenantId, ctx.tenantId), where))
    .orderBy(desc(machineCredentials.createdAt), desc(machineCredentials.id));
  const rows = limit === undefined ? await query : await query.limit(limit);
  const now = ctx.now();
  return rows.map(({ row, companyCode, companyName, issuerName, issuerActive, issuerAdmin, revokerName }) => ({
    id: row.id,
    name: row.name,
    purpose: row.purpose as MachinePurpose,
    companyId: row.companyId,
    companyCode,
    companyName,
    roles: [...row.roles],
    issuedBy: { id: row.issuedBy, name: issuerName },
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    lastDeniedAt: row.lastDeniedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedBy: row.revokedBy ? { id: row.revokedBy, name: revokerName ?? '' } : null,
    revokeReason: row.revokeReason,
    status: machineCredentialStatus(row, { active: issuerActive, tenantAdmin: issuerAdmin }, now),
  }));
}

async function view(ctx: Context, id: string): Promise<MachineCredentialView> {
  const [found] = await views(ctx, eq(machineCredentials.id, id), 1);
  if (!found) throw new NotFound(ENTITY, id);
  return found;
}

const live = (now: Date) => and(isNull(machineCredentials.revokedAt), gt(machineCredentials.expiresAt, now));

/** AC-20: every live key (at most 100 by AC-6), then the newest revoked / expired keys up to 500 in total. */
export async function listMachineCredentials(ctx: Context) {
  await assertKeyAdmin(ctx);
  const now = ctx.now();
  const active = await views(ctx, live(now));
  const room = Math.max(0, MACHINE_LIST_LIMIT - active.length);
  const ended = await views(
    ctx,
    or(isNotNull(machineCredentials.revokedAt), lte(machineCredentials.expiresAt, now)),
    room + 1,
  );
  const items = [...active, ...ended.slice(0, room)].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  const companyList = await ctx.db
    .select({ id: companies.id, code: companies.code, name: companies.name })
    .from(companies)
    .where(eq(companies.tenantId, ctx.tenantId))
    .orderBy(companies.code);
  return {
    items,
    truncated: ended.length > room,
    roles: availableRoles(),
    companies: companyList,
    limits: { ...MACHINE_LIMITS },
  };
}

/** AC-1..AC-6: issue a key after a single-use step-up; the secret is in this result only. */
export async function issueMachineCredential(ctx: Context, raw: unknown) {
  const sessionVersion = await assertKeyAdmin(ctx, true);
  const input = parseAccess(issueMachineCredentialSchema, raw);
  const allowed = new Set(availableRoles());
  const unknown = input.roles.flatMap((role, index) =>
    allowed.has(role) ? [] : [{ path: `roles.${index}`, message: `role "${role}" cannot be granted to an API key` }],
  );
  if (unknown.length)
    throw new ValidationError(
      'Invalid API key roles',
      unknown,
      'Choose roles from the list returned by GET /admin/tokens.',
    );
  const roles = [...new Set(input.roles)].sort();
  const company = await managedCompany(ctx, input.companyId);
  await lockIdentity(ctx, sessionVersion);
  await consumeStepUp(ctx, input.stepUpToken, sessionVersion);
  const now = ctx.now();
  const [counted] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(machineCredentials)
    .where(and(eq(machineCredentials.tenantId, ctx.tenantId), live(now)));
  if ((counted?.n ?? 0) >= MACHINE_LIMITS.maxActive)
    throw new Conflict(
      `The tenant already has ${MACHINE_LIMITS.maxActive} active API keys`,
      'Revoke API keys that are no longer used, then issue the new one.',
    );
  const token = newMachineToken();
  const expiresAt = new Date(now.getTime() + input.expiresInDays * DAY_MS);
  const id = newId();
  await ctx.db.insert(machineCredentials).values({
    id,
    tenantId: ctx.tenantId,
    companyId: company.id,
    name: input.name,
    purpose: input.purpose,
    roles,
    secretHash: tokenHash(token),
    issuedBy: ctx.actor.id,
    expiresAt,
    createdAt: now,
  });
  await writeAccessAudit(ctx, company.id, ENTITY, id, 'issue', null, {
    name: input.name,
    purpose: input.purpose,
    companyId: company.id,
    roles,
    expiresAt: expiresAt.toISOString(),
    issuedSessionVersion: sessionVersion,
  });
  return { token, credential: await view(ctx, id) };
}

async function auditRevoke(ctx: Context, row: CredentialRow): Promise<void> {
  await writeAccessAudit(
    ctx,
    row.companyId,
    ENTITY,
    row.id,
    'revoke',
    { revokedAt: null },
    { revokedAt: row.revokedAt?.toISOString() ?? null, reason: row.revokeReason },
  );
}

/** AC-17: idempotent and race-safe; only the call whose conditional update returns the row writes the audit. */
export async function revokeMachineCredential(ctx: Context, id: string, raw: unknown) {
  await assertKeyAdmin(ctx);
  const input = parseAccess(revokeMachineCredentialSchema, raw ?? {});
  if (!isUuid(id)) throw new NotFound(ENTITY, id);
  const [changed] = await ctx.db
    .update(machineCredentials)
    .set({ revokedAt: ctx.now(), revokedBy: ctx.actor.id, revokeReason: input.reason || null })
    .where(
      and(
        eq(machineCredentials.tenantId, ctx.tenantId),
        eq(machineCredentials.id, id),
        isNull(machineCredentials.revokedAt),
      ),
    )
    .returning();
  if (changed) await auditRevoke(ctx, changed);
  return { credential: await view(ctx, id) };
}

/**
 * AC-18: called by updateManagedUser in its transaction when a user is deactivated or loses tenant administration.
 * Revokes the user's live keys (same conditional update as AC-17) and returns how many were revoked.
 */
export async function revokeIssuedMachineCredentials(
  ctx: Context,
  userId: string,
  reason: MachineRevokeReason,
): Promise<number> {
  const now = ctx.now();
  const rows = await ctx.db
    .update(machineCredentials)
    .set({ revokedAt: now, revokedBy: actorUser(ctx), revokeReason: reason })
    .where(and(eq(machineCredentials.tenantId, ctx.tenantId), eq(machineCredentials.issuedBy, userId), live(now)))
    .returning();
  for (const row of rows) await auditRevoke(ctx, row);
  return rows.length;
}

/** AC-33: live keys per issuer, for the deactivation / demotion confirmation on /admin/users. */
export async function activeMachineCredentialCounts(ctx: Context): Promise<Record<string, number>> {
  const rows = await ctx.db
    .select({ issuedBy: machineCredentials.issuedBy, n: sql<number>`count(*)::int` })
    .from(machineCredentials)
    .where(and(eq(machineCredentials.tenantId, ctx.tenantId), live(ctx.now())))
    .groupBy(machineCredentials.issuedBy);
  return Object.fromEntries(rows.map((row) => [row.issuedBy, row.n]));
}

/** AC-21: every issue / revoke entry and the newest 50 use_denied entries, newest first. */
export async function machineCredentialAudit(ctx: Context, id: string) {
  await assertKeyAdmin(ctx);
  if (!isUuid(id)) throw new NotFound(ENTITY, id);
  const [exists] = await ctx.db
    .select({ id: machineCredentials.id })
    .from(machineCredentials)
    .where(and(eq(machineCredentials.tenantId, ctx.tenantId), eq(machineCredentials.id, id)))
    .limit(1);
  if (!exists) throw new NotFound(ENTITY, id);
  const scope = and(eq(auditLog.tenantId, ctx.tenantId), eq(auditLog.entity, ENTITY), eq(auditLog.recordId, id));
  const lifecycle = await ctx.db
    .select()
    .from(auditLog)
    .where(and(scope, inArray(auditLog.op, ['issue', 'revoke'])))
    .orderBy(desc(auditLog.at), desc(auditLog.id));
  const denied = await ctx.db
    .select()
    .from(auditLog)
    .where(and(scope, eq(auditLog.op, 'use_denied')))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(MACHINE_DENIED_HISTORY);
  const rows = [...lifecycle, ...denied].sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
  const userIds = [...new Set(rows.filter((r) => r.actorType === 'user').map((r) => r.actorId))].filter(isUuid);
  const names = new Map(
    userIds.length
      ? (
          await ctx.db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(and(eq(users.tenantId, ctx.tenantId), inArray(users.id, userIds)))
        ).map((u) => [u.id, u.name])
      : [],
  );
  return {
    items: rows.map((r) => {
      const after = (r.after ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        op: r.op,
        actorType: r.actorType,
        actorId: r.actorId,
        actorName: r.actorType === 'user' ? (names.get(r.actorId) ?? null) : null,
        at: r.at.toISOString(),
        reason: typeof after.reason === 'string' ? after.reason : null,
      };
    }),
  };
}

type Checked = { principal: MachinePrincipal } | { reason: MachineDenialReason; row: CredentialRow } | null;

/** Validates a known credential in its own tenant (RLS) and records the use (AC-15: at most once a minute). */
async function check(
  app: Database,
  tenantId: string,
  credentialId: string,
  purpose: MachinePurpose,
  companyHeader: string | undefined,
  now: Date,
): Promise<Checked> {
  return withContext(
    app,
    { tenantId, companyId: null, actor: { type: 'machine', id: credentialId }, roles: [], now: () => now },
    async (ctx) => {
      const [row] = await ctx.db
        .select()
        .from(machineCredentials)
        .where(and(eq(machineCredentials.tenantId, tenantId), eq(machineCredentials.id, credentialId)))
        .limit(1);
      if (!row) return null;
      const [owner] = await ctx.db
        .select({ active: users.active, tenantAdmin: users.tenantAdmin })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.id, row.issuedBy)))
        .limit(1);
      const reason = machineDenialReason(row, owner, purpose, companyHeader, now);
      if (reason) return { reason, row };
      await ctx.db
        .update(machineCredentials)
        .set({ lastUsedAt: now })
        .where(
          and(
            eq(machineCredentials.tenantId, tenantId),
            eq(machineCredentials.id, row.id),
            or(
              isNull(machineCredentials.lastUsedAt),
              lt(machineCredentials.lastUsedAt, new Date(now.getTime() - LAST_USED_INTERVAL_MS)),
            ),
          ),
        );
      return { principal: principalOf(row) };
    },
  );
}

/**
 * AC-14: the refusal audit commits in its own transaction, independent of the refused request, and at most once an
 * hour per credential and reason (conditional update, so concurrent refusals write one row).
 */
async function recordDenial(app: Database, row: CredentialRow, reason: MachineDenialReason, now: Date) {
  await withContext(
    app,
    { tenantId: row.tenantId, companyId: null, actor: { type: 'machine', id: row.id }, roles: [], now: () => now },
    async (ctx) => {
      const changed = await ctx.db
        .update(machineCredentials)
        .set({ lastDeniedAt: now, lastDeniedReason: reason })
        .where(
          and(
            eq(machineCredentials.tenantId, row.tenantId),
            eq(machineCredentials.id, row.id),
            or(
              isNull(machineCredentials.lastDeniedAt),
              ne(machineCredentials.lastDeniedReason, reason),
              lt(machineCredentials.lastDeniedAt, new Date(now.getTime() - DENIED_AUDIT_INTERVAL_MS)),
            ),
          ),
        )
        .returning({ id: machineCredentials.id });
      if (changed.length) await writeAccessAudit(ctx, row.companyId, ENTITY, row.id, 'use_denied', null, { reason });
    },
  );
}

export interface MachineAuthOptions {
  purpose: MachinePurpose;
  /** `x-company-id` (REST) or DAIFUKU_COMPANY_ID (MCP): must equal the credential's company when given (AC-10). */
  companyHeader?: string | undefined;
  /** Per-source budget for unknown keys (AC-13), e.g. `machine-auth:<ip>`. Omitted: no source budget. */
  budgetKey?: string | undefined;
  now?: Date;
}

/**
 * AC-7..AC-15. The hash lookup uses the owner connection (the tenant is not known yet, like password login and
 * authenticateRelay); everything else runs in the credential's tenant on the app connection. Valid keys never write
 * to the attempt budgets. Throws 401 (refused), 403 (company mismatch) or 429 (budget exhausted).
 */
export async function authenticateMachineCredential(
  owner: Database,
  app: Database,
  token: string,
  options: MachineAuthOptions,
): Promise<MachinePrincipal> {
  const now = options.now ?? new Date();
  const source = options.budgetKey ? { key: options.budgetKey, limit: MACHINE_AUTH_BUDGET } : null;
  if (source) await assertIdentityBudget(owner, source, now);
  const [found] = isMachineTokenFormat(token)
    ? await owner.drizzle
        .select({ id: machineCredentials.id, tenantId: machineCredentials.tenantId })
        .from(machineCredentials)
        .where(eq(machineCredentials.secretHash, tokenHash(token)))
        .limit(1)
    : [];
  const checked = found
    ? await check(app, found.tenantId, found.id, options.purpose, options.companyHeader, now)
    : null;
  if (!checked) {
    if (source) await identityRateLimit(owner, source.key, source.limit, 300, now);
    throw machineDenied();
  }
  if ('principal' in checked) return checked.principal;
  await recordDenial(app, checked.row, checked.reason, now);
  await identityRateLimit(owner, `machine-denied:${checked.row.id}`, MACHINE_AUTH_BUDGET, 300, now);
  throw checked.reason === 'company_mismatch' ? companyMismatch() : machineDenied();
}

/** AC-26: long-lived adapters (MCP) re-validate the credential and its issuer before every operation. */
export async function refreshMachineCredential(
  app: Database,
  principal: Pick<MachinePrincipal, 'credentialId' | 'tenantId' | 'companyId'>,
  purpose: MachinePurpose,
  now = new Date(),
): Promise<MachinePrincipal> {
  const checked = await check(app, principal.tenantId, principal.credentialId, purpose, principal.companyId, now);
  if (!checked) throw machineDenied();
  if ('principal' in checked) return checked.principal;
  await recordDenial(app, checked.row, checked.reason, now);
  throw machineDenied();
}
