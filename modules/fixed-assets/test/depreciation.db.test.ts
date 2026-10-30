// Postgres tests of the depreciation preview and run (docs/specs/fixed-assets.md AC-11..AC-16, AC-35; golden G1, R1).
// Test DB: TEST_DATABASE_URL*. Today is 2027-09-15 (JST); fiscal years run April–March (FY2026, FY2027).
import { DOCSTATUS, repo, runAction, setSetting, StateError, ValidationError, type Context } from '@daifuku/kernel';
import { FiscalYear, JournalEntry, loadLines } from '@daifuku/mod-accounting';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DepreciationRun,
  DepreciationRunLine,
  FixedAsset,
  RULES_CONFIRMATION_KEY,
  rulesConfirmationSchema,
  type DepreciationPreview,
} from '../src/index.ts';
import { caught, setupEnv, useRules, type Env, type Row } from './db-setup.ts';
import { TEST_RULES } from './fixture-rules.ts';

const NOW = new Date('2027-09-15T03:00:00Z');
let env: Env;
type RunResult = {
  created: boolean;
  run?: {
    id: string;
    number: string;
    journalEntryId: string;
    journalEntryNumber: string;
    totalAmount: string;
    assetCount: number;
  };
  existingRuns?: { id: string }[];
  rulesVerified: boolean;
};

