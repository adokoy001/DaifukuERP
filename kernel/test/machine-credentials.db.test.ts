// docs/specs/machine-credentials.md: machine credentials on the app-role connection (RLS enforced). Issue with a
// single-use step-up, hash-only storage, authentication and refusal audits, budgets, revoke races, issuer coupling,
// the list and history, and the human-only kernel ports.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  accessDirectory,
  auditLog,
  authenticateMachineCredential,
  authorizedCompanies,
  bootstrapTenant,
  changeOwnPassword,
  companyMemberships,
  createCompany,
  createManagedUser,
  issueMachineCredential,
  issueRelayPairing,
  listMachineCredentials,
  lockIdentity,
  machineContextParams,
  machineCredentialAudit,
  machineCredentials,
  newId,
  putCompanyMembership,
  refreshMachineCredential,
  revokeMachineCredential,
  revokeOwnSessions,
  revokeRelayCredentials,
  stepUpIdentity,
  tokenHash,
  updateCompany,
  updateManagedUser,
  users,
  withAuthorizedCompany,
  withContext,
  withRelayOperator,
  type Context,
  type ContextParams,
  type MachinePrincipal,
} from '../src/index.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { assertAccessAdmin } from '../src/access-admin-common.ts';

let db: TestDb;
let now = new Date('2026-10-30T09:00:00Z');
const clock = () => now;
const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface Person {
  id: string;
  tenantId: string;
  companyId: string | null;
}
let admin: Person;
let other: { tenantId: string; companyId: string; admin: Person };

async function sessionVersion(userId: string): Promise<number> {
  const [row] = await db.owner.drizzle
    .select({ v: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.v ?? 0;
}

async function humanParams(person: Person, extra: Partial<ContextParams> = {}): Promise<ContextParams> {
  return {
    tenantId: person.tenantId,
    companyId: person.companyId,
    actor: { type: 'user', id: person.id },
    roles: ['admin'],
    tenantAdmin: true,
    accessScope: 'all',
    sessionVersion: await sessionVersion(person.id),
    now: clock,
    ...extra,
  };
}
const as = async <T>(person: Person, fn: (ctx: Context) => Promise<T>, extra: Partial<ContextParams> = {}) =>
  withContext(db.app, await humanParams(person, extra), fn);

async function stepUp(person: Person): Promise<string> {
  const v = await sessionVersion(person.id);
  const result = await as(person, (ctx) => stepUpIdentity(ctx, v, 'password', undefined, 'unused-without-mfa'));
  return result.stepUpToken;
}

const input = (patch: Record<string, unknown> = {}) => ({
  name: 'EC 連携',
  purpose: 'integration',
  companyId: db.companyId,
  roles: ['viewer'],
  expiresInDays: 30,
  ...patch,
});

async function issue(person: Person = admin, patch: Record<string, unknown> = {}) {
  const stepUpToken = await stepUp(person);
  return as(person, (ctx) => issueMachineCredential(ctx, { ...input(patch), stepUpToken, ...patch }));
}

const auth = (token: string, options: Partial<Parameters<typeof authenticateMachineCredential>[3]> = {}) =>
  authenticateMachineCredential(db.owner, db.app, token, { purpose: 'integration', now, ...options });

async function credentialRow(id: string) {
  const [row] = await db.owner.drizzle.select().from(machineCredentials).where(eq(machineCredentials.id, id));
  if (!row) throw new Error('missing credential');
  return row;
}
async function audits(id: string, op?: string) {
  return db.owner.drizzle
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.recordId, id), eq(auditLog.entity, 'machine_credential'), op ? eq(auditLog.op, op) : undefined),
    );
}

