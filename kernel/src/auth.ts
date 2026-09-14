// Users and passwords. Login lookups run on the owner connection because users are RLS-scoped by tenant.
import { DUMMY_PASSWORD_HASH, hashPassword, passwordNeedsRehash, verifyPassword } from './password-hash.ts';
export { hashPassword, verifyPassword } from './password-hash.ts';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { companies, companyMemberships, tenants, users } from './db/system-tables.ts';
import { newId } from './ids.ts';
import { StateError } from './errors.ts';
import { resolveCompanyAccess } from './company-access.ts';
import type { Principal } from './principal.ts';
export type { Principal } from './principal.ts';

/** Finds an active user by email across tenants (owner connection; bypasses RLS by design for login only). */
export async function authenticate(
  owner: Database,
  email: string,
  password: string,
  tenantId?: string,
): Promise<Principal | null> {
  const rows = await owner.drizzle
    .select()
    .from(users)
    .where(
      and(
        eq(users.email, email.toLowerCase()),
        eq(users.active, true),
        tenantId ? eq(users.tenantId, tenantId) : undefined,
      ),
    )
    .limit(2);
  const user = rows[0];
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || rows.length > 1 || !valid || !user.passwordHash) return null;
  let acceptedHash = user.passwordHash;
  if (passwordNeedsRehash(acceptedHash)) {
    const upgraded = await hashPassword(password);
    const [changed] = await owner.drizzle
      .update(users)
      .set({ passwordHash: upgraded })
      .where(
        and(
          eq(users.id, user.id),
          eq(users.tenantId, user.tenantId),
          eq(users.active, true),
          eq(users.sessionVersion, user.sessionVersion),
          eq(users.passwordHash, acceptedHash),
        ),
      )
      .returning({ id: users.id });
    if (changed) acceptedHash = upgraded;
    else {
      // Another login may have upgraded the same hash. A reset, revoke or deactivation must still win.
      const [current] = await owner.drizzle
        .select()
        .from(users)
        .where(
          and(
            eq(users.id, user.id),
            eq(users.tenantId, user.tenantId),
            eq(users.active, true),
            eq(users.sessionVersion, user.sessionVersion),
          ),
        )
        .limit(1);
      if (!current?.passwordHash || !(await verifyPassword(password, current.passwordHash))) return null;
      acceptedHash = current.passwordHash;
    }
  }
  if (!acceptedHash) return null;
  // Crypto yields: do not return the identity captured before a concurrent password/security update.
  const [current] = await owner.drizzle
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, user.id),
        eq(users.tenantId, user.tenantId),
        eq(users.active, true),
        eq(users.sessionVersion, user.sessionVersion),
        eq(users.passwordHash, acceptedHash),
      ),
    )
    .limit(1);
  return current ? principalFrom(owner, current) : null;
}

export async function loadPrincipal(owner: Database, userId: string): Promise<Principal | null> {
  const rows = await owner.drizzle
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.active, true)))
    .limit(1);
  const user = rows[0];
  if (!user) return null;
  return principalFrom(owner, user);
}

function principalFrom(owner: Database, user: typeof users.$inferSelect): Promise<Principal> {
  const principal: Principal = {
    userId: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    roles: [],
    defaultCompanyId: user.defaultCompanyId,
    tenantAdmin: user.tenantAdmin,
    sessionVersion: user.sessionVersion,
    mfaEnabled: user.mfaEnabled,
    accessScope: 'all',
    storeIds: [],
    siteIds: [],
  };
  return resolveCompanyAccess(owner, principal, user.defaultCompanyId);
}

export interface BootstrapInput {
  /** Stable tenant identity for idempotent provisioning. Omit to create a new tenant. */
  tenantId?: string;
  tenantName: string;
  companyCode: string;
  companyName: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
}

/** Creates a tenant and admin. Idempotency is explicitly scoped by tenantId, never by a global email. */
export async function bootstrapTenant(
  owner: Database,
  input: BootstrapInput,
): Promise<{ tenantId: string; companyId: string; userId: string }> {
  const tenantId = input.tenantId ?? newId();
  const companyId = newId();
  const userId = newId();
  return owner.drizzle.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`bootstrap:${tenantId}`}, 0))`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    const existing = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, input.adminEmail.toLowerCase())))
      .limit(1);
    const found = existing[0];
    if (found) {
      const company = found.defaultCompanyId
        ? await tx
            .select({ id: companies.id })
            .from(companies)
            .where(and(eq(companies.tenantId, tenantId), eq(companies.id, found.defaultCompanyId)))
            .limit(1)
        : [];
      if (!company[0])
        throw new StateError(
          'Existing tenant administrator has no valid default company',
          'Repair the company assignment before provisioning again.',
        );
      return { tenantId: found.tenantId, companyId: company[0].id, userId: found.id };
    }
    await tx.insert(tenants).values({ id: tenantId, name: input.tenantName });
    await tx.insert(companies).values({ id: companyId, tenantId, code: input.companyCode, name: input.companyName });
    await tx.insert(users).values({
      id: userId,
      tenantId,
      email: input.adminEmail.toLowerCase(),
      name: input.adminName,
      passwordHash: await hashPassword(input.adminPassword),
      roles: ['admin'],
      tenantAdmin: true,
      defaultCompanyId: companyId,
    });
    await tx.insert(companyMemberships).values({ tenantId, userId, companyId, roles: ['admin'] });
    return { tenantId, companyId, userId };
  });
}
