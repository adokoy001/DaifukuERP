// Users and passwords. Login lookups run on the owner connection because users are RLS-scoped by tenant.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { companies, companyMemberships, tenants, users } from './db/system-tables.ts';
import { newId } from './ids.ts';
import { StateError } from './errors.ts';
import { resolveCompanyAccess } from './company-access.ts';
import type { Principal } from './principal.ts';
export type { Principal } from './principal.ts';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const DUMMY_PASSWORD = hashPassword('not-a-real-login-password');

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
        eq(users.active, 1),
        tenantId ? eq(users.tenantId, tenantId) : undefined,
      ),
    )
    .limit(2);
  const user = rows[0];
  const valid = verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD);
  if (!user || rows.length > 1 || !valid) return null;
  return principalFrom(owner, user);
}

export async function loadPrincipal(owner: Database, userId: string): Promise<Principal | null> {
  const rows = await owner.drizzle
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.active, 1)))
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
    tenantAdmin: user.tenantAdmin === 1,
    sessionVersion: user.sessionVersion,
    mfaEnabled: user.mfaEnabled === 1,
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
      passwordHash: hashPassword(input.adminPassword),
      roles: ['admin'],
      tenantAdmin: 1,
      defaultCompanyId: companyId,
    });
    await tx.insert(companyMemberships).values({ tenantId, userId, companyId, roles: ['admin'] });
    return { tenantId, companyId, userId };
  });
}
