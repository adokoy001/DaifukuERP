// Postgres tests of the inbox provider fixed_assets.todo (docs/specs/fixed-assets.md AC-31). Test DB:
// TEST_DATABASE_URL*. Today is 2027-09-15 (JST): the last ended period is 2027-08.
import { newId, PermissionDenied } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, caught, setupEnv, useRules, type Env } from './db-setup.ts';
import { TEST_RULES } from './fixture-rules.ts';

const NOW = new Date('2027-09-15T03:00:00Z');
let env: Env;
type Todo = { items: { key: string; count: number; href: string; severity: string }[] };
const todo = (params = {}) => env.act<Todo>('fixed_assets.todo', {}, params);

async function asset(code: string, over = {}) {
  return env.act<{ id: string }>('fixed_asset.create', {
    code,
    name: code,
    assetClass: 'tools_furniture',
    acquisitionDate: '2026-10-01',
    inServiceDate: '2026-10-15',
    cost: '600000',
    method: 'straight_line',
    usefulLife: 5,
    assetAccountId: await env.account('1925'),
    ...over,
  });
}

beforeAll(async () => {
  env = await setupEnv(NOW, { fiscalYears: ['2026-04-01', '2027-04-01'] });
});
afterAll(async () => {
  await env.db.close();
});

describe('fixed_assets.todo (AC-31)', () => {
  it('AC-31: nothing registered → no items', async () => {
    expect(await todo()).toEqual({ items: [] });
  });

  it('AC-31: assets due in the last ended period are counted (warn, href to the period); run → gone; a later asset counts', async () => {
    await asset('T1');
    await asset('T2');
    await asset('FUT', { acquisitionDate: '2027-09-01', inServiceDate: '2027-09-01' });
    const before = await todo();
    const item = before.items.find((i) => i.key === 'depreciation_not_run');
    const periodId = await env.periodId('2027-08');
    expect(item).toMatchObject({ count: 2, severity: 'warn', href: `/finance/depreciation?periodId=${periodId}` });
    await env.act('fixed_assets.run_depreciation', { periodId });
    expect((await todo()).items.find((i) => i.key === 'depreciation_not_run')).toBeUndefined();
    await asset('T3', { inServiceDate: '2027-08-01', acquisitionDate: '2027-08-01' });
    expect((await todo()).items.find((i) => i.key === 'depreciation_not_run')?.count).toBe(1);
  });

  it('AC-31: draft disposals are counted (info); unusable rules hide the depreciation item', async () => {
    const a = await asset('T4');
    await env.act('fixed_asset_disposal.create', { assetId: a.id, date: '2027-09-01', kind: 'retirement' });
    expect((await todo()).items.find((i) => i.key === 'disposal_drafts')).toMatchObject({ count: 1, severity: 'info' });
    useRules({ ...TEST_RULES, id: 'other-id' });
    try {
      expect((await todo()).items.map((i) => i.key)).toEqual(['disposal_drafts']);
    } finally {
      useRules();
    }
  });

  it('AC-31: company-wide accounting only — store contexts and viewers are refused', async () => {
    expect(
      await caught(todo({ ...asRole(['accounting']), accessScope: 'stores', storeIds: [newId()] })),
    ).toBeInstanceOf(PermissionDenied);
    expect(await caught(todo(asRole(['viewer'])))).toBeInstanceOf(PermissionDenied);
    expect((await todo(asRole(['accounting']))).items.length).toBeGreaterThan(0);
  });
});
