import { rmSync } from 'node:fs';
import {
  appMeta,
  applyPack,
  connect,
  dropAll,
  registry,
  repo,
  runAction,
  runMigrations,
  systemParams,
  withContext,
} from '@daifuku/kernel';
import { APP_URL, OWNER_URL } from '@daifuku/kernel/testing';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../src/modules.ts';
import type { SeedResult } from '../src/db/reset.ts';
import { prepareIndustryDemoCompanies, seedIndustryDemos } from '../src/db/industry-demos.ts';
import { MIGRATIONS_DIR, pendingMigration } from '../src/db/migrations.ts';
import { legacyMigrationFolder, seedLegacyDemo } from './legacy-fixture.ts';

const owner = connect(OWNER_URL, { max: 2 });
const app = connect(APP_URL, { max: 2 });
const previous = legacyMigrationFolder(7);
let boot: SeedResult;
let preserved: { id: string; total: string };
let demos: Awaited<ReturnType<typeof prepareIndustryDemoCompanies>>;
beforeAll(async () => {
  await dropAll(owner);
  // Build the historical schema without applying current-registry grants to not-yet-created industry tables.
  await migrate(owner.drizzle, { migrationsFolder: previous });
  boot = await seedLegacyDemo(owner);
  preserved = await withContext(owner, systemParams(boot.tenantId, boot.companyId), async (ctx) => {
    const partner = (await runAction(ctx, 'partner.create', { name: 'Keep this customer', isCustomer: true })) as {
      id: string;
    };
    return runAction(ctx, 'sales_invoice.create', {
      partnerId: partner.id,
      date: '2026-09-12',
      lines: {
        sales_invoice_line: [
          { description: 'Original document', quantity: '1', unitPrice: '1000', taxCategory: 'exempt' },
        ],
      },
    }) as Promise<{ id: string; total: string }>;
  });
});
afterAll(async () => {
  await app.close();
  await owner.close();
  rmSync(previous, { recursive: true, force: true });
});

describe('industry-templates integration', () => {
  it('adds all three industry schemas to a populated foundation database and keeps existing documents', async () => {
    const [old] = await owner.sql`select to_regclass('public.farm_harvest')::text as name`;
    expect(old?.name).toBeNull();
    await runMigrations(owner, MIGRATIONS_DIR);
    await runMigrations(owner, MIGRATIONS_DIR);
    const [invoice] = await owner.sql`select id, total from sales_invoice where id=${preserved.id}`;
    expect(invoice).toMatchObject({ id: preserved.id, total: '1000.000000' });
    for (const table of ['appliance_store_service', 'farm_harvest', 'restaurant_chain_closing']) {
      const [found] = await owner.sql`select to_regclass(${`public.${table}`})::text as name`;
      expect(found?.name).toBe(table);
    }
    expect((await pendingMigration()).statements).toEqual([]);
  });

  it('prepares three separate companies and applies each sample without forcing existing settings', async () => {
    demos = await prepareIndustryDemoCompanies(owner);
    expect(new Set(demos.map((d) => d.companyId)).size).toBe(3);
    expect(demos.every((d) => d.tenantId === boot.tenantId && d.companyId !== boot.companyId)).toBe(true);
    for (const demo of demos)
      await withContext(app, systemParams(demo.tenantId, demo.companyId), async (ctx) => {
        const first = await applyPack(ctx, demo.pack, { sample: true });
        expect(first).toMatchObject({ seeded: true, sampled: true, alreadyApplied: false });
        const meta = await appMeta(ctx);
        expect(
          meta.modules
            .filter((m) => ['appliance_store', 'farm', 'restaurant_chain'].includes(m.name))
            .map((m) => m.name),
        ).toEqual([demo.pack]);
      });
    const [original] =
      await owner.sql`select settings->'packs.applied' as applied from companies where id=${boot.companyId}`;
    expect(original?.applied ?? {}).toEqual({});
  });

  it('keeps all demo rows on repeated provisioning and blocks unselected company access', async () => {
    const snapshots = async () =>
      Promise.all(
        demos.map((demo) =>
          withContext(app, systemParams(demo.tenantId, demo.companyId), async (ctx) => {
            const name = {
              appliance_store: 'appliance_store_service',
              farm: 'farm_field',
              restaurant_chain: 'restaurant_chain_store',
            }[demo.pack];
            const rows = await repo(ctx, registry.entity(name ?? '')).list({ limit: 500 });
            expect(rows.total).toBeGreaterThan(0);
            return rows.items
              .map((row) => ({ id: row.id, version: row.version }))
              .sort((a, b) => a.id.localeCompare(b.id));
          }),
        ),
      );
    const before = await snapshots();
    expect(await seedIndustryDemos(owner)).toEqual(demos);
    expect(await snapshots()).toEqual(before);
    await withContext(app, systemParams(boot.tenantId, boot.companyId), async (ctx) => {
      await expect(runAction(ctx, 'farm_field.list', {})).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      expect((await appMeta(ctx)).modules.some((m) => m.name === 'farm')).toBe(false);
    });
  });
});
