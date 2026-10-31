// Postgres tests of retirements and sales (docs/specs/fixed-assets.md AC-17..AC-20, AC-35; golden D1, D2, D3, D7).
// Test DB: TEST_DATABASE_URL*. Today is 2027-09-15 (JST); fiscal years run April–March (FY2026, FY2027).
import {
  DOCSTATUS,
  repo,
  runAction,
  setSetting,
  StateError,
  ValidationError,
  withLock,
  type Context,
} from '@daifuku/kernel';
import { Account, loadLines } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXED_ASSETS_LOCK } from '../src/domain-write.ts';
import { FixedAsset, RULES_CONFIRMATION_KEY, rulesConfirmationSchema } from '../src/index.ts';
import { caught, issues, setupEnv, type Env, type Row } from './db-setup.ts';
import { TEST_RULES } from './fixture-rules.ts';

const NOW = new Date('2027-09-15T03:00:00Z');
let env: Env;
type Disposal = Row & {
  id: string;
  number: string | null;
  docstatus: number;
  disposalYearDepreciation: string | null;
  accumulatedDepreciation: string | null;
  bookValue: string | null;
  taxAmount: string | null;
  gain: string | null;
  loss: string | null;
  journalEntryId: string | null;
  proceedsAccountId: string | null;
};

/** A G1 asset (1925 / 1929 / 6700) depreciated through 2027-06 (accumulated 90,000). */
async function g1Asset(code: string): Promise<string> {
  const a = await env.act<{ id: string }>('fixed_asset.create', {
    code,
    name: `備品 ${code}`,
    assetClass: 'tools_furniture',
    acquisitionDate: '2026-10-01',
    inServiceDate: '2026-10-15',
    cost: '600000',
    method: 'straight_line',
    usefulLife: 5,
    assetAccountId: await env.account('1925'),
  });
  return a.id;
}
async function entryView(entryId: string) {
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
const draft = (input: Row) => env.act<Disposal>('fixed_asset_disposal.create', input);
const submit = (id: string) => env.act<Disposal>('fixed_asset_disposal.submit', { id });

beforeAll(async () => {
  env = await setupEnv(NOW, { fiscalYears: ['2026-04-01', '2027-04-01'] });
  for (const code of ['D1', 'D2', 'D3', 'D7', 'X1']) await g1Asset(code);
  await env.act('fixed_assets.run_depreciation', { periodId: await env.periodId('2027-03') });
  await env.act('fixed_assets.run_depreciation', { periodId: await env.periodId('2027-06') });
});
afterAll(async () => {
  await env.db.close();
});

const assetId = async (code: string) =>
  env.run({}, async (ctx) => (await repo(ctx, FixedAsset).list({ where: { code } })).items[0]?.id as string);

describe('retirement (AC-17, AC-18, AC-20)', () => {
  it('AC-17: the draft shows the computed values; AC-18 golden D1: submit posts one entry; AC-20 the asset is disposed', async () => {
    const id = await assetId('D1');
    const d = await draft({ assetId: id, date: '2027-08-20', kind: 'retirement' });
    expect([d.disposalYearDepreciation, d.accumulatedDepreciation, d.bookValue, d.loss]).toEqual([
      '20000',
      '110000',
      '490000',
      '490000',
    ]);
    const s = await submit(d.id);
    expect(s.docstatus).toBe(DOCSTATUS.submitted);
    expect(s.number).toMatch(/^FD-/);
    expect(await entryView(s.journalEntryId as string)).toEqual([
      ['6700', 'Dr 20000', 'out_of_scope'],
      ['1929', 'Cr 20000', null],
      ['1929', 'Dr 110000', null],
      ['1925', 'Cr 600000', null],
      ['8300', 'Dr 490000', 'out_of_scope'],
    ]);
    const asset = await env.run({}, (ctx) => repo(ctx, FixedAsset).get(id));
    expect([asset.status, asset.disposedOn]).toEqual(['disposed', '2027-08-20']);
    const p = await env.act<{ lines: { code: string }[] }>('fixed_assets.preview_depreciation', {
      periodId: await env.periodId('2027-08'),
    });
    expect(p.lines.map((l) => l.code)).not.toContain('D1');
  });

  it('AC-20: cancel reverses the entry and makes the asset active again; a correction date outside the year is refused', async () => {
    const id = await assetId('D1');
    const d = await env.run(
      {},
      async (ctx) =>
        (await runAction(ctx, 'fixed_asset_disposal.list', { where: { assetId: id } })) as { items: Disposal[] },
    );
    const disposal = d.items[0] as Disposal;
    const outside = await caught(
      env.act('fixed_asset_disposal.cancel', { id: disposal.id, correctionDate: '2028-04-02' }),
    );
    expect(outside).toBeInstanceOf(ValidationError);
    await env.act('fixed_asset_disposal.cancel', { id: disposal.id });
    const asset = await env.run({}, (ctx) => repo(ctx, FixedAsset).get(id));
    expect([asset.status, asset.disposedOn]).toEqual(['active', null]);
  });

  it('AC-17: retirement with proceeds, a date before acquisition and depreciation booked after the date are refused', async () => {
    const id = await assetId('X1');
    const withProceeds = await draft({ assetId: id, date: '2027-08-20', kind: 'retirement', proceeds: '10' });
    expect(issues(await caught(submit(withProceeds.id)))).toContain('proceeds');
    const early = await draft({ assetId: id, date: '2026-09-01', kind: 'retirement' });
    expect(issues(await caught(submit(early.id)))).toContain('date');
    const beforeRun = await draft({ assetId: id, date: '2027-05-10', kind: 'retirement' });
    const e = await caught(submit(beforeRun.id));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details?.reason).toBe('later_depreciation');
  });
});