async function addUser(email: string, tenantAdmin: boolean, roles?: string[]): Promise<Person> {
  const created = await as(admin, (ctx) =>
    createManagedUser(ctx, { email, name: email.split('@')[0], password: 'password-password', tenantAdmin }),
  );
  // stepUpIdentity verifies 'password' in these tests: give the synthetic user the same password as the admin.
  const [hash] = await db.owner.drizzle.select({ h: users.passwordHash }).from(users).where(eq(users.id, admin.id));
  await db.owner.drizzle
    .update(users)
    .set({ passwordHash: hash?.h ?? null, defaultCompanyId: db.companyId })
    .where(eq(users.id, created.id));
  if (roles)
    await as(admin, (ctx) =>
      putCompanyMembership(ctx, created.id, db.companyId, {
        expectedVersion: 0,
        roles,
        accessScope: 'all',
        storeIds: [],
      }),
    );
  return { id: created.id, tenantId: db.tenantId, companyId: db.companyId };
}

beforeAll(async () => {
  db = await freshDb();
  admin = { id: db.adminUserId, tenantId: db.tenantId, companyId: db.companyId };
  const boot = await bootstrapTenant(db.owner, {
    tenantName: 'Other Tenant',
    companyCode: 'O1',
    companyName: '別テナント株式会社',
    adminEmail: 'other@example.com',
    adminName: 'Other',
    adminPassword: 'password',
  });
  other = {
    tenantId: boot.tenantId,
    companyId: boot.companyId,
    admin: { id: boot.userId, tenantId: boot.tenantId, companyId: boot.companyId },
  };
});
afterAll(async () => {
  await db?.close();
});

