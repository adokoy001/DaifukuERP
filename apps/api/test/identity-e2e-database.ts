import { bootstrapTenant, connect, type Database } from '@daifuku/kernel';
import { createSchemaFromScratch } from '@daifuku/kernel/schema-tooling';
import { loadRuntime } from '@daifuku/runtime';
const fail = (): never => {
  throw new Error('Identity fixture requires distinct safe roles and an empty loopback enterprise E2E database.');
};
export function identityFixtureUrls(env: Readonly<Record<string, string | undefined>>) {
  if (env.NODE_ENV === 'production' || env.E2E_IDENTITY_PREPARE !== '1') fail();
  const owner = new URL(env.TEST_DATABASE_URL_OWNER ?? 'invalid');
  const app = new URL(env.TEST_DATABASE_URL ?? 'invalid');
  for (const url of [owner, app])
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^\/daifuku_(?:ci_enterprise_e2e|e2e_test_enterprise(?:_[a-z0-9]+)?)$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      fail();
  if (
    owner.hostname !== app.hostname ||
    owner.port !== app.port ||
    owner.pathname !== app.pathname ||
    owner.username === app.username ||
    app.username !== 'daifuku_app'
  )
    fail();
  return { owner: owner.href, app: app.href };
}
async function assertEmpty(owner: Database, app: Database) {
  const [lock] = await owner.sql`select pg_try_advisory_lock(1785467, 22) as acquired`;
  if (!lock?.acquired) fail();
  const [identity] = await owner.sql`select pg_get_userbyid(datdba) = current_user as owns_db,
    (select rolbypassrls from pg_roles where rolname = current_user) as bypass from pg_database where datname = current_database()`;
  const [role] = await app.sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
  if (!identity?.owns_db || !identity.bypass || !role || role.rolsuper || role.rolbypassrls) fail();
  const objects =
    await owner.sql`select nspname from pg_namespace where nspname not in ('public', 'information_schema') and nspname not like 'pg_%'
    union all select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
    union all select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all select n.nspname from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public'`;
  if (objects.length) fail();
}
export async function identityFixtureDatabase() {
  const urls = identityFixtureUrls(process.env);
  const owner = connect(urls.owner, { max: 1 });
  const app = connect(urls.app, { max: 4 });
  try {
    await assertEmpty(owner, app);
    await loadRuntime({ schema: true });
    await createSchemaFromScratch(owner);
    const boot = await bootstrapTenant(owner, {
      tenantName: 'Synthetic Identity',
      companyCode: 'IDENTITY',
      companyName: '認証試験株式会社',
      adminEmail: 'admin@example.com',
      adminName: 'Synthetic Admin',
      adminPassword: 'identity-test-password',
    });
    return {
      owner,
      app,
      tenantId: boot.tenantId,
      close: async () => {
        await app.close();
        await owner.close();
      },
    };
  } catch (error) {
    await app.close();
    await owner.close();
    throw error;
  }
}
