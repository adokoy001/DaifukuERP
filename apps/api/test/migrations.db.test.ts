import { readdirSync } from 'node:fs';
import { bootstrapTenant, connect, dropAll, repo, runMigrations, systemParams, withContext } from '@daifuku/kernel';
import { APP_URL, OWNER_URL } from '@daifuku/kernel/testing';
import { Partner } from '@daifuku/mod-partner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAll } from '../src/db/reset.ts';
import { MIGRATIONS_DIR, pendingMigration, readJournal } from '../src/db/migrations.ts';

const owner = connect(OWNER_URL, { max: 2 });
const app = connect(APP_URL, { max: 2 });

beforeAll(async () => {
  await dropAll(owner);
});
afterAll(async () => {
  await app.close();
  await owner.close();
});

describe('migrations (api-app AC-9)', () => {
  it('the committed migration files are in sync with the registry (db:generate would write nothing)', async () => {
    const journal = readJournal();
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(journal.entries[0]?.tag).toBe('0000_init');
    const files = readdirSync(MIGRATIONS_DIR);
    for (const e of journal.entries) expect(files).toContain(`${e.tag}.sql`);
    const pending = await pendingMigration();
    expect(pending.statements).toEqual([]);
  });

  it('runMigrations applies them to an empty database, is idempotent, and leaves RLS/grants enforced', async () => {
    await runMigrations(owner, MIGRATIONS_DIR);
    await runMigrations(owner, MIGRATIONS_DIR);
    const applied = await owner.sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(applied[0]?.n).toBe(readJournal().entries.length);
    const rls = await owner.sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'partner'`;
    expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const grants =
      await owner.sql`select privilege_type from information_schema.role_table_grants where table_name = 'audit_log' and grantee = 'daifuku_app' order by 1`;
    expect(grants.map((g) => g.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });

  it('reset flow: bootstrap + module seeds produce the demo data; seeds are idempotent', async () => {
    const boot = await seedAll(owner);
    const again = await seedAll(owner);
    expect(again).toEqual(boot);
    const count = await withContext(app, systemParams(boot.tenantId, boot.companyId), (ctx) =>
      repo(ctx, Partner).count(),
    );
    expect(count).toBe(3);
    // Replaying bootstrap requires the explicit tenant identity, never only an email.
    const boot2 = await bootstrapTenant(owner, {
      tenantId: boot.tenantId,
      tenantName: 'x',
      companyCode: 'x',
      companyName: 'x',
      adminEmail: 'admin@example.com',
      adminName: 'x',
      adminPassword: 'x',
    });
    expect(boot2.tenantId).toBe(boot.tenantId);
  });
});