describe('issue (AC-1..AC-6)', () => {
  it('AC-1 AC-2 issues dfk_ keys, stores only the SHA-256 hash and audits the issue without the secret', async () => {
    const result = await issue(admin, { roles: ['viewer', 'settings', 'viewer'], name: '  会計連携  ' });
    expect(result.token).toMatch(/^dfk_[A-Za-z0-9_-]{43}$/);
    expect(result.credential).toMatchObject({
      name: '会計連携',
      purpose: 'integration',
      companyId: db.companyId,
      companyCode: 'T1',
      roles: ['settings', 'viewer'],
      issuedBy: { id: admin.id },
      status: 'active',
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(new Date(result.credential.expiresAt).getTime()).toBe(now.getTime() + 30 * DAY);
    expect(result.credential).not.toHaveProperty('secretHash');
    const row = await credentialRow(result.credential.id);
    expect(row.secretHash).toBe(tokenHash(result.token));
    const [issued] = await audits(row.id, 'issue');
    expect(issued?.companyId).toBe(db.companyId);
    expect(issued?.actorType).toBe('user');
    expect(issued?.after).toMatchObject({
      name: '会計連携',
      purpose: 'integration',
      companyId: db.companyId,
      roles: ['settings', 'viewer'],
      issuedSessionVersion: await sessionVersion(admin.id),
    });
    // No column of the credential row and no audit row contains the secret or any 8-character part of it.
    const stored = JSON.stringify({ row, audit: await audits(row.id) });
    const secret = result.token.slice(4);
    expect(stored).not.toContain(result.token);
    for (let i = 0; i + 8 <= secret.length; i++) expect(stored).not.toContain(secret.slice(i, i + 8));
    const listed = JSON.stringify(await as(admin, listMachineCredentials));
    expect(listed).not.toContain(secret.slice(0, 8));
    expect(listed).not.toContain(row.secretHash);
  });

  it('AC-3 rejects invalid input with 400 and stores nothing', async () => {
    const before = (await db.owner.drizzle.select().from(machineCredentials)).length;
    const auditsBefore = (await db.owner.drizzle.select().from(auditLog).where(eq(auditLog.op, 'issue'))).length;
    const stepUpToken = await stepUp(admin);
    for (const patch of [
      { name: '' },
      { purpose: 'web' },
      { roles: [] },
      { roles: ['relay'] },
      { roles: ['no_such_role'] },
      { expiresInDays: 366 },
      { accessScope: 'stores' },
      { tenantAdmin: true },
    ]) {
      const error = await as(admin, (ctx) => issueMachineCredential(ctx, { ...input(), stepUpToken, ...patch })).catch(
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ code: 'VALIDATION', httpStatus: 400 });
    }
    const unknownRole = await as(admin, (ctx) =>
      issueMachineCredential(ctx, { ...input({ roles: ['viewer', 'relay'] }), stepUpToken }),
    ).catch((e: unknown) => e);
    expect(unknownRole).toMatchObject({ details: { issues: [{ path: 'roles.1' }] } });
    expect((await db.owner.drizzle.select().from(machineCredentials)).length).toBe(before);
    expect((await db.owner.drizzle.select().from(auditLog).where(eq(auditLog.op, 'issue'))).length).toBe(auditsBefore);
  });

  it('AC-3a refuses a missing, used, foreign or stale step-up with 401', async () => {
    const used = await stepUp(admin);
    await as(admin, (ctx) => issueMachineCredential(ctx, { ...input(), stepUpToken: used }));
    await expect(
      as(admin, (ctx) => issueMachineCredential(ctx, { ...input(), stepUpToken: used })),
    ).rejects.toMatchObject({ httpStatus: 401 });
    await expect(
      as(admin, (ctx) => issueMachineCredential(ctx, { ...input(), stepUpToken: 'x'.repeat(43) })),
    ).rejects.toMatchObject({ httpStatus: 401 });
    const colleague = await addUser('stepup-colleague@example.com', true);
    const foreign = await stepUp(colleague);
    await expect(
      as(admin, (ctx) => issueMachineCredential(ctx, { ...input(), stepUpToken: foreign })),
    ).rejects.toMatchObject({ httpStatus: 401 });
    const stale = await stepUp(admin);
    await expect(
      as(admin, (ctx) => issueMachineCredential(ctx, { ...input(), stepUpToken: stale }), {
        sessionVersion: (await sessionVersion(admin.id)) + 1,
      }),
    ).rejects.toMatchObject({ httpStatus: 401 });
    // an expired step-up (5 minutes)
    const expired = await stepUp(admin);
    advance(6 * MIN);
    await expect(
      as(admin, (ctx) => issueMachineCredential(ctx, { ...input(), stepUpToken: expired })),
    ).rejects.toMatchObject({ httpStatus: 401 });
  });

  it('AC-4 refuses non-tenant-admins, agents, machines and store-limited sessions in every kernel function', async () => {
    const companyAdmin = await addUser('company-admin@example.com', false, ['admin']);
    const token = await stepUp(admin);
    const { credential } = await issue();
    const calls: ((ctx: Context) => Promise<unknown>)[] = [
      (ctx) => listMachineCredentials(ctx),
      (ctx) => issueMachineCredential(ctx, { ...input(), stepUpToken: token }),
      (ctx) => revokeMachineCredential(ctx, credential.id, {}),
      (ctx) => machineCredentialAudit(ctx, credential.id),
    ];
    const contexts: ContextParams[] = [
      await humanParams(companyAdmin, { tenantAdmin: false }),
      await humanParams(admin, { actor: { type: 'agent', id: 'mcp-agent', onBehalfOf: admin.id } }),
      { ...(await humanParams(admin)), actor: { type: 'machine', id: credential.id }, sessionVersion: undefined },
      await humanParams(admin, { accessScope: 'stores', storeIds: [newId()] }),
      await humanParams(admin, { sessionVersion: undefined }),
    ];
    for (const params of contexts)
      for (const call of calls)
        await expect(withContext(db.app, params, call)).rejects.toMatchObject({ httpStatus: 403 });
    expect((await credentialRow(credential.id)).revokedAt).toBeNull();
  });

  it('AC-5 answers 404 for a company of another tenant without revealing it', async () => {
    await expect(issue(admin, { companyId: other.companyId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
  });

  it('AC-6 counts live keys (suspended included) and refuses the 101st with 409', async () => {
    const boot = await bootstrapTenant(db.owner, {
      tenantName: 'Limit Tenant',
      companyCode: 'L1',
      companyName: '上限株式会社',
      adminEmail: 'limit@example.com',
      adminName: 'Limit',
      adminPassword: 'password',
    });
    const limitAdmin = { id: boot.userId, tenantId: boot.tenantId, companyId: boot.companyId };
    const inactive = newId();
    await db.owner.drizzle.insert(users).values({
      id: inactive,
      tenantId: boot.tenantId,
      email: 'gone@example.com',
      name: 'Gone',
      active: false,
      tenantAdmin: true,
    });
    const rows = (issuedBy: string, count: number, extra: Partial<typeof machineCredentials.$inferInsert> = {}) =>
      Array.from({ length: count }, () => ({
        id: newId(),
        tenantId: boot.tenantId,
        companyId: boot.companyId,
        name: 'seeded',
        purpose: 'integration',
        roles: ['viewer'],
        secretHash: tokenHash(newId()),
        issuedBy,
        expiresAt: new Date(now.getTime() + DAY),
        ...extra,
      }));
    // 90 active + 9 suspended (inactive issuer) + revoked and expired keys that do not count
    await db.owner.drizzle
      .insert(machineCredentials)
      .values([
        ...rows(boot.userId, 90),
        ...rows(inactive, 9),
        ...rows(boot.userId, 5, { revokedAt: now, revokedBy: boot.userId }),
        ...rows(boot.userId, 5, { expiresAt: new Date(now.getTime() - DAY) }),
      ]);
    const limitInput = { ...input(), companyId: boot.companyId };
    const first = await stepUp(limitAdmin);
    await as(limitAdmin, (ctx) => issueMachineCredential(ctx, { ...limitInput, stepUpToken: first }));
    const second = await stepUp(limitAdmin);
    await expect(
      as(limitAdmin, (ctx) => issueMachineCredential(ctx, { ...limitInput, stepUpToken: second })),
    ).rejects.toMatchObject({ code: 'CONFLICT', httpStatus: 409 });
    const listed = await as(limitAdmin, listMachineCredentials);
    expect(listed.items.filter((i) => i.status === 'suspended')).toHaveLength(9);
    expect(listed.limits).toEqual({ maxActive: 100, maxDays: 365 });
  });
});

describe('authentication, refusals and audits (AC-7..AC-15)', () => {
  it('AC-7 resolves a key to its tenant, company, roles and machine actor; writes are audited as machine', async () => {
    const { token, credential } = await issue(admin, { roles: ['admin'] });
    const principal = await auth(token, { companyHeader: db.companyId });
    expect(principal).toMatchObject({
      credentialId: credential.id,
      tenantId: db.tenantId,
      companyId: db.companyId,
      roles: ['admin'],
      purpose: 'integration',
    });
    const params = machineContextParams(principal);
    const company = await withContext(db.app, { ...params, now: clock }, async (ctx) => {
      const [row] = await ctx.db.execute(sql`select current_setting('app.tenant_id', true) as tenant`);
      return row;
    });
    expect(company).toMatchObject({ tenant: db.tenantId });
  });

  it('AC-8 AC-9 AC-14 refuses expired, revoked, wrong-purpose and orphaned keys with one 401 and audits each reason', async () => {
    const expiring = await issue(admin, { expiresInDays: 1 });
    await auth(expiring.token);
    advance(DAY);
    const expired = await auth(expiring.token).catch((e: unknown) => e);
    expect(expired).toMatchObject({ httpStatus: 401, message: 'API key is invalid, expired or revoked.' });

    const revoked = await issue();
    await as(admin, (ctx) => revokeMachineCredential(ctx, revoked.credential.id, { reason: 'rotated' }));
    const revokedError = await auth(revoked.token).catch((e: unknown) => e);

    const mcp = await issue(admin, { purpose: 'mcp' });
    const purposeError = await auth(mcp.token).catch((e: unknown) => e);
    await expect(auth(mcp.token, { purpose: 'mcp' })).resolves.toHaveProperty('purpose', 'mcp');

    const unknown = await auth(`dfk_${'z'.repeat(43)}`).catch((e: unknown) => e);
    const malformed = await auth('dfk_short').catch((e: unknown) => e);
    for (const error of [revokedError, purposeError, unknown, malformed])
      expect(error).toMatchObject({ httpStatus: 401, message: (expired as Error).message });

    const reasons = async (id: string) =>
      (await audits(id, 'use_denied')).map((a) => (a.after as { reason: string }).reason);
    expect(await reasons(expiring.credential.id)).toEqual(['expired']);
    expect(await reasons(revoked.credential.id)).toEqual(['revoked']);
    expect(await reasons(mcp.credential.id)).toEqual(['purpose_mismatch']);
    const [denied] = await audits(revoked.credential.id, 'use_denied');
    expect(denied).toMatchObject({ actorType: 'machine', actorId: revoked.credential.id, companyId: db.companyId });
    expect(JSON.stringify(denied)).not.toContain(revoked.token.slice(4, 12));
  });

  it('AC-14 writes at most one refusal audit per credential and reason per hour, also for concurrent refusals', async () => {
    const { token, credential } = await issue();
    await as(admin, (ctx) => revokeMachineCredential(ctx, credential.id, {}));
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => auth(token)));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(await audits(credential.id, 'use_denied')).toHaveLength(1);
    advance(30 * MIN);
    await auth(token).catch(() => undefined);
    expect(await audits(credential.id, 'use_denied')).toHaveLength(1);
    advance(31 * MIN);
    await auth(token).catch(() => undefined);
    expect(await audits(credential.id, 'use_denied')).toHaveLength(2);
    expect((await credentialRow(credential.id)).lastDeniedAt?.getTime()).toBe(now.getTime());
  });

  it('AC-10 refuses another company with 403 and an audit, and accepts the key company', async () => {
    const { token, credential } = await issue();
    await expect(auth(token, { companyHeader: other.companyId })).rejects.toMatchObject({ httpStatus: 403 });
    await expect(auth(token, { companyHeader: 'not-a-uuid' })).rejects.toMatchObject({ httpStatus: 403 });
    await expect(auth(token, { companyHeader: db.companyId })).resolves.toHaveProperty('companyId', db.companyId);
    expect((await audits(credential.id, 'use_denied')).map((a) => (a.after as { reason: string }).reason)).toEqual([
      'company_mismatch',
    ]);
  });

  it('AC-13 charges unknown keys to the source budget only and refused known keys to their own budget', async () => {
    const good = await issue();
    const bad = await issue();
    await as(admin, (ctx) => revokeMachineCredential(ctx, bad.credential.id, {}));
    // 150 refusals of a known (revoked) key from source A: the key gets 429, valid keys from A keep working.
    const codes: number[] = [];
    for (let i = 0; i < 150; i++)
      codes.push(
        await auth(bad.token, { budgetKey: 'machine-auth:test-a' }).then(
          () => 200,
          (e: { httpStatus: number }) => e.httpStatus,
        ),
      );
    expect(codes.slice(0, 100).every((c) => c === 401)).toBe(true);
    expect(codes.slice(100).every((c) => c === 429)).toBe(true);
    await expect(auth(good.token, { budgetKey: 'machine-auth:test-a' })).resolves.toHaveProperty(
      'credentialId',
      good.credential.id,
    );
    // 100 unknown keys from source B exhaust B; then every lookup from B is 429 and other sources are unaffected.
    for (let i = 0; i < 100; i++)
      await expect(
        auth(`dfk_${newId().replace(/-/g, '').padEnd(43, 'x')}`, { budgetKey: 'machine-auth:test-b' }),
      ).rejects.toMatchObject({
        httpStatus: 401,
      });
    await expect(auth(good.token, { budgetKey: 'machine-auth:test-b' })).rejects.toMatchObject({ httpStatus: 429 });
    await expect(auth(good.token, { budgetKey: 'machine-auth:test-c' })).resolves.toBeTruthy();
    // valid requests never write the budget: 120 concurrent successes from source D
    const ok = await Promise.all(
      Array.from({ length: 120 }, () => auth(good.token, { budgetKey: 'machine-auth:test-d' })),
    );
    expect(ok).toHaveLength(120);
    const [budget] = await db.owner.drizzle.execute(
      sql`select count(*)::int as n from identity_rate_limits where key = ${tokenHash('machine-auth:test-d')}`,
    );
    expect(budget).toMatchObject({ n: 0 });
  });

  it('AC-15 records the last use at most once a minute', async () => {
    const { token, credential } = await issue();
    await auth(token);
    const first = (await credentialRow(credential.id)).lastUsedAt;
    expect(first?.getTime()).toBe(now.getTime());
    advance(30_000);
    await auth(token);
    expect((await credentialRow(credential.id)).lastUsedAt?.getTime()).toBe(first?.getTime());
    advance(31_000);
    await auth(token);
    expect((await credentialRow(credential.id)).lastUsedAt?.getTime()).toBe(now.getTime());
  });

  it('AC-26 refresh re-validates revocation and the issuer for long-lived adapters', async () => {
    const { token, credential } = await issue(admin, { purpose: 'mcp' });
    const principal: MachinePrincipal = await auth(token, { purpose: 'mcp' });
    await expect(refreshMachineCredential(db.app, principal, 'mcp', now)).resolves.toHaveProperty('roles', ['viewer']);
    await as(admin, (ctx) => revokeMachineCredential(ctx, credential.id, {}));
    await expect(refreshMachineCredential(db.app, principal, 'mcp', now)).rejects.toMatchObject({ httpStatus: 401 });
    expect(await audits(credential.id, 'use_denied')).toHaveLength(1);
  });
});

describe('revoke, issuer coupling and immutability (AC-17..AC-19)', () => {
  it('AC-17 revokes once: repeated and concurrent revokes write one audit and return the same revoker', async () => {
    const { credential } = await issue();
    const colleague = await addUser('revoker@example.com', true);
    const [a, b] = await Promise.all([
      as(admin, (ctx) => revokeMachineCredential(ctx, credential.id, { reason: '不要になった' })),
      as(colleague, (ctx) => revokeMachineCredential(ctx, credential.id, { reason: 'second' })),
    ]);
    expect(a.credential.revokedBy?.id).toBe(b.credential.revokedBy?.id);
    expect(a.credential.status).toBe('revoked');
    const again = await as(admin, (ctx) => revokeMachineCredential(ctx, credential.id, {}));
    expect(again.credential.revokedAt).toBe(a.credential.revokedAt);
    const revokes = await audits(credential.id, 'revoke');
    expect(revokes).toHaveLength(1);
    expect(revokes[0]?.before).toEqual({ revokedAt: null });
    expect(revokes[0]?.after).toMatchObject({ revokedAt: a.credential.revokedAt });
    await expect(as(admin, (ctx) => revokeMachineCredential(ctx, newId(), {}))).rejects.toMatchObject({
      httpStatus: 404,
    });
  });

  it('AC-18 revokes the keys of a deactivated or demoted issuer, reports the count and never restores them', async () => {
    const issuer = await addUser('issuer@example.com', true);
    const a = await issue(issuer);
    const b = await issue(issuer, { purpose: 'mcp' });
    const ended = await issue(issuer, { expiresInDays: 1 });
    await as(admin, async (ctx) => {
      const counts = (await accessDirectory(ctx)).activeApiKeys;
      expect(counts[issuer.id]).toBe(3);
    });
    advance(DAY + MIN);
    const version = async () =>
      (await db.owner.drizzle.select({ v: users.version }).from(users).where(eq(users.id, issuer.id)))[0]?.v ?? 0;
    const result = await as(admin, async (ctx) =>
      updateManagedUser(ctx, issuer.id, { expectedVersion: await version(), active: false }),
    );
    expect(result.revokedMachineCredentials).toBe(2);
    for (const id of [a.credential.id, b.credential.id]) {
      const row = await credentialRow(id);
      expect(row).toMatchObject({ revokeReason: 'issuer_deactivated', revokedBy: admin.id });
      expect(await audits(id, 'revoke')).toHaveLength(1);
    }
    expect((await credentialRow(ended.credential.id)).revokedAt).toBeNull();
    const userAudit = await db.owner.drizzle
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.recordId, issuer.id), eq(auditLog.entity, 'access_user'), eq(auditLog.op, 'update')));
    expect(userAudit.at(-1)?.after).toMatchObject({ revokedMachineCredentials: 2 });
    await as(admin, async (ctx) =>
      updateManagedUser(ctx, issuer.id, { expectedVersion: await version(), active: true }),
    );
    expect((await credentialRow(a.credential.id)).revokedAt).not.toBeNull();
    await expect(auth(a.token)).rejects.toMatchObject({ httpStatus: 401 });

    const demoted = await addUser('demoted@example.com', true);
    const c = await issue(demoted);
    const demotedVersion =
      (await db.owner.drizzle.select({ v: users.version }).from(users).where(eq(users.id, demoted.id)))[0]?.v ?? 0;
    const demotion = await as(admin, (ctx) =>
      updateManagedUser(ctx, demoted.id, { expectedVersion: demotedVersion, tenantAdmin: false }),
    );
    expect(demotion.revokedMachineCredentials).toBe(1);
    expect((await credentialRow(c.credential.id)).revokeReason).toBe('issuer_demoted');
  });

  it('AC-8 AC-20 a key whose issuer changed outside updateManagedUser is suspended and refused', async () => {
    const issuer = await addUser('suspended-issuer@example.com', true);
    const { token, credential } = await issue(issuer);
    await db.owner.drizzle.update(users).set({ tenantAdmin: false }).where(eq(users.id, issuer.id));
    await expect(auth(token)).rejects.toMatchObject({ httpStatus: 401 });
    expect((await audits(credential.id, 'use_denied')).map((a) => (a.after as { reason: string }).reason)).toEqual([
      'issuer_inactive',
    ]);
    const listed = await as(admin, listMachineCredentials);
    expect(listed.items.find((i) => i.id === credential.id)?.status).toBe('suspended');
  });

  it('AC-19 the app role cannot delete machine credentials', async () => {
    const [grant] = await db.owner.drizzle.execute(
      sql`select has_table_privilege('daifuku_app', 'machine_credentials', 'DELETE') as del,
                 has_table_privilege('daifuku_app', 'machine_credentials', 'UPDATE') as upd`,
    );
    expect(grant).toMatchObject({ del: false, upd: true });
  });
});

