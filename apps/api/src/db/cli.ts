// Database CLI (spec AC-9): `tsx src/db/cli.ts <snapshot|generate [name]|migrate|reset>`.
//   snapshot  print registered tables and the SQL that `generate` would write (dry run)
//   generate  write a new migration when the registry differs from the last snapshot
//   migrate   apply pending migrations, then enforce RLS/grants (kernel runMigrations)
//   reset     drop everything, migrate, bootstrap the demo tenant and run every module seed
import { connect, dropAll, runMigrations, type Database } from '@daifuku/kernel';
import { loadRuntime } from '@daifuku/runtime';
import { loadDotEnv, requireEnv } from '../config.ts';
import { MIGRATIONS_DIR, pendingMigration, writeMigration } from './migrations.ts';


const out = (msg: string) => process.stdout.write(`${msg}\n`);

async function snapshot(): Promise<void> {
  const pending = await pendingMigration();
  out(JSON.stringify({ tables: Object.keys(pending.cur.tables), pendingStatements: pending.statements.length, statements: pending.statements }, null, 2));
}

async function generate(name: string): Promise<void> {
  const tag = await writeMigration(name);
  out(tag ? `wrote ${MIGRATIONS_DIR}${tag}.sql` : 'no schema changes; nothing written');
}

async function migrate(owner: Database): Promise<void> {
  await runMigrations(owner, MIGRATIONS_DIR);
  out(`migrated ${MIGRATIONS_DIR}`);
}

async function reset(owner: Database): Promise<void> {
  const { DEMO_TENANT, seedAll } = await import('./reset.ts');
  await dropAll(owner);
  await migrate(owner);
  const boot = await seedAll(owner);
  out(`seeded modules: ${boot.seededModules.join(', ') || '(none)'}`);
  out(`tenant ${boot.tenantId} company ${boot.companyId} admin ${DEMO_TENANT.adminEmail} / ${DEMO_TENANT.adminPassword}`);
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  await loadRuntime({ schema: true });
  if (cmd === 'snapshot') return snapshot();
  if (cmd === 'generate') return generate(arg ?? 'auto');
  if (cmd !== 'migrate' && cmd !== 'reset') {
    throw new Error(`usage: cli.ts <snapshot|generate [name]|migrate|reset> (got "${cmd ?? ''}")`);
  }
  loadDotEnv();
  const owner = connect(requireEnv('DATABASE_URL_OWNER'), { max: 2 });
  try {
    if (cmd === 'migrate') await migrate(owner);
    else await reset(owner);
  } finally {
    await owner.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