describe('sale (AC-19)', () => {
  it('AC-19 golden D2: sale at a loss with standard 10% tax; the tax period summary shows the sale', async () => {
    const id = await assetId('D2');
    const d = await draft({ assetId: id, date: '2027-08-20', kind: 'sale', proceeds: '450000' });
    expect(d.proceedsAccountId).toBe(await env.account('1910'));
    const s = await submit(d.id);
    expect([s.taxAmount, s.loss, s.gain]).toEqual(['45000', '40000', '0']);
    expect((await entryView(s.journalEntryId as string)).slice(4)).toEqual([
      ['1910', 'Dr 495000', null],
      ['2200', 'Cr 45000', 'standard'],
      ['8100', 'Cr 450000', 'standard'],
      ['8100', 'Dr 450000', null],
      ['8200', 'Dr 40000', 'out_of_scope'],
    ]);
    const summary = await env.act<{ rows: Row[] }>('accounting.tax_period_summary', {
      from: '2027-08-01',
      to: '2027-08-31',
    });
    expect(
      summary.rows.filter((r) => r.side === '売上').map((r) => [r.taxCategory, r.taxableAmount, r.taxAmount]),
    ).toEqual([['standard', '450000', '45000']]);
  });

  it('AC-19 golden D3: sale at a gain nets 10,000 on the gain account and has no loss line', async () => {
    const id = await assetId('D3');
    const s = await submit((await draft({ assetId: id, date: '2027-08-20', kind: 'sale', proceeds: '500000' })).id);
    expect([s.gain, s.loss]).toEqual(['10000', '0']);
    expect((await entryView(s.journalEntryId as string)).slice(4)).toEqual([
      ['1910', 'Dr 550000', null],
      ['2200', 'Cr 50000', 'standard'],
      ['8100', 'Cr 500000', 'standard'],
      ['8100', 'Dr 490000', null],
    ]);
  });

  it('AC-19 golden D7: a non-taxable sale has no output tax line', async () => {
    const id = await assetId('D7');
    const s = await submit(
      (await draft({ assetId: id, date: '2027-08-20', kind: 'sale', proceeds: '450000', taxCategory: 'non_taxable' }))
        .id,
    );
    expect((await entryView(s.journalEntryId as string)).slice(4)).toEqual([
      ['1910', 'Dr 450000', null],
      ['8100', 'Cr 450000', 'non_taxable'],
      ['8100', 'Dr 450000', null],
      ['8200', 'Dr 40000', 'out_of_scope'],
    ]);
    const summary = await env.act<{ rows: Row[] }>('accounting.tax_period_summary', {
      from: '2027-08-01',
      to: '2027-08-31',
    });
    expect(
      summary.rows.filter((r) => r.side === '売上' && r.taxCategory === 'non_taxable').map((r) => r.taxableAmount),
    ).toEqual(['450000']);
  });

  it('AC-17: a sale needs proceeds; a partner-required proceeds account needs the buyer; a second disposal is refused', async () => {
    const id = await assetId('X1');
    expect(issues(await caught(submit((await draft({ assetId: id, date: '2027-08-20', kind: 'sale' })).id)))).toContain(
      'proceeds',
    );
    const receivable = await env.account('1300');
    const noBuyer = await draft({
      assetId: id,
      date: '2027-08-20',
      kind: 'sale',
      proceeds: '1000',
      proceedsAccountId: receivable,
    });
    expect(issues(await caught(submit(noBuyer.id)))).toContain('partnerId');
    const buyer = await env.run({}, (ctx) => repo(ctx, Partner).create({ name: '買手', isCustomer: true }));
    const withBuyer = await draft({
      assetId: id,
      date: '2027-08-20',
      kind: 'sale',
      proceeds: '1000',
      proceedsAccountId: receivable,
      partnerId: buyer.id,
    });
    await submit(withBuyer.id);
    const second = await draft({ assetId: id, date: '2027-08-25', kind: 'retirement' });
    const e = await caught(submit(second.id));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details?.reason).toBe('already_disposed');
  });

  it('AC-16: a run with a disposed asset cannot be cancelled', async () => {
    const runs = await env.run(
      {},
      async (ctx) =>
        (await runAction(ctx, 'depreciation_run.list', { where: { date: '2027-06-30', docstatus: 1 } })) as {
          items: { id: string }[];
        },
    );
    const e = await caught(env.act('depreciation_run.cancel', { id: runs.items[0]?.id }));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details?.reason).toBe('asset_disposed');
  });
});

