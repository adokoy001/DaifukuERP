// docs/specs/fixed-assets.md AC-10, AC-29, AC-35 with the full runtime (every module of ../src/modules.ts and the
// Japanese pack): the Japanese rule set is the one in use, ships unverified, refuses postings until the company records
// its confirmation, and the seeded chart carries the accounts the module posts to.
import {
  newId,
  registerCrudActions,
  runAction,
  setSetting,
  StateError,
  systemParams,
  withContext,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { JAPAN_FIXED_ASSET_RULES } from '@daifuku/l10n-jp';
import { RULES_CONFIRMATION_KEY, rulesConfirmationSchema } from '@daifuku/mod-fixed-assets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modules } from '../src/modules.ts';

const NOW = new Date('2026-12-10T03:00:00Z');
let db: TestDb;
const accounting = { roles: ['accounting'], actor: { type: 'user' as const, id: newId() } };
const act = <T = Record<string, unknown>>(name: string, input: unknown, params: object = {}) =>
  db.run({ now: () => NOW, ...params }, async (ctx) => (await runAction(ctx, name, input)) as T);

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
  for (const m of modules)
    if (m.seed)
      await withContext(db.owner, systemParams(db.tenantId, db.companyId, { now: () => NOW }), async (ctx) =>
        m.seed?.(ctx),
      );
});
afterAll(async () => {
  await db?.close();
});

describe('fixed assets in the full runtime (AC-10, AC-29, AC-35)', () => {
  it('AC-10 AC-29: the Japanese rule set is registered and returned by fixed_assets.depreciation_rules', async () => {
    const r = await act<{ id: string; verifiedOn: string | null; confirmation: { usable: boolean } }>(
      'fixed_assets.depreciation_rules',
      {},
    );
    expect([r.id, r.verifiedOn, r.confirmation.usable]).toEqual([JAPAN_FIXED_ASSET_RULES.id, null, false]);
  });

  it('AC-29 AC-35: an asset on the seeded chart previews; the run is refused until the confirmation is recorded', async () => {
    const accounts = await act<{ items: { id: string; code: string }[] }>('account.list', { where: { code: '1925' } });
    await act(
      'fixed_asset.create',
      {
        code: 'PC-1',
        name: 'パソコン',
        assetClass: 'tools_furniture',
        acquisitionDate: '2026-10-01',
        inServiceDate: '2026-10-01',
        cost: '240000',
        method: 'straight_line',
        usefulLife: 4,
        assetAccountId: accounts.items[0]?.id,
      },
      accounting,
    );
    const preview = await act<{ period: { code: string }; total: string; blockers: string[] }>(
      'fixed_assets.preview_depreciation',
      {},
      accounting,
    );
    // The seeded fiscal year is the calendar year: 240,000 × 0.250 × 3 / 12 = 15,000; Oct–Nov at November = 2 × 5,000.
    expect([preview.period.code, preview.total]).toEqual(['2026-11', '10000']);
    expect(preview.blockers).toContain('rules_unverified');
    const periods = await act<{ items: { id: string }[] }>('fiscal_period.list', { where: { code: '2026-11' } });
    const periodId = periods.items[0]?.id;
    const refused = await act('fixed_assets.run_depreciation', { periodId }, accounting).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(StateError);
    expect((refused as StateError).details?.reason).toBe('rules_unverified');
    await db.run({ now: () => NOW }, (ctx) =>
      setSetting(ctx, RULES_CONFIRMATION_KEY, rulesConfirmationSchema, {
        ruleSetId: JAPAN_FIXED_ASSET_RULES.id,
        confirmedOn: '2026-12-10',
      }),
    );
    const res = await act<{ created: boolean; run: { totalAmount: string } }>(
      'fixed_assets.run_depreciation',
      { periodId },
      accounting,
    );
    expect([res.created, res.run.totalAmount]).toEqual([true, '10000']);
  });
});