describe('list and history (AC-20, AC-21)', () => {
  it('AC-20 always lists every live key, then recent ended keys up to 500, and flags truncation', async () => {
    const boot = await bootstrapTenant(db.owner, {
      tenantName: 'List Tenant',
      companyCode: 'LS',
      companyName: '一覧株式会社',
      adminEmail: 'list@example.com',
      adminName: 'List',
      adminPassword: 'password',
    });
    const listAdmin = { id: boot.userId, tenantId: boot.tenantId, companyId: boot.companyId };
    const base = (createdAt: Date, extra: Partial<typeof machineCredentials.$inferInsert> = {}) => ({
      id: newId(),
      tenantId: boot.tenantId,
      companyId: boot.companyId,
      name: 'k',
      purpose: 'integration',
      roles: ['viewer'],
      secretHash: tokenHash(newId()),
      issuedBy: boot.userId,
      expiresAt: new Date(now.getTime() + DAY),
      createdAt,
      ...extra,
    });
    const oldLive = base(new Date(now.getTime() - 100 * DAY));
    const ended = Array.from({ length: 520 }, (_, i) =>
      base(new Date(now.getTime() - i * MIN), { revokedAt: now, revokedBy: boot.userId }),
    );
    await db.owner.drizzle.insert(machineCredentials).values([oldLive, ...ended]);
    const listed = await as(listAdmin, listMachineCredentials);
    expect(listed.items).toHaveLength(500);
    expect(listed.truncated).toBe(true);
    expect(listed.items.some((i) => i.id === oldLive.id && i.status === 'active')).toBe(true);
    expect(listed.items.map((i) => i.createdAt)).toEqual([...listed.items.map((i) => i.createdAt)].sort().reverse());
    expect(listed.companies).toEqual([{ id: boot.companyId, code: 'LS', name: '一覧株式会社' }]);
    // another tenant sees none of these keys and gets 404 for their ids
    const mine = await as(admin, listMachineCredentials);
    expect(mine.items.some((i) => i.id === oldLive.id)).toBe(false);
    expect(mine.truncated).toBe(false);
    await expect(as(admin, (ctx) => revokeMachineCredential(ctx, oldLive.id, {}))).rejects.toMatchObject({
      httpStatus: 404,
    });
    await expect(as(admin, (ctx) => machineCredentialAudit(ctx, oldLive.id))).rejects.toMatchObject({
      httpStatus: 404,
    });
  });

  it('AC-21 returns issue and revoke always and the newest 50 refusals, with operator names', async () => {
    const { token, credential } = await issue();
    await auth(token, { purpose: 'mcp' }).catch(() => undefined);
    await as(admin, (ctx) => revokeMachineCredential(ctx, credential.id, { reason: '漏洩の疑い' }));
    for (let i = 0; i < 55; i++) {
      advance(HOUR + MIN);
      await auth(token).catch(() => undefined);
    }
    const history = await as(admin, (ctx) => machineCredentialAudit(ctx, credential.id));
    expect(history.items).toHaveLength(52);
    expect(history.items.filter((i) => i.op === 'use_denied')).toHaveLength(50);
    const issueEntry = history.items.find((i) => i.op === 'issue');
    expect(issueEntry).toMatchObject({ actorType: 'user', actorId: admin.id, actorName: 'Admin', reason: null });
    expect(history.items.find((i) => i.op === 'revoke')).toMatchObject({ reason: '漏洩の疑い', actorName: 'Admin' });
    expect(history.items[0]).toMatchObject({ op: 'use_denied', actorType: 'machine', reason: 'revoked' });
    expect(history.items.map((i) => i.at)).toEqual([...history.items.map((i) => i.at)].sort().reverse());
  });
});

