// Postgres tests of the fixed asset register (docs/specs/fixed-assets.md AC-1..AC-5, AC-28; golden G7). Test DB:
// TEST_DATABASE_URL*. Today is 2027-09-15 (JST); fiscal years run April–March from FY2026.
import { repo, setSetting, StateError, ValidationError } from '@daifuku/kernel';
import { Account, JournalEntry } from '@daifuku/mod-accounting';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXED_ASSET_ACCOUNTS_KEY, FixedAsset, fixedAssetAccountsSchema } from '../src/index.ts';
import { caught, issues, setupEnv, type Env, type Row } from './db-setup.ts';

const NOW = new Date('2027-09-15T03:00:00Z');
let env: Env;
type Asset = Row & {
  id: string;
  accumulatedAccountId: string;
  expenseAccountId: string;
  propertyTaxClass: string;
  depreciationStart: string | null;
  status: string;
};

async function input(over: Row): Promise<Row> {
  return {
    code: `A-${Math.random().toString(36).slice(2, 8)}`,
    name: '備品',
    assetClass: 'tools_furniture',
    acquisitionDate: '2026-10-01',
    inServiceDate: '2026-10-15',
    cost: '600000',
    method: 'straight_line',
    usefulLife: 5,
    assetAccountId: await env.account('1925'),
    ...over,
  };
}
const create = async (over: Row = {}) => env.act<Asset>('fixed_asset.create', await input(over));

beforeAll(async () => {
  env = await setupEnv(NOW, { fiscalYears: ['2026-04-01', '2027-04-01'] });
});
afterAll(async () => {
  await env.db.close();
});

describe('register (AC-1)', () => {
  it('AC-1: empty accounts and property-tax class are filled; depreciationStart is the service month; no entry', async () => {
    const a = await create({ code: 'A1' });
    expect(a.accumulatedAccountId).toBe(await env.account('1929'));
    expect(a.expenseAccountId).toBe(await env.account('6700'));
    expect([a.propertyTaxClass, a.depreciationStart, a.status]).toEqual(['tools', '2026-10-01', 'active']);
    expect(await env.run({}, (ctx) => repo(ctx, JournalEntry).count())).toBe(0);
  });

  it('AC-1: software uses its asset account as the accumulated account (direct method) and is excluded from property tax', async () => {
    const sw = await create({ assetClass: 'software', assetAccountId: await env.account('1930') });
    expect(sw.accumulatedAccountId).toBe(await env.account('1930'));
    expect(sw.propertyTaxClass).toBe('excluded');
  });

  it('AC-1: an empty in-service date leaves the asset not in service (no depreciationStart)', async () => {
    const a = await create({ inServiceDate: null });
    expect(a.depreciationStart).toBeNull();
  });
});

describe('validation (AC-2, AC-3)', () => {
  it('AC-2 (a)(b): acquisition after service, fractional yen and cost at the memorandum value are refused', async () => {
    const e = await caught(create({ acquisitionDate: '2026-11-01', inServiceDate: '2026-10-15', cost: '1000.5' }));
    expect(e).toBeInstanceOf(ValidationError);
    expect(issues(e)).toEqual(expect.arrayContaining(['inServiceDate', 'cost']));
    expect(issues(await caught(create({ cost: '1' })))).toContain('cost');
  });

  it('AC-2 (c): no rate table for the acquisition date, or no row for the useful life', async () => {
    expect(
      issues(await caught(create({ method: 'declining_200', acquisitionDate: '2012-03-01', inServiceDate: null }))),
    ).toContain('acquisitionDate');
    expect(issues(await caught(create({ usefulLife: 7 })))).toContain('usefulLife');
  });

  it('AC-2 (d)(e): software by declining balance and wrong account types are refused', async () => {
    expect(
      issues(
        await caught(
          create({
            assetClass: 'software',
            method: 'declining_200',
            usefulLife: 5,
            assetAccountId: await env.account('1930'),
          }),
        ),
      ),
    ).toContain('method');
    expect(issues(await caught(create({ expenseAccountId: await env.account('1929') })))).toContain('expenseAccountId');
    expect(issues(await caught(create({ assetAccountId: await env.account('6700') })))).toContain('assetAccountId');
  });

  it('AC-3: service before the earliest open year needs opening values; the opening date must start a period', async () => {
    expect(issues(await caught(create({ acquisitionDate: '2020-04-01', inServiceDate: '2020-04-01' })))).toContain(
      'openingDate',
    );
    expect(
      issues(
        await caught(
          create({
            acquisitionDate: '2020-04-01',
            inServiceDate: '2020-04-01',
            openingDate: '2026-04-15',
            openingAccumulatedDepreciation: '1',
          }),
        ),
      ),
    ).toContain('openingDate');
    const ok = await create({
      acquisitionDate: '2024-04-01',
      inServiceDate: '2024-04-01',
      openingDate: '2026-04-01',
      openingAccumulatedDepreciation: '240000',
      openingYearDepreciation: '0',
    });
    expect(ok.depreciationStart).toBe('2026-04-01');
    expect(
      issues(
        await caught(
          create({
            acquisitionDate: '2024-04-01',
            inServiceDate: '2024-04-01',
            openingDate: '2026-04-01',
            openingAccumulatedDepreciation: '600000',
          }),
        ),
      ),
    ).toContain('openingAccumulatedDepreciation');
    expect(
      issues(
        await caught(
          create({
            acquisitionDate: '2024-04-01',
            inServiceDate: '2024-04-01',
            openingDate: '2026-04-01',
            openingAccumulatedDepreciation: '240000',
            openingYearDepreciation: '10',
          }),
        ),
      ),
    ).toContain('openingYearDepreciation');
  });

  it('AC-3 golden G7: a switched declining-balance asset needs the revised base; with it the asset saves', async () => {
    const g7 = {
      method: 'declining_200',
      usefulLife: 10,
      cost: '1000000',
      acquisitionDate: '2020-04-01',
      inServiceDate: '2020-04-01',
      openingDate: '2026-04-01',
      openingAccumulatedDepreciation: '737856',
      openingYearDepreciation: '0',
    };
    const e = await caught(create(g7));
    expect(e).toBeInstanceOf(ValidationError);
    expect(issues(e)).toContain('openingRevisedBase');
    const ok = await create({ ...g7, openingRevisedBase: '262144' });
    expect(ok.status).toBe('active');
    expect(
      issues(await caught(create({ ...g7, openingAccumulatedDepreciation: '100000', openingRevisedBase: '900000' }))),
    ).toContain('openingRevisedBase');
  });
});