describe('refusals (AC-20, AC-35)', () => {
  it('AC-20: a disposal dated in a closed period is refused by accounting', async () => {
    const id = await g1Asset('C1');
    const period = await env.periodId('2027-07');
    await env.act('accounting.close_period', { periodId: period });
    try {
      const d = await draft({ assetId: id, date: '2027-07-10', kind: 'retirement' });
      const e = await caught(submit(d.id));
      expect(e).toBeInstanceOf(StateError);
      expect((e as StateError).message).toContain('closed');
    } finally {
      await env.act('accounting.reopen_period', { periodId: period });
    }
  });

  it('AC-35: unverified rules without the confirmation refuse the submit (rules_unverified)', async () => {
    const id = await g1Asset('U1');
    await env.run({}, (ctx) =>
      setSetting(ctx, RULES_CONFIRMATION_KEY, rulesConfirmationSchema, {
        ruleSetId: 'old-id',
        confirmedOn: '2026-10-30',
      }),
    );
    try {
      const d = await draft({ assetId: id, date: '2027-08-10', kind: 'retirement' });
      const e = await caught(submit(d.id));
      expect(e).toBeInstanceOf(StateError);
      expect((e as StateError).details).toMatchObject({ reason: 'rules_unverified', ruleSetId: TEST_RULES.id });
    } finally {
      await env.run({}, (ctx) =>
        setSetting(ctx, RULES_CONFIRMATION_KEY, rulesConfirmationSchema, {
          ruleSetId: TEST_RULES.id,
          confirmedOn: '2026-10-30',
        }),
      );
    }
    const d = await env.run(
      {},
      async (ctx) =>
        (await runAction(ctx, 'fixed_asset_disposal.list', { where: { assetId: id } })) as { items: Disposal[] },
    );
    expect((await submit(d.items[0]?.id as string)).docstatus).toBe(DOCSTATUS.submitted);
    expect(await env.run({}, (ctx) => repo(ctx, Account).count())).toBeGreaterThan(0);
  });
});

function latch() {
  let release = () => undefined as void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
/** Lock requests waiting in this test database (optionally of one lock type). */
async function waitingLocks(locktype?: string): Promise<number> {
  const [row] = await env.db.owner.sql<{ n: number }[]>`
    select count(*)::int as n from pg_locks l join pg_stat_activity a on a.pid = l.pid
    where a.datname = current_database() and not l.granted and (${locktype ?? null}::text is null or l.locktype = ${locktype ?? null})`;
  return row?.n ?? 0;
}
async function until(condition: () => Promise<boolean>): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > 15_000) throw new Error('timed out waiting for the lock state');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
/** Holds the company lock of the fixed-assets module in its own transaction until released. */
async function holdCompanyLock() {
  const held = latch();
  const release = latch();
  const done = env.run({}, (ctx) =>
    withLock(ctx, FIXED_ASSETS_LOCK, async () => {
      held.release();
      await release.promise;
    }),
  );
  await held.promise;
  return { release: release.release, done };
}

describe('lock order (ADR-0020)', () => {
  it('AC-4 AC-20: a financial edit during a disposal submit waits for the submit instead of deadlocking', async () => {
    const id = await g1Asset('L1');
    const d = await draft({ assetId: id, date: '2027-08-20', kind: 'retirement' });
    const lock = await holdCompanyLock();
    let submitting: Promise<unknown> = Promise.resolve();
    let editing: Promise<unknown> = Promise.resolve();
    try {
      // The submit takes the asset row first, then queues for the company lock.
      submitting = submit(d.id);
      await until(async () => (await waitingLocks('advisory')) === 1);
      // The edit queues for the asset row (before, it took the row and queued for the company lock: 40P01).
      editing = env.act('fixed_asset.update', { id, patch: { usefulLife: 4 } });
      await until(async () => (await waitingLocks()) >= 2);
    } finally {
      lock.release();
    }
    const [submitted, edited] = await Promise.allSettled([submitting, editing, lock.done]);
    expect(submitted.status).toBe('fulfilled');
    expect(edited.status).toBe('rejected');
    const reason = (edited as PromiseRejectedResult).reason as StateError;
    expect(reason).toBeInstanceOf(StateError);
    expect(reason.details?.reason).toBe('asset_frozen');
    const asset = await env.run({}, (ctx) => repo(ctx, FixedAsset).get(id));
    expect([asset.status, asset.usefulLife]).toEqual(['disposed', 5]);
  });

  it('AC-4: a name or memo edit never waits for the company lock', async () => {
    const id = await assetId('X1');
    const lock = await holdCompanyLock();
    let finished = false;
    let sawWait = false;
    const editing = env.act('fixed_asset.update', { id, patch: { memo: 'edited while locked' } }).finally(() => {
      finished = true;
    });
    try {
      while (!finished && !sawWait) {
        sawWait = (await waitingLocks('advisory')) > 0;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      lock.release();
    }
    await Promise.all([editing, lock.done]);
    expect(sawWait).toBe(false);
    expect((await env.run({}, (ctx) => repo(ctx, FixedAsset).get(id))).memo).toBe('edited while locked');
  });
});
