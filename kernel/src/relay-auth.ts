import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Context } from './context.ts';
import { makeContext, withContext, type Database } from './db/client.ts';
import { relayCredentials, relayPairings } from './db/relay-tables.ts';
import { companyMemberships } from './db/system-tables.ts';
import { assertOp } from './permissions.ts';
import { registry } from './registry.ts';
import { scopeCondition } from './repository/scope.ts';
import { DaifukuError } from './errors.ts';
import { newId } from './ids.ts';
import { consumeStepUp, lockIdentity } from './identity/common.ts';
import { opaqueToken, tokenHash } from './identity/crypto.ts';
import { withLock } from './transactions.ts';
import { writeAccessAudit } from './access-admin-common.ts';
export { relayCredentials, relayPairings } from './db/relay-tables.ts';
export interface RelayPrincipal {
  credentialId: string;
  tenantId: string;
  companyId: string;
  gatewayId: string;
  siteId: string;
  credentialVersion: number;
  expiresAt: Date;
}
const denied = () =>
  new DaifukuError(
    'PERMISSION_DENIED',
    'Relay credential is invalid or expired.',
    'Re-pair this gateway using an authorized operator.',
    undefined,
    401,
  );
const validSecret = (secret: string) => /^[A-Za-z0-9_-]{43}$/.test(secret);
export const withRelayLock = <T>(ctx: Context, gatewayId: string, work: () => Promise<T>) =>
  withLock(ctx, 'edge-gateway:' + gatewayId, work);