describe('freeze and delete (AC-4)', () => {
  it('AC-4: after a booked run only name / location / municipality / property-tax class / memo change; delete refused', async () => {
    const a = await create({ code: 'FRZ' });
    await env.act('fixed_asset.update', { id: a.id, patch: { cost: '700000' } });
    await env.act('fixed_assets.run_depreciation', { periodId: await env.periodId('2026-10') });
    const e = await caught(env.act('fixed_asset.update', { id: a.id, patch: { cost: '800000' } }));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details?.reason).toBe('asset_frozen');
    const renamed = await env.act<Asset>('fixed_asset.update', {
      id: a.id,
      patch: {
        name: '新しい名前',
        location: '本社 3F',
        municipality: '渋谷区',
        propertyTaxClass: 'machinery',
        memo: 'm',
      },
    });
    expect([renamed.name, renamed.municipality, renamed.propertyTaxClass]).toEqual([
      '新しい名前',
      '渋谷区',
      'machinery',
    ]);
    const del = await caught(env.act('fixed_asset.delete', { id: a.id }));
    expect(del).toBeInstanceOf(StateError);
    expect((del as StateError).details?.reason).toBe('asset_in_use');
  });

  it('AC-4: an asset without runs or disposals can be changed and deleted', async () => {
    const a = await create();
    await env.act('fixed_asset.update', { id: a.id, patch: { cost: '650000', usefulLife: 4 } });
    await env.act('fixed_asset.delete', { id: a.id });
    expect(await env.run({}, (ctx) => repo(ctx, FixedAsset).count({ id: a.id }))).toBe(0);
  });
});

describe('CSV import (AC-5)', () => {
  it('AC-5: dry-run validates per row (account codes resolve), execute creates with the same fills', async () => {
    const rows = [
      {
        code: 'CSV-1',
        name: '複合機',
        assetClass: 'tools_furniture',
        acquisitionDate: '2026-11-01',
        inServiceDate: '2026-11-05',
        cost: '480000',
        method: 'declining_200',
        usefulLife: '5',
        assetAccountId: '1925',
      },
      {
        code: 'CSV-2',
        name: '不正',
        assetClass: 'software',
        acquisitionDate: '2026-11-01',
        inServiceDate: '2026-11-05',
        cost: '100000',
        method: 'declining_200',
        usefulLife: '5',
        assetAccountId: '1930',
      },
    ];
    const dry = await env.act<{ summary: Row; rows: { messages?: unknown[]; status?: string }[] }>(
      'fixed_asset.import',
      {
        rows,
        mode: 'dry-run',
        onExisting: 'error',
      },
    );
    expect(dry.summary).toMatchObject({ errors: 1 });
    const done = await env.act<{ summary: Row }>('fixed_asset.import', {
      rows: [rows[0]],
      mode: 'execute',
      onExisting: 'error',
    });
    expect(done.summary).toMatchObject({ created: 1, errors: 0 });
    const a = await env.run(
      {},
      async (ctx) => (await repo(ctx, FixedAsset).list({ where: { code: 'CSV-1' } })).items[0],
    );
    expect([a?.accumulatedAccountId, a?.propertyTaxClass, a?.depreciationStart]).toEqual([
      await env.account('1929'),
      'tools',
      '2026-11-01',
    ]);
  });
});

describe('accounts setting (AC-28)', () => {
  it('AC-28: a setting code that does not exist refuses the save with the setting key, role and code', async () => {
    await env.run({}, (ctx) =>
      setSetting(ctx, FIXED_ASSET_ACCOUNTS_KEY, fixedAssetAccountsSchema, { accumulated: '1999' }),
    );
    try {
      const e = await caught(create());
      expect(e).toBeInstanceOf(StateError);
      expect((e as StateError).details).toMatchObject({
        setting: FIXED_ASSET_ACCOUNTS_KEY,
        role: 'accumulated',
        code: '1999',
      });
      await env.run({}, (ctx) =>
        repo(ctx, Account).create({ code: '1999', name: '累計額（別）', type: 'asset', subtype: '有形固定資産' }),
      );
      const a = await create();
      expect(a.accumulatedAccountId).toBe(await env.account('1999'));
    } finally {
      await env.run({}, (ctx) => setSetting(ctx, FIXED_ASSET_ACCOUNTS_KEY, fixedAssetAccountsSchema, {}));
    }
  });
});
