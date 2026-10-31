// Postgres tests of roles and boundaries (docs/specs/fixed-assets.md AC-24..AC-27). Test DB: TEST_DATABASE_URL*.
import { auditTrail, newId, NotFound, PermissionDenied, repo } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DepreciationRun, FixedAsset } from '../src/index.ts';
import { asRole, caught, secondCompany, seedCompany, setupEnv, type Env, type Row } from './db-setup.ts';

const NOW = new Date('2027-09-15T03:00:00Z');
let env: Env;
let assetId: string;
let companyB: string;
const accountingUser = asRole(['accounting']);

const assetInput = async (over: Row = {}) => ({
  code: `AC-${Math.random().toString(36).slice(2, 7)}`,
  name: '備品',
  assetClass: 'tools_furniture',
  acquisitionDate: '2026-10-01',
  inServiceDate: '2026-10-15',
  cost: '600000',
  method: 'straight_line',
  usefulLife: 5,
  assetAccountId: await env.account('1925'),
  ...over,
});

beforeAll(async () => {
  env = await setupEnv(NOW, { fiscalYears: ['2026-04-01', '2027-04-01'] });
  assetId = (await env.act<{ id: string }>('fixed_asset.create', await assetInput(), accountingUser)).id;
  companyB = await secondCompany(env);
  await seedCompany(env, { fiscalYears: ['2026-04-01'], companyId: companyB });
});
afterAll(async () => {
  await env.db.close();
});

describe('roles (AC-24, AC-27)', () => {
  it('AC-24 AC-27: accounting registers, runs and disposes in its own context; the audit actor is that user', async () => {
    const res = await env.act<{ run: { id: string } }>(
      'fixed_assets.run_depreciation',
      { periodId: await env.periodId('2026-10') },
      accountingUser,
    );
    const trail = await env.run(accountingUser, (ctx) => auditTrail(ctx, DepreciationRun.name, res.run.id));
    expect(trail.length).toBeGreaterThan(0);
    expect(trail.every((t) => t.actorId === accountingUser.actor.id)).toBe(true);
    const d = await env.act<{ id: string }>(
      'fixed_asset_disposal.create',
      { assetId, date: '2026-11-10', kind: 'retirement' },
      accountingUser,
    );
    await env.act('fixed_asset_disposal.submit', { id: d.id }, accountingUser);
  });

  it('AC-24: a viewer reads and previews but cannot create, run or submit', async () => {
    const viewer = asRole(['viewer']);
    expect((await env.act<{ items: unknown[] }>('fixed_asset.list', {}, viewer)).items.length).toBeGreaterThan(0);
    await env.act('fixed_assets.preview_depreciation', {}, viewer);
    expect(await caught(env.act('fixed_asset.create', await assetInput(), viewer))).toBeInstanceOf(PermissionDenied);
    expect(
      await caught(env.act('fixed_assets.run_depreciation', { periodId: await env.periodId('2026-12') }, viewer)),
    ).toBeInstanceOf(PermissionDenied);
    expect(await caught(env.act('fixed_assets.todo', {}, viewer))).toBeInstanceOf(PermissionDenied);
  });

  it('AC-24: other roles (sales, purchasing, workforce) get PERMISSION_DENIED for reads and actions', async () => {
    for (const role of ['sales', 'purchasing', 'workforce']) {
      const params = asRole([role]);
      for (const [name, input] of [
        ['fixed_asset.list', {}],
        ['depreciation_run.list', {}],
        ['fixed_asset_disposal.list', {}],
        ['fixed_assets.preview_depreciation', {}],
        ['fixed_assets.depreciation_schedule', {}],
        ['fixed_assets.depreciation_rules', {}],
      ] as const)
        expect(await caught(env.act(name, input, params))).toBeInstanceOf(PermissionDenied);
    }
  });
});

describe('company and store boundaries (AC-25, AC-26)', () => {
  it('AC-25: company B sees none of company A; A ids are NOT_FOUND from B', async () => {
    const inB = { companyId: companyB };
    expect((await env.act<{ items: unknown[] }>('fixed_asset.list', {}, inB)).items).toEqual([]);
    expect(await caught(env.act('fixed_asset.get', { id: assetId }, inB))).toBeInstanceOf(NotFound);
    expect(
      await caught(env.act('fixed_assets.run_depreciation', { periodId: await env.periodId('2026-12') }, inB)),
    ).toBeInstanceOf(NotFound);
    const p = await env.act<{ lines: unknown[]; skipped: Record<string, number> }>(
      'fixed_assets.preview_depreciation',
      {},
      inB,
    );
    expect(p.lines).toEqual([]);
    expect(p.skipped.disposed).toBe(0);
    const t = await env.act<{ rows: unknown[] }>('fixed_assets.depreciation_schedule', {}, inB);
    expect(t.rows).toEqual([]);
    const yearA = (await env.act<{ items: { id: string }[] }>('fiscal_year.list', { where: { code: 'FY2026' } }))
      .items[0]?.id;
    expect(await caught(env.act('fixed_assets.depreciation_schedule', { fiscalYearId: yearA }, inB))).toBeInstanceOf(
      NotFound,
    );
    expect(await caught(env.act('fixed_assets.depreciation_schedule', { fiscalYearId: newId() }, inB))).toBeInstanceOf(
      NotFound,
    );
    expect(await env.run(inB, (ctx) => repo(ctx, FixedAsset).count())).toBe(0);
  });

  it('AC-26: store- and site-limited contexts are refused even with the accounting role', async () => {
    for (const scope of [
      { accessScope: 'stores' as const, storeIds: [newId()] },
      { accessScope: 'sites' as const, siteIds: [newId()] },
    ]) {
      const params = { ...accountingUser, ...scope };
      expect(await caught(env.act('fixed_assets.preview_depreciation', {}, params))).toBeInstanceOf(PermissionDenied);
      expect(await caught(env.act('fixed_asset.list', {}, params))).toBeInstanceOf(PermissionDenied);
      expect(await caught(env.act('fixed_asset.create', await assetInput(), params))).toBeInstanceOf(PermissionDenied);
    }
  });
});