describe('human-only kernel ports refuse a machine actor (AC-23)', () => {
  it('AC-23 lockIdentity, access administration, cross-company, relay, company and own-account ports fail closed', async () => {
    const { credential } = await issue(admin, { roles: ['admin'] });
    const machine: ContextParams = {
      ...machineContextParams({
        credentialId: credential.id,
        tenantId: db.tenantId,
        companyId: db.companyId,
        name: 'k',
        purpose: 'integration',
        roles: ['admin'],
        expiresAt: new Date(now.getTime() + DAY),
      }),
      now: clock,
    };
    const run = (fn: (ctx: Context) => Promise<unknown>) => withContext(db.app, machine, fn);
    const refusals: [string, (ctx: Context) => Promise<unknown>][] = [
      ['lockIdentity', (ctx) => lockIdentity(ctx)],
      ['assertAccessAdmin', (ctx) => assertAccessAdmin(ctx)],
      ['authorizedCompanies', (ctx) => authorizedCompanies(ctx)],
      ['withAuthorizedCompany', (ctx) => withAuthorizedCompany(ctx, db.companyId, async () => 'x')],
      ['issueRelayPairing', (ctx) => issueRelayPairing(ctx, newId(), newId(), 'x'.repeat(43))],
      ['revokeRelayCredentials', (ctx) => revokeRelayCredentials(ctx, newId(), 'x'.repeat(43), 'r')],
      ['withRelayOperator', (ctx) => withRelayOperator(ctx, newId(), async () => 'x')],
      ['createCompany', (ctx) => createCompany(ctx, { code: 'MX', name: 'Machine Co' })],
      ['updateCompany', (ctx) => updateCompany(ctx, db.companyId, { name: 'renamed' })],
      [
        'changeOwnPassword',
        (ctx) => changeOwnPassword(ctx, 1, { currentPassword: 'password', newPassword: 'x'.repeat(12) }),
      ],
      ['revokeOwnSessions', (ctx) => revokeOwnSessions(ctx, 1, {})],
      [
        'createManagedUser',
        (ctx) => createManagedUser(ctx, { email: 'm@example.com', name: 'm', password: 'x'.repeat(12) }),
      ],
      ['listMachineCredentials', (ctx) => listMachineCredentials(ctx)],
    ];
    for (const [name, fn] of refusals) {
      const error = await run(fn).catch((e: unknown) => e);
      expect(error, name).toMatchObject({ code: 'PERMISSION_DENIED' });
      expect([401, 403], name).toContain((error as { httpStatus: number }).httpStatus);
    }
    const memberships = await db.owner.drizzle
      .select()
      .from(companyMemberships)
      .where(eq(companyMemberships.tenantId, db.tenantId));
    expect(memberships.every((m) => m.userId !== credential.id)).toBe(true);
  });
});
