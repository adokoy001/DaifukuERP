// Explicit acceptance runner: never falls back to TEST_DATABASE_URL or the user's application database.
// Requires protected SETUP_TEST_ENV_FILE pointing at a new daifuku_setup_test database and pre-created restore DBs.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { authenticate, connect, hashPassword, newId, type Database } from '@daifuku/kernel';
import { loadRuntime } from '@daifuku/runtime';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { MIGRATIONS_DIR, readJournal } from '../src/db/migrations.ts';
import { history } from '../src/setup/catalog.ts';
import { runSetup } from '../src/setup/execute.ts';
import { exists, privateFile, readState, writeExclusive } from '../src/setup/files.ts';
import { buildPlan, relationNames } from '../src/setup/inspect.ts';
import { safeFailure, SetupError, type SetupOptions } from '../src/setup/types.ts';

let phase = 'prepare';
const step = (name: string) => {
  phase = name;
  process.stdout.write(`setup acceptance: ${name}\n`);
};
const replaceDatabase = (url: string, database: string) => {
  const value = new URL(url);
  value.pathname = `/${database}`;
  return value.toString();
};
async function useDb<T>(url: string, fn: (db: Database) => Promise<T>): Promise<T> {
  const db = connect(url, { max: 1 });
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

async function sourceFolders(root: string) {
  const journal = readJournal(),
    legacy = join(root, 'legacy-0008'),
    synthetic = join(root, 'synthetic');
  for (const dir of [legacy, synthetic]) await mkdir(join(dir, 'meta'), { recursive: true, mode: 0o700 });
  for (const entry of journal.entries) {
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(synthetic, `${entry.tag}.sql`));
    await copyFile(
      join(MIGRATIONS_DIR, 'meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`),
      join(synthetic, 'meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`),
    );
    if (entry.idx <= 8) await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(legacy, `${entry.tag}.sql`));
  }
  await writeFile(
    join(legacy, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx <= 8) }),
  );
  const last = journal.entries.at(-1);
  assert(last && last.idx >= 9, '0009 release migration is required');
  const next = {
    ...last,
    idx: last.idx + 1,
    when: last.when + 1,
    tag: `${String(last.idx + 1).padStart(4, '0')}_setup_acceptance`,
  };
  await writeFile(
    join(synthetic, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: [...journal.entries, next] }),
  );
  await copyFile(
    join(synthetic, 'meta', `${String(last.idx).padStart(4, '0')}_snapshot.json`),
    join(synthetic, 'meta', `${String(next.idx).padStart(4, '0')}_snapshot.json`),
  );
  await writeFile(join(synthetic, `${next.tag}.sql`), 'SELECT 1 / 0;\n');
  return { legacy, synthetic, next };
}
async function populateLegacy(url: string, folder: string) {
  const tenant = newId(),
    company = newId(),
    user = newId(),
    password = 'Original-LegacyCredential9!',
    hash = hashPassword(password);
  await useDb(url, async (db) => {
    assert.equal((await relationNames(db)).length, 0, 'legacy test DB must be new');
    await migrate(db.drizzle, { migrationsFolder: folder });
    await db.sql`insert into tenants(id,name) values(${tenant},'Legacy setup')`;
    await db.sql`insert into companies(id,tenant_id,code,name,settings) values(${company},${tenant},'LEGACY','Preserve company',${JSON.stringify({ custom: 'keep', 'tax.price_includes_tax': true })}::jsonb)`;
    await db.sql`insert into users(id,tenant_id,email,name,password_hash,roles,default_company_id) values(${user},${tenant},'legacy-admin@example.test','Legacy Admin',${hash},${JSON.stringify(['admin'])}::jsonb,${company})`;
  });
  return { tenant, company, user, password, hash };
}
async function interruptInstallation(options: SetupOptions, envFile: string) {
  await assert.rejects(
    runSetup(options, {
      checkpoint: async (name) => {
        if (name === 'migrated') throw new SetupError('INJECTED', 'acceptance failure');
      },
    }),
    { code: 'INJECTED' },
  );
  const state = await readState(options.stateDir);
  assert(state?.identity);
  const runtime = parseEnv(await privateFile(join(options.stateDir, 'runtime.env')));
  const upgradeEnv = join(dirname(envFile), 'wrong-mode.env');
  await writeExclusive(upgradeEnv, `${await privateFile(envFile)}JWT_SECRET=${runtime.JWT_SECRET}\n`);
  await assert.rejects(runSetup({ ...options, mode: 'upgrade', envFile: upgradeEnv }), { code: 'STATE_MODE' });
  await assert.rejects(
    runSetup(
      { ...options, envFile },
      {
        checkpoint: async (name) => {
          if (name === 'bootstrap-committed') throw new SetupError('INJECTED', 'acceptance failure');
        },
      },
    ),
    { code: 'INJECTED' },
  );
}
async function verifyCliPlan(options: SetupOptions) {
  const { stdout, stderr } = await promisify(execFile)('pnpm', [
    'run',
    'setup',
    'install',
    '--env',
    options.envFile,
    '--state-dir',
    options.stateDir,
  ]);
  const source = parseEnv(await privateFile(options.envFile));
  for (const value of [source.DATABASE_URL_OWNER, source.DATABASE_URL, source.RESTORE_CHECK_URL, source.JWT_SECRET])
    if (value) {
      assert(!(stdout + stderr).includes(value));
      if (value.startsWith('postgres:'))
        assert(!(stdout + stderr).includes(decodeURIComponent(new URL(value).password)));
    }
  assert(stdout.includes('計画のみ'));
  assert.equal(await exists(options.stateDir), false);
}
async function main(): Promise<void> {
  const input = process.env.SETUP_TEST_ENV_FILE;
  if (!input)
    throw new SetupError(
      'TEST_ENV_REQUIRED',
      'SETUP_TEST_ENV_FILEで専用保護envを明示してください。接続先のfallbackはありません。',
    );
  const originalEnv = await privateFile(input),
    env = parseEnv(originalEnv);
  assert(env.DATABASE_URL_OWNER && env.DATABASE_URL && env.RESTORE_CHECK_URL);
  const ownerUrl = env.DATABASE_URL_OWNER,
    appUrl = env.DATABASE_URL;
  assert.equal(new URL(ownerUrl).hostname, '127.0.0.1');
  const databaseName = decodeURIComponent(new URL(ownerUrl).pathname.slice(1));
  assert.match(databaseName, /^daifuku_setup_test(?:_\d+)?$/);
  const suffix = databaseName.slice('daifuku_setup_test'.length);
  await loadRuntime({ schema: true });
  await useDb(ownerUrl, async (db) =>
    assert.equal((await relationNames(db)).length, 0, 'explicit test DB must be new'),
  );
  const artifact = await mkdtemp(join(dirname(input), 'acceptance-'));
  const base: SetupOptions = {
    mode: 'install',
    envFile: input,
    stateDir: join(artifact, 'install'),
    execute: false,
    maintenanceConfirmed: true,
    allowRemote: false,
    generateAdminPassword: true,
    tenantName: 'Setup acceptance',
    companyCode: 'SAFE',
    companyName: '安全導入検証',
    adminEmail: 'setup-admin@example.test',
    adminName: 'Setup Admin',
  };
  const changeEnv = async (number: number, source = ownerUrl, app = appUrl, jwt?: string) => {
    const file = join(artifact, `input-${number}.env`);
    await writeExclusive(
      file,
      `DATABASE_URL_OWNER=${source}\nDATABASE_URL=${app}\nRESTORE_CHECK_URL=${replaceDatabase(ownerUrl, `daifuku_setup_restore_${number}${suffix}`)}\n${jwt ? `JWT_SECRET=${jwt}\n` : ''}`,
    );
    return file;
  };
  step('AC-1 plan has no writes');
  await verifyCliPlan(base);
  const plan = await runSetup(base);
  assert.equal(plan.empty, true);
  assert.equal(await exists(base.stateDir), false);
  await assert.rejects(runSetup({ ...base, execute: true, confirmTarget: 'wrong' }), { code: 'CONFIRM_TARGET' });
  const first = { ...base, execute: true, confirmTarget: plan.target.id };
  await useDb(ownerUrl, async (busy) => {
    await busy.sql`select 1`;
    await assert.rejects(runSetup(first), { code: 'DATABASE_BUSY' });
  });
  step('AC-4/5/6 initial backup, migrate and injected crash after admin commit');
  await interruptInstallation(first, await changeEnv(9));
  const partial = await readState(base.stateDir);
  assert(partial?.identity);
  const firstTenantId = partial.identity.tenantId;
  const runtimePath = join(base.stateDir, 'runtime.env'),
    runtime = await privateFile(runtimePath);
  const generatedPassword = (await privateFile(join(base.stateDir, 'initial-admin-password.txt'))).trimEnd();
  const hash = await useDb(
    ownerUrl,
    async (db) => (await db.sql`select password_hash from users where tenant_id=${firstTenantId}`)[0]?.password_hash,
  );
  const changedPassword = 'Changed-SetupCredential9!';
  const passwordFile = join(artifact, 'different-password');
  await writeExclusive(passwordFile, changedPassword);
  const second = {
    ...first,
    envFile: await changeEnv(2),
    generateAdminPassword: false,
    adminPasswordFile: passwordFile,
  };
  step('AC-6 resume preserves committed password and runtime config');
  await runSetup(second);
  assert.equal(await privateFile(runtimePath), runtime);
  assert.equal(await privateFile(input), originalEnv);
  await useDb(ownerUrl, async (db) => {
    assert.equal(
      (await db.sql`select password_hash from users where tenant_id=${firstTenantId}`)[0]?.password_hash,
      hash,
    );
    assert(await authenticate(db, 'setup-admin@example.test', generatedPassword, firstTenantId));
    assert.equal(await authenticate(db, 'setup-admin@example.test', changedPassword, firstTenantId), null);
    assert.equal((await db.sql`select count(*)::int n from user_company_memberships`)[0]?.n, 1);
  });
  const stateBefore = await privateFile(join(base.stateDir, 'setup-state.json'));
  assert.equal((await runSetup(second)).noOp, true);
  assert.equal(await privateFile(join(base.stateDir, 'setup-state.json')), stateBefore);
  const folders = await sourceFolders(artifact),
    legacyUrl = replaceDatabase(ownerUrl, `daifuku_setup_legacy${suffix}`),
    legacyApp = replaceDatabase(appUrl, `daifuku_setup_legacy${suffix}`);
  step('AC-3 real populated 0008 fixture');
  const {
    tenant,
    company,
    user,
    password: legacyPassword,
    hash: legacyHash,
  } = await populateLegacy(legacyUrl, folders.legacy);
  const jwt = parseEnv(runtime).JWT_SECRET;
  assert(jwt);
  const upgrade: SetupOptions = {
    ...base,
    mode: 'upgrade',
    stateDir: join(artifact, 'upgrade'),
    envFile: await changeEnv(3, legacyUrl, legacyApp, jwt),
    generateAdminPassword: false,
    execute: true,
  };
  const updatePlan = await buildPlan(upgrade);
  upgrade.confirmTarget = updatePlan.target.id;
  assert.equal(updatePlan.applied, 9);
  assert(updatePlan.pending.includes('0009_operations_control'));
  await useDb(legacyUrl, async (db) => {
    await db.sql`alter table companies alter column name drop not null`;
  });
  await assert.rejects(buildPlan(upgrade), { code: 'SCHEMA_DRIFT' });
  await useDb(legacyUrl, async (db) => {
    await db.sql`alter table companies alter column name set not null`;
  });
  step('AC-3/4 upgrade 0008 to current release, with verified restore');
  await runSetup(upgrade);
  await useDb(legacyUrl, async (db) => {
    assert.equal((await db.sql`select password_hash from users where id=${user}`)[0]?.password_hash, legacyHash);
    assert.deepEqual((await db.sql`select settings from companies where id=${company}`)[0]?.settings, {
      custom: 'keep',
      'tax.price_includes_tax': true,
    });
    assert(await authenticate(db, 'legacy-admin@example.test', legacyPassword, tenant));
    assert.equal((await db.sql`select count(*)::int n from user_company_memberships where user_id=${user}`)[0]?.n, 1);
  });
  const before = await useDb(legacyUrl, history);
  step('AC-6/7 failing migration rolls back, then resumes without reset');
  const failed = { ...upgrade, envFile: await changeEnv(4, legacyUrl, legacyApp, jwt) };
  await assert.rejects(runSetup(failed, {}, folders.synthetic));
  assert.deepEqual(await useDb(legacyUrl, history), before);
  await writeFile(join(folders.synthetic, `${folders.next.tag}.sql`), 'SELECT 1;\n');
  await runSetup({ ...upgrade, envFile: await changeEnv(5, legacyUrl, legacyApp, jwt) }, {}, folders.synthetic);
  assert.equal((await useDb(legacyUrl, history)).length, before.length + 1);
  assert.equal(await privateFile(runtimePath), runtime);
  step('AC-4 rejects occupied restore database');
  const occupied = {
    ...base,
    stateDir: join(artifact, 'occupied'),
    mode: 'upgrade' as const,
    envFile: await changeEnv(2 + 6, ownerUrl, appUrl, jwt),
    execute: true,
    confirmTarget: plan.target.id,
  };
  const usedRestoreEnv = parseEnv(await privateFile(second.envFile));
  await writeFile(
    occupied.envFile,
    `DATABASE_URL_OWNER=${ownerUrl}\nDATABASE_URL=${appUrl}\nRESTORE_CHECK_URL=${usedRestoreEnv.RESTORE_CHECK_URL}\nJWT_SECRET=${jwt}\n`,
    { mode: 0o600 },
  );
  await assert.rejects(runSetup(occupied), { code: 'RESTORE_REQUIRED' });
  process.stdout.write(`PASS: safe setup acceptance. Protected artifacts: ${artifact}\n`);
}
main().catch((error: unknown) => {
  process.stderr.write(`FAIL at ${phase}: ${safeFailure(error)}\n`);
  process.exitCode = 1;
});
