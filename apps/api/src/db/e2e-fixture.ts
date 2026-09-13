// Public CI/local E2E fixture. Never reset an existing database or apply industry packs before their UI tests.
import { connect, repo, runMigrations, systemParams, withContext, type Database } from '@daifuku/kernel';
import { FiscalYear, openFiscalYear } from '@daifuku/mod-accounting';
import { loadRuntime } from '@daifuku/runtime';
import { MIGRATIONS_DIR } from './migrations.ts';

const fail = (message: string): never => {
  throw new Error(`E2E fixture: ${message}`);
};

function fixtureUrls() {
  if (process.env.NODE_ENV === 'production') fail('production is not a fixture environment');
  if (process.env.E2E_PREPARE !== '1') fail('set E2E_PREPARE=1 to create synthetic test data');
  const owner = new URL(process.env.DATABASE_URL_OWNER ?? 'invalid');
  const app = new URL(process.env.DATABASE_URL ?? 'invalid');
  for (const url of [owner, app]) {
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^\/(daifuku_ci_e2e|daifuku_e2e_test(?:_[a-z0-9]+)?)$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      fail('use a loopback dedicated E2E database with no connection overrides');
  }
  if (
    owner.hostname !== app.hostname ||
    owner.port !== app.port ||
    owner.pathname !== app.pathname ||
    owner.username === app.username ||
    app.username !== 'daifuku_app'
  )
    fail('owner/app must be distinct roles on the same fixture database');
  return { owner: owner.href, app: app.href };
}

function businessDate() {
  const value =
    process.env.E2E_INVOICE_DATE ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    fail('E2E_INVOICE_DATE must be a valid YYYY-MM-DD date');
  return value;
}

async function assertEmpty(owner: Database, app: Database) {
  const [identity] = await owner.sql`select pg_get_userbyid(datdba) = current_user as owns_db,
    (select rolbypassrls from pg_roles where rolname = current_user) as bypass
    from pg_database where datname = current_database()`;
  if (!identity?.owns_db || !identity.bypass)
    fail('the owner connection must own the dedicated database and have migration BYPASSRLS');
  const [role] = await app.sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
  if (!role || role.rolsuper || role.rolbypassrls) fail('the app role must not be superuser or BYPASSRLS');
  const objects =
    await owner.sql`select nspname from pg_namespace where nspname not in ('public', 'information_schema') and nspname not like 'pg_%'
    union all select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
    union all select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all select n.nspname from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public'`;
  if (objects.length)
    fail('database is not empty; create a NEW dedicated database. No reset or overwrite is performed');
}

async function prepare(owner: Database, day: string) {
  await loadRuntime({ schema: true });
  await runMigrations(owner, MIGRATIONS_DIR);
  const { seedAll } = await import('./reset.ts');
  const { prepareIndustryDemoCompanies } = await import('./industry-demos.ts');
  const demo = await seedAll(owner);
  const industries = await prepareIndustryDemoCompanies(owner);
  // Date overrides and next-day cancellation also work on December 31. Core seeds cover the real current year.
  const year = Number(day.slice(0, 4));
  for (const company of [demo, ...industries]) {
    await withContext(owner, systemParams(company.tenantId, company.companyId), async (ctx) => {
      for (const y of [year, year + 1]) {
        const startDate = `${y}-01-01`;
        if ((await repo(ctx, FiscalYear).count({ startDate })) === 0) await openFiscalYear(ctx, { startDate });
      }
    });
  }
  process.stdout.write(
    `Prepared an empty E2E database: 4 synthetic companies, industry packs not yet applied; business date ${day}.\n`,
  );
}

async function main() {
  // Explicit process environment only: never load a user's .env to select a mutation target.
  const urls = fixtureUrls();
  const day = businessDate();
  const owner = connect(urls.owner, { max: 1 });
  const app = connect(urls.app, { max: 1 });
  try {
    const [lock] = await owner.sql`select pg_try_advisory_lock(1785467, 18) as acquired`;
    if (!lock?.acquired) fail('another preparation is running');
    await assertEmpty(owner, app);
    await prepare(owner, day);
  } finally {
    await app.close();
    await owner.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof Error && error.message.startsWith('E2E fixture:')
      ? `${error.message}\n`
      : 'E2E fixture failed; no reset was performed. Inspect the isolated database without publishing connection secrets.\n',
  );
  process.exitCode = 1;
});
