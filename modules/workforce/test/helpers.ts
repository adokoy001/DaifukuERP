import { companyMemberships, hashPassword, newId, repo, runAction, users, type ContextParams } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { WorkforceSite, seedWorkforce } from '../src/index.ts';
export interface Command { id: string; version: number; status: string }
export const DAY = '2026-08-03';
export const NOW = '2026-09-12T09:00:00+09:00';
export const at = (value: string): Partial<ContextParams> => ({ now: () => new Date(value) });
export async function call(db: TestDb, person: Partial<ContextParams>, name: string, input: unknown, time = NOW): Promise<Command> {
  return db.run({ ...person, ...at(time) }, (ctx) => runAction(ctx, `workforce.${name}`, input)) as Promise<Command>;
}
export async function fixture() {
  const db = await freshDb();
  const sites = await db.run({}, async (ctx) => {
    await seedWorkforce(ctx);
    return [await repo(ctx, WorkforceSite).create({ code: 'A', name: '東拠点' }), await repo(ctx, WorkforceSite).create({ code: 'B', name: '西拠点' })];
  });
  const [site, otherSite] = sites;
  if (!site || !otherSite) throw new Error('Missing fixture sites');
  const siteId = site.id, otherSiteId = otherSite.id;
  async function person(name: string, role: string, siteIds: string[] = [siteId]) {
    const id = newId(), scoped = ['workforce_employee', 'workforce_manager'].includes(role);
    await db.owner.drizzle.insert(users).values({ id, tenantId: db.tenantId, email: `${name}@example.com`, name, passwordHash: hashPassword('test-password'), roles: [role], defaultCompanyId: db.companyId });
    await db.owner.drizzle.insert(companyMemberships).values({ tenantId: db.tenantId, companyId: db.companyId, userId: id, roles: [role], accessScope: scoped ? 'sites' : 'all', siteIds: scoped ? siteIds : [] });
    const params: Partial<ContextParams> = { actor: { type: 'user', id }, roles: [role], accessScope: scoped ? 'sites' : 'all', siteIds: scoped ? siteIds : [] };
    return { id, params };
  }
  const alice = await person('alice', 'workforce_employee'), bob = await person('bob', 'workforce_employee');
  const manager = await person('manager', 'workforce_manager'), remote = await person('remote', 'workforce_manager', [otherSiteId]);
  const hr = await person('hr', 'workforce_hr'), payroll = await person('payroll', 'workforce_payroll');
  const employee = await call(db, hr.params, 'register_employee', { userId: alice.id, siteId, code: 'A', name: 'Alice', hiredOn: '2026-01-01' });
  const otherEmployee = await call(db, hr.params, 'register_employee', { userId: bob.id, siteId, code: 'B', name: 'Bob', hiredOn: '2026-01-01' });
  return { db, siteId, otherSiteId, alice, bob, manager, remote, hr, payroll, employee, otherEmployee, person };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
