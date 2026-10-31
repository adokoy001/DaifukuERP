// Postgres tests of the setup-health check fixed_assets.depreciation_rules (docs/specs/fixed-assets.md AC-30). Test DB:
// TEST_DATABASE_URL*.
import { setSetting } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { depreciationRulesHealthCheck, RULES_CONFIRMATION_KEY, rulesConfirmationSchema } from '../src/index.ts';
import { asRole, setupEnv, useRules, type Env } from './db-setup.ts';
import { TEST_RULES } from './fixture-rules.ts';

const NOW = new Date('2027-09-15T03:00:00Z');
let env: Env;
const check = (params = {}) => env.run(params, (ctx) => depreciationRulesHealthCheck.run(ctx));

beforeAll(async () => {
  env = await setupEnv(NOW, { fiscalYears: ['2026-04-01'], confirm: false });
});
afterAll(async () => {
  useRules();
  await env.db.close();
});

describe('fixed_assets.depreciation_rules (AC-30)', () => {
  it('AC-30: id, order and href are stable', () => {
    expect([depreciationRulesHealthCheck.id, depreciationRulesHealthCheck.order]).toEqual([
      'fixed_assets.depreciation_rules',
      60,
    ]);
  });

  it('AC-30: no assets yet → ok even while unverified', async () => {
    const r = await check();
    expect([r.status, r.href]).toEqual(['ok', '/finance/depreciation']);
  });

  it('AC-30: assets with unverified rules → warn; a settings-only caller (cannot count assets) → warn', async () => {
    await env.act('fixed_asset.create', {
      code: 'H1',
      name: '備品',
      assetClass: 'tools_furniture',
      acquisitionDate: '2026-10-01',
      inServiceDate: '2026-10-15',
      cost: '600000',
      method: 'straight_line',
      usefulLife: 5,
      assetAccountId: await env.account('1925'),
    });
    expect((await check()).status).toBe('warn');
    expect((await check(asRole(['settings']))).status).toBe('warn');
  });

  it('AC-30: the company confirmation of the current rule set, or a verified pack → ok', async () => {
    await env.run({}, (ctx) =>
      setSetting(ctx, RULES_CONFIRMATION_KEY, rulesConfirmationSchema, {
        ruleSetId: TEST_RULES.id,
        confirmedOn: '2026-10-30',
      }),
    );
    expect((await check()).status).toBe('ok');
    await env.run({}, (ctx) => setSetting(ctx, RULES_CONFIRMATION_KEY, rulesConfirmationSchema, {}));
    useRules({ ...TEST_RULES, verifiedOn: '2026-11-01' });
    expect((await check()).status).toBe('ok');
  });

  it('AC-30: missing rules, another country or another currency → warn', async () => {
    for (const rules of [null, { ...TEST_RULES, country: 'US' }, { ...TEST_RULES, currency: 'USD' }]) {
      useRules(rules);
      expect((await check()).status).toBe('warn');
    }
    useRules();
  });
});