function principal(row: typeof relayCredentials.$inferSelect): RelayPrincipal {
  return {
    credentialId: row.id,
    tenantId: row.tenantId,
    companyId: row.companyId,
    gatewayId: row.gatewayId,
    siteId: row.siteId,
    credentialVersion: row.credentialVersion,
    expiresAt: row.expiresAt,
  };
}
export async function authenticateRelay(owner: Database, secret: string, now = new Date()): Promise<RelayPrincipal> {
  if (!validSecret(secret)) throw denied();
  const [row] = await owner.drizzle
    .select()
    .from(relayCredentials)
    .where(
      and(
        eq(relayCredentials.secretHash, tokenHash(secret)),
        eq(relayCredentials.active, true),
        gt(relayCredentials.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row) throw denied();
  return principal(row);
}
export async function assertRelayCredential(ctx: Context): Promise<RelayPrincipal> {
  const binding = ctx.relay;
  if (ctx.actor.type !== 'relay' || !binding || binding.gatewayId !== ctx.actor.id) throw denied();
  const [row] = await ctx.db
    .select()
    .from(relayCredentials)
    .where(
      and(
        eq(relayCredentials.id, binding.credentialId),
        eq(relayCredentials.tenantId, ctx.tenantId),
        eq(relayCredentials.companyId, ctx.companyId ?? ''),
        eq(relayCredentials.gatewayId, ctx.actor.id),
        eq(relayCredentials.siteId, binding.siteId),
        eq(relayCredentials.credentialVersion, binding.credentialVersion),
        eq(relayCredentials.active, true),
        gt(relayCredentials.expiresAt, ctx.now()),
      ),
    )
    .limit(1);
  if (!row) throw denied();
  return principal(row);
}
async function retire(ctx: Context, gatewayId: string) {
  await ctx.db
    .update(relayCredentials)
    .set({ active: false, revokedAt: ctx.now() })
    .where(
      and(
        eq(relayCredentials.tenantId, ctx.tenantId),
        eq(relayCredentials.companyId, ctx.companyId ?? ''),
        eq(relayCredentials.gatewayId, gatewayId),
        eq(relayCredentials.active, true),
      ),
    );
}
async function credential(
  ctx: Context,
  binding: { gatewayId: string; siteId: string },
  secret: string,
  rotationId?: string,
): Promise<RelayPrincipal> {
  if (!ctx.companyId || !validSecret(secret)) throw denied();
  const [old] = await ctx.db
    .select()
    .from(relayCredentials)
    .where(
      and(
        eq(relayCredentials.tenantId, ctx.tenantId),
        eq(relayCredentials.companyId, ctx.companyId),
        eq(relayCredentials.gatewayId, binding.gatewayId),
      ),
    )
    .orderBy(desc(relayCredentials.credentialVersion))
    .limit(1);
  await retire(ctx, binding.gatewayId);
  const [row] = await ctx.db
    .insert(relayCredentials)
    .values({
      id: newId(),
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      gatewayId: binding.gatewayId,
      siteId: binding.siteId,
      secretHash: tokenHash(secret),
      credentialVersion: (old?.credentialVersion ?? 0) + 1,
      expiresAt: new Date(ctx.now().getTime() + 90 * 86400000),
      ...(rotationId ? { rotationId } : {}),
    })
    .returning();
  if (!row) throw denied();
  return principal(row);
}
export async function issueRelayPairing(ctx: Context, gatewayId: string, siteId: string, stepUpToken: string) {
  if (
    !ctx.companyId ||
    ctx.actor.type !== 'user' ||
    ctx.sessionVersion === undefined ||
    (!ctx.roles.includes('admin') && !ctx.roles.includes('edge_manager'))
  )
    throw denied();
  await lockIdentity(ctx, ctx.sessionVersion);
  await consumeStepUp(ctx, stepUpToken, ctx.sessionVersion);
  await ctx.db
    .update(relayPairings)
    .set({ consumedAt: ctx.now() })
    .where(
      and(
        eq(relayPairings.tenantId, ctx.tenantId),
        eq(relayPairings.companyId, ctx.companyId),
        eq(relayPairings.gatewayId, gatewayId),
        isNull(relayPairings.consumedAt),
      ),
    );
  const token = opaqueToken();
  const expiresAt = new Date(ctx.now().getTime() + 600000);
  await ctx.db.insert(relayPairings).values({
    id: newId(),
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    gatewayId,
    siteId,
    issuedBy: ctx.actor.id,
    sessionVersion: ctx.sessionVersion,
    tokenHash: tokenHash(token),
    expiresAt,
  });
  await writeAccessAudit(ctx, ctx.companyId, 'relay', gatewayId, 'pairing_issued', null, {
    expiresAt: expiresAt.toISOString(),
  });
  return { pairingToken: token, expiresAt: expiresAt.toISOString() };
}
/** Binding is read only from the one-use server record. The caller validates its live business gateway in this transaction. */
export async function acceptRelayPairing<T>(
  owner: Database,
  app: Database,
  token: string,
  secret: string,
  verify: (ctx: Context, gatewayId: string, siteId: string) => Promise<T>,
): Promise<RelayPrincipal> {
  if (!validSecret(token) || !validSecret(secret)) throw denied();
  const [pair] = await owner.drizzle
    .select()
    .from(relayPairings)
    .where(
      and(
        eq(relayPairings.tokenHash, tokenHash(token)),
        isNull(relayPairings.consumedAt),
        gt(relayPairings.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!pair) throw denied();
  return withContext(
    app,
    { tenantId: pair.tenantId, companyId: pair.companyId, actor: { type: 'user', id: pair.issuedBy }, roles: [] },
    (ctx) =>
      withRelayLock(ctx, pair.gatewayId, async () => {
        const [current] = await ctx.db
          .select()
          .from(relayPairings)
          .where(eq(relayPairings.id, pair.id))
          .limit(1)
          .for('update');
        if (!current || current.consumedAt || current.expiresAt <= ctx.now()) throw denied();
        const live = await currentOperator(ctx, pair.sessionVersion);
        await verify(live, pair.gatewayId, pair.siteId);
        const made = await credential(ctx, pair, secret);
        await ctx.db.update(relayPairings).set({ consumedAt: ctx.now() }).where(eq(relayPairings.id, pair.id));
        await writeAccessAudit(ctx, ctx.companyId, 'relay', pair.gatewayId, 'paired', null, {
          credentialVersion: made.credentialVersion,
        });
        return made;
      }),
  );
}
export async function rotateRelayCredential(ctx: Context, rotationId: string, secret: string) {
  const old = await assertRelayCredential(ctx);
  if (
    tokenHash(secret) ===
    (await ctx.db.select().from(relayCredentials).where(eq(relayCredentials.id, old.credentialId)))[0]?.secretHash
  )
    throw denied();
  const made = await credential(ctx, old, secret, rotationId);
  await writeAccessAudit(ctx, ctx.companyId, 'relay', old.gatewayId, 'rotated', null, {
    credentialVersion: made.credentialVersion,
  });
  return made;
}
export async function revokeRelayCredentials(ctx: Context, gatewayId: string, stepUpToken: string, reason: string) {
  if (
    ctx.actor.type !== 'user' ||
    ctx.sessionVersion === undefined ||
    (!ctx.roles.includes('admin') && !ctx.roles.includes('edge_manager'))
  )
    throw denied();
  await lockIdentity(ctx, ctx.sessionVersion);
  await consumeStepUp(ctx, stepUpToken, ctx.sessionVersion);
  await retire(ctx, gatewayId);
  await ctx.db
    .update(relayPairings)
    .set({ consumedAt: ctx.now() })
    .where(
      and(
        eq(relayPairings.tenantId, ctx.tenantId),
        eq(relayPairings.gatewayId, gatewayId),
        isNull(relayPairings.consumedAt),
      ),
    );
  await writeAccessAudit(ctx, ctx.companyId, 'relay', gatewayId, 'revoked', null, { reason });
  return { ok: true as const };
}

/** Current company authorization under identity/membership locks; never a role elevation. */
async function currentOperator(ctx: Context, sessionVersion: number): Promise<Context> {
  // Membership removal changes membership before the user's default company; keep the same lock order.
  const [membership] = await ctx.db
    .select()
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.tenantId, ctx.tenantId),
        eq(companyMemberships.companyId, ctx.companyId ?? ''),
        eq(companyMemberships.userId, ctx.actor.id),
      ),
    )
    .limit(1)
    .for('share');
  const user = await lockIdentity(ctx, sessionVersion);
  if (!user.tenantAdmin && (!membership || !membership.roles.includes('edge_manager'))) throw denied();
  const authorization = user.tenantAdmin
    ? { roles: ['admin'], accessScope: 'all' as const, storeIds: [], siteIds: [] }
    : membership;
  if (!authorization) throw denied();
  return makeContext(ctx.db, {
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    actor: ctx.actor,
    roles: authorization.roles,
    accessScope: authorization.accessScope,
    siteIds: authorization.siteIds,
    storeIds: authorization.storeIds,
    sessionVersion,
    tenantAdmin: user.tenantAdmin,
    mfaVerified: ctx.mfaVerified === true,
    appliedPacks: ctx.appliedPacks ?? [],
    now: ctx.now,
    log: ctx.log,
    locale: ctx.locale,
    requestId: ctx.requestId,
  });
}
export async function withRelayOperator<T>(
  ctx: Context,
  gatewayId: string,
  work: (live: Context) => Promise<T>,
): Promise<T> {
  if (ctx.actor.type !== 'user' || ctx.sessionVersion === undefined) throw denied();
  const sessionVersion = ctx.sessionVersion;
  return withRelayLock(ctx, gatewayId, async () => work(await currentOperator(ctx, sessionVersion)));
}
export async function touchRelayPresence(ctx: Context): Promise<void> {
  const current = await assertRelayCredential(ctx);
  await ctx.db
    .update(relayCredentials)
    .set({ lastSeenAt: ctx.now() })
    .where(eq(relayCredentials.id, current.credentialId));
}
/** A read-only identity projection, limited by the gateway repository scope. Secrets never leave infrastructure. */
export async function relayPresence(ctx: Context, gatewayEntity: string) {
  const entity = registry.entity(gatewayEntity);
  assertOp(ctx, entity, 'read');
  return ctx.db
    .select({
      gatewayId: relayCredentials.gatewayId,
      lastSeenAt: relayCredentials.lastSeenAt,
      expiresAt: relayCredentials.expiresAt,
    })
    .from(relayCredentials)
    .innerJoin(entity.table, and(eq(entity.col('id'), relayCredentials.gatewayId), scopeCondition(ctx, entity)))
    .where(
      and(
        eq(relayCredentials.tenantId, ctx.tenantId),
        eq(relayCredentials.companyId, ctx.companyId ?? ''),
        eq(relayCredentials.active, true),
        gt(relayCredentials.expiresAt, ctx.now()),
      ),
    );
}
export { opaqueToken as newRelaySecret, tokenHash as relayHash } from './identity/crypto.ts';