async function createAsset(over: Row): Promise<Row & { id: string }> {
  return env.act('fixed_asset.create', {
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
}
const preview = (periodId?: string) =>
  env.act<DepreciationPreview>('fixed_assets.preview_depreciation', periodId ? { periodId } : {});
const runPeriod = async (code: string, params = {}) =>
  env.act<RunResult>('fixed_assets.run_depreciation', { periodId: await env.periodId(code) }, params);
async function entryLines(entryId: string) {
  return env.run({}, async (ctx: Context) => {
    const accounts = new Map(
      ((await runAction(ctx, 'account.list', { limit: 500 })) as { items: { id: string; code: string }[] }).items.map(
        (a) => [a.id, a.code],
      ),
    );
    return (await loadLines(ctx, entryId)).map((l) => [
      accounts.get(l.accountId),
      l.debit.isZero() ? `Cr ${l.credit.toString()}` : `Dr ${l.debit.toString()}`,
      l.taxCategory ?? null,
    ]);
  });
}

let g1: string;
let soft: string;

beforeAll(async () => {
  env = await setupEnv(NOW, { fiscalYears: ['2026-04-01', '2027-04-01'] });
  g1 = (await createAsset({ code: 'G1' })).id;
  soft = (
    await createAsset({
      code: 'SW1',
      name: 'ソフトウエア',
      assetClass: 'software',
      cost: '300000',
      acquisitionDate: '2026-10-01',
      inServiceDate: '2026-10-01',
      assetAccountId: await env.account('1930'),
    })
  ).id;
});
afterAll(async () => {
  await env.db.close();
});

describe('preview (AC-11)', () => {
  it('AC-11: the default period is the last one that ended before today, nothing is written', async () => {
    const p = await preview();
    expect([p.period.code, p.defaulted, p.period.isFuture]).toEqual(['2027-08', true, false]);
    expect(p.rules).toMatchObject({ id: TEST_RULES.id, verifiedOn: null, confirmedOn: '2026-10-30', usable: true });
    const runs = await env.run({}, (ctx) => repo(ctx, DepreciationRun).count());
    expect(runs).toBe(0);
  });

  it('AC-11 AC-9: an explicit period books the year allocation through it; future periods are flagged', async () => {
    const p = await preview(await env.periodId('2026-10'));
    expect(p.lines.map((l) => [l.code, l.amount, l.annualAmount])).toEqual([
      ['G1', '10000', '60000'],
      ['SW1', '5000', '30000'],
    ]);
    expect(p.total).toBe('15000');
    expect(p.defaulted).toBe(false);
    const future = await preview(await env.periodId('2027-12'));
    expect(future.period.isFuture).toBe(true);
    expect(future.blockers).toContain('future_period');
  });
});

describe('run (AC-12, AC-13)', () => {
  it('AC-12 golden R1: one run, two lines, one entry dated the period end (6700 Dr out_of_scope, 1929 / 1930 Cr)', async () => {
    const res = await runPeriod('2026-10');
    expect(res.created).toBe(true);
    expect(res.run).toMatchObject({ totalAmount: '15000', assetCount: 2 });
    expect(res.run?.number).toMatch(/^DR-/);
    expect(await entryLines(res.run?.journalEntryId as string)).toEqual([
      ['6700', 'Dr 15000', 'out_of_scope'],
      ['1929', 'Cr 10000', null],
      ['1930', 'Cr 5000', null],
    ]);
    const entry = await env.run({}, (ctx) => repo(ctx, JournalEntry).get(res.run?.journalEntryId as string));
    expect([entry.date, entry.sourceEntity, entry.docstatus]).toEqual([
      '2026-10-31',
      'depreciation_run',
      DOCSTATUS.submitted,
    ]);
    const lines = await env.run({}, (ctx) =>
      repo(ctx, DepreciationRunLine).list({ where: { runId: res.run?.id as string }, orderBy: [{ field: 'seq' }] }),
    );
    expect(lines.items.map((l) => [l.amount.toString(), l.annualAmount.toString(), l.date])).toEqual([
      ['10000', '60000', '2026-10-31'],
      ['5000', '30000', '2026-10-31'],
    ]);
  });

  it('AC-13: running the same period again creates nothing (created: false, existing runs listed)', async () => {
    const res = await runPeriod('2026-10');
    expect(res.created).toBe(false);
    expect(res.existingRuns).toHaveLength(1);
    const entries = await env.run({}, (ctx) => repo(ctx, JournalEntry).count({ sourceEntity: 'depreciation_run' }));
    expect(entries).toBe(1);
  });

  it('AC-13: an asset registered after the run gets its own run in the same period', async () => {
    await createAsset({ code: 'LATE', cost: '120000', inServiceDate: '2026-10-20' });
    const res = await runPeriod('2026-10');
    expect(res.run).toMatchObject({ assetCount: 1, totalAmount: '2000' });
    const p = await preview(await env.periodId('2026-10'));
    expect(p.lines).toEqual([]);
    expect(p.skipped.already_booked).toBe(3);
    expect(p.runs).toHaveLength(2);
  });

  it('AC-9 AC-13: skipping November books November and December together in December', async () => {
    const res = await runPeriod('2026-12');
    // G1 2 × 10,000 + SW1 2 × 5,000 + LATE 2 × 2,000.
    expect(res.run).toMatchObject({ totalAmount: '34000', assetCount: 3 });
  });

  it('AC-13: two transactions running the same period book each asset once', async () => {
    const period = await env.periodId('2027-01');
    const results = await Promise.allSettled([
      env.act<RunResult>('fixed_assets.run_depreciation', { periodId: period }),
      env.act<RunResult>('fixed_assets.run_depreciation', { periodId: period }),
    ]);
    const created = results.filter((r) => r.status === 'fulfilled' && r.value.created).length;
    expect(created).toBe(1);
    const lines = await env.run({}, async (ctx) => {
      const runs = await repo(ctx, DepreciationRun).list({
        where: { periodId: period, docstatus: DOCSTATUS.submitted },
      });
      return repo(ctx, DepreciationRunLine).count({ runId: { $in: runs.items.map((r) => r.id) } });
    });
    expect(lines).toBe(3);
  });
});

describe('refusals (AC-14, AC-15, AC-16, AC-35)', () => {
  it('AC-14: a future period is refused with future_period and nothing is created', async () => {
    const e = await caught(runPeriod('2027-10'));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details?.reason).toBe('future_period');
  });

  it('AC-14: a closed period is refused like accounting.assertOpenPeriod; the preview still shows amounts', async () => {
    const period = await env.periodId('2027-02');
    await env.act('accounting.close_period', { periodId: period });
    const e = await caught(runPeriod('2027-02'));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).message).toContain('2027-02 is closed');
    const p = await preview(period);
    expect([p.period.isClosed, p.lines.length > 0, p.blockers.includes('period_closed')]).toEqual([true, true, true]);
    await env.act('accounting.reopen_period', { periodId: period });
  });

  it('AC-15: an asset with a run in a later fiscal year refuses the earlier period', async () => {
    await runPeriod('2027-04');
    const e = await caught(runPeriod('2027-03'));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details?.reason).toBe('later_year_booked');
  });

  it('AC-11: priorYearPending reports the unbooked last period of the open previous year', async () => {
    const p = await preview(await env.periodId('2027-05'));
    expect(p.priorYearPending).toMatchObject({ count: 3, total: '34000', periodId: await env.periodId('2027-03') });
  });

  it('AC-16: cancelling a middle run is refused while a later run books the same assets', async () => {
    const dec = await env.run({}, (ctx) =>
      repo(ctx, DepreciationRun).list({ where: { date: '2026-12-31', docstatus: DOCSTATUS.submitted } }),
    );
    const e = await caught(env.act('depreciation_run.cancel', { id: dec.items[0]?.id }));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details?.reason).toBe('later_runs');
  });

  it('AC-16: cancel newest first, a correction date outside the run year is refused, then the shortfall is re-booked', async () => {
    const apr = await env.run({}, (ctx) =>
      repo(ctx, DepreciationRun).list({ where: { date: '2027-04-30', docstatus: DOCSTATUS.submitted } }),
    );
    const aprId = apr.items[0]?.id as string;
    const outside = await caught(env.act('depreciation_run.cancel', { id: aprId, correctionDate: '2028-04-01' }));
    expect(outside).toBeInstanceOf(ValidationError);
    await env.act('depreciation_run.cancel', { id: aprId });
    const reversal = await env.run({}, (ctx) =>
      repo(ctx, JournalEntry).count({ reversalOf: apr.items[0]?.journalEntryId as string }),
    );
    expect(reversal).toBe(1);
    // FY2026 booked Oct, Dec (Nov+Dec), Jan: March books Feb + Mar of the year allocation for the three assets.
    const res = await runPeriod('2027-03');
    expect(res.run).toMatchObject({ totalAmount: '34000' });
  });

  it('AC-16: generic create and duplicate of a run or a line are refused with use_depreciation_screen', async () => {
    for (const [action, input] of [
      ['depreciation_run.create', {}],
      ['depreciation_run_line.create', {}],
    ] as const) {
      const e = await caught(env.act(action, input));
      expect(e).toBeInstanceOf(StateError);
      expect((e as StateError).details?.reason).toBe('use_depreciation_screen');
    }
  });

  it('AC-14: a closed fiscal year refuses the run', async () => {
    const fy = await env.run({}, (ctx) => repo(ctx, FiscalYear).list({ where: { code: 'FY2026' } }));
    const id = fy.items[0]?.id as string;
    await env.run({}, (ctx) => repo(ctx, FiscalYear).update(id, { isClosed: true }));
    try {
      const e = await caught(runPeriod('2027-02'));
      expect(e).toBeInstanceOf(StateError);
      expect((e as StateError).message).toContain('FY2026 is closed');
    } finally {
      await env.run({}, (ctx) => repo(ctx, FiscalYear).update(id, { isClosed: false }));
    }
  });

  it('AC-35: unverified rules without the company confirmation refuse the run (rules_unverified); preview works', async () => {
    await env.run({}, (ctx) =>
      setSetting(ctx, RULES_CONFIRMATION_KEY, rulesConfirmationSchema, { ruleSetId: '', confirmedOn: '' }),
    );
    const e = await caught(runPeriod('2027-05'));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details).toMatchObject({ reason: 'rules_unverified', ruleSetId: TEST_RULES.id });
    const p = await preview(await env.periodId('2027-05'));
    expect([p.rules.usable, p.blockers.includes('rules_unverified')]).toEqual([false, true]);
    useRules({ ...TEST_RULES, verifiedOn: '2026-11-01' });
    try {
      expect((await runPeriod('2027-05')).created).toBe(true);
    } finally {
      useRules();
      await env.run({}, (ctx) =>
        setSetting(ctx, RULES_CONFIRMATION_KEY, rulesConfirmationSchema, {
          ruleSetId: TEST_RULES.id,
          confirmedOn: '2026-10-30',
        }),
      );
    }
  });

  it('AC-10: no registered rules refuses the preview and the run with the country-pack hint', async () => {
    useRules(null);
    try {
      const e = await caught(preview());
      expect(e).toBeInstanceOf(StateError);
      expect((e as StateError).details?.reason).toBe('rules_missing');
      useRules({ ...TEST_RULES, currency: 'USD' });
      expect(((await caught(runPeriod('2027-06'))) as StateError).details?.reason).toBe('rules_currency');
    } finally {
      useRules();
    }
  });

  it('AC-11: the asset row stays untouched by runs (no status change)', async () => {
    const a = await env.run({}, (ctx) => repo(ctx, FixedAsset).get(g1));
    expect([a.status, a.depreciationStart]).toEqual(['active', '2026-10-01']);
    expect(soft).toBeTruthy();
  });
});
