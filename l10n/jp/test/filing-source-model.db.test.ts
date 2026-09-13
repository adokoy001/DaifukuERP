import fc from 'fast-check';
import { expect, it } from 'vitest';
import { newId, repo } from '@daifuku/kernel';
import { Account, FiscalPeriod } from '@daifuku/mod-accounting';
import { FilingAccountingPack, type FilingDetail, type FilingExport } from '@daifuku/mod-tax-filing';
import { filingModelFixture, type FilingFixture } from './filing-model-fixture.ts';
type Op =
  | 'review'
  | 'creatorReview'
  | 'export'
  | 'accountChange'
  | 'profileChange'
  | 'periodToggle'
  | 'cancel'
  | 'recreate'
  | 'retry';
type Pack = {
  id: string;
  version: number;
  status: 'draft' | 'confirmed' | 'cancelled';
  generation: number;
  closed: boolean;
  request: object;
  evidence: unknown;
};
type Model = {
  packs: Pack[];
  generation: number;
  closed: boolean;
  profileVersion: number;
  success: number;
  rejected: number;
  exports: number;
  staleRejected: number;
};
const latest = (m: Model) => required(m.packs.at(-1));
async function prepare(m: Model, f: FilingFixture) {
  const previous = m.packs.at(-1),
    request = { ...f.request, idempotencyKey: newId(), ...(previous ? { previousId: previous.id } : {}) };
  const result = await f.action('prepare_accounting', request);
  expect(m.packs.map((p) => p.id)).not.toContain(result.id);
  m.packs.push({
    ...result,
    status: 'draft',
    generation: m.generation,
    closed: m.closed,
    request,
    evidence: await f.evidence(result.id),
  });
  m.success++;
}
async function verify(m: Model, f: FilingFixture, capital: number, sale: number) {
  const p = latest(m),
    d = await f.action<FilingDetail>('get', { kind: 'accounting', id: p.id });
  expect(d).toMatchObject({
    version: p.version,
    status: p.status,
    stale: p.generation !== m.generation,
    totals: { assets: String(BigInt(capital) + BigInt(sale)), netProfit: String(sale), balanceDifference: '0' },
  });
  const rows = await f.run((ctx) => repo(ctx, FilingAccountingPack).list({ limit: 500 }));
  expect(rows.total).toBe(m.packs.length);
  expect(rows.items.map((row) => row.id).sort()).toEqual(m.packs.map((p) => p.id).sort());
  for (const [i, saved] of m.packs.entries()) {
    expect(await f.evidence(saved.id)).toEqual(saved.evidence);
    expect(rows.items.find((row) => row.id === saved.id)).toMatchObject({
      status: saved.status,
      version: saved.version,
      previousId: m.packs[i - 1]?.id ?? null,
    });
  }
}
async function state(m: Model, f: FilingFixture, op: 'review' | 'creatorReview' | 'cancel') {
  const p = latest(m),
    confirming = op !== 'cancel';
  const allowed = confirming
    ? op === 'review' && p.status === 'draft' && p.generation === m.generation && p.closed
    : p.status !== 'cancelled';
  const input = {
    kind: 'accounting',
    id: p.id,
    expectedVersion: p.version,
    reason: 'Generated review',
    ...(confirming ? { warningsReviewed: true } : {}),
  };
  const call = f.action(confirming ? 'confirm' : 'cancel', input, op === 'review' ? f.reviewer : {});
  if (allowed) {
    const result = await call;
    p.version = result.version;
    p.status = confirming ? 'confirmed' : 'cancelled';
    m.success++;
  } else {
    const code =
      op === 'review' && p.status === 'draft' && p.generation !== m.generation ? 'CONFLICT' : 'INVALID_STATE';
    await expect(call).rejects.toMatchObject({ code });
    m.rejected++;
  }
}
async function exportPack(m: Model, f: FilingFixture) {
  const p = latest(m),
    allowed = p.status === 'confirmed' && p.generation === m.generation && p.closed;
  const call = f.action<FilingExport>('export', { kind: 'accounting', id: p.id, expectedVersion: p.version });
  if (allowed) {
    const output = await call;
    expect(output.officialImport).toBe(true);
    expect(output.files).toHaveLength(2);
    expect(output.sourceHash).toBe((await f.evidence(p.id)).sourceHash);
    m.exports++;
  } else {
    const code = p.status === 'confirmed' && p.generation !== m.generation ? 'CONFLICT' : 'INVALID_STATE';
    await expect(call).rejects.toMatchObject({ code });
    m.rejected++;
    if (p.status === 'confirmed' && p.generation !== m.generation) m.staleRejected++;
  }
}
async function sourceChange(m: Model, f: FilingFixture, op: Op) {
  m.generation++;
  if (op === 'accountChange')
    await f.run((ctx) => repo(ctx, Account).update(f.cash.id, { name: `現預金 ${m.generation}` }));
  if (op === 'profileChange') {
    const result = await f.action('save_accounting_profile', {
      ...f.profile,
      expectedVersion: m.profileVersion,
      legalName: `株式会社試験${'改'.repeat(m.generation)}`,
    });
    m.profileVersion = result.version;
  }
  if (op === 'periodToggle') {
    m.closed = !m.closed;
    await f.run((ctx) => repo(ctx, FiscalPeriod).update(required(f.year.periods[0]).id, { isClosed: m.closed }));
  }
}
async function execute(m: Model, f: FilingFixture, op: Op) {
  if (op === 'recreate') await prepare(m, f);
  else if (op === 'review' || op === 'creatorReview' || op === 'cancel') await state(m, f, op);
  else if (op === 'export') await exportPack(m, f);
  else if (op === 'retry') {
    const p = latest(m);
    expect(await f.action('prepare_accounting', p.request)).toEqual({ id: p.id, version: p.version });
  } else await sourceChange(m, f, op);
}
it('AC-9 / FILING-SOURCE-01 compares saved evidence and current-source gates over generated histories', async () => {
  const choices: Op[] = [
    'review',
    'creatorReview',
    'export',
    'accountChange',
    'profileChange',
    'periodToggle',
    'cancel',
    'recreate',
    'retry',
  ];
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 9_999_999 }),
      fc.integer({ min: 1, max: 9_999_999 }),
      fc.array(fc.constantFrom(...choices), { minLength: 3, maxLength: 8 }),
      async (capital, sale, tail) => {
        const f = await filingModelFixture(capital, sale),
          m: Model = {
            packs: [],
            generation: 0,
            closed: true,
            profileVersion: 1,
            success: 0,
            rejected: 0,
            exports: 0,
            staleRejected: 0,
          };
        try {
          await prepare(m, f);
          const prefix: Op[] = [
            'retry',
            'export',
            'creatorReview',
            'review',
            'export',
            'accountChange',
            'export',
            'cancel',
            'export',
            'recreate',
            'review',
            'export',
            'periodToggle',
            'export',
            'periodToggle',
            'recreate',
            'review',
            'profileChange',
            'export',
          ];
          for (const op of [...prefix, ...tail]) {
            await execute(m, f, op);
            await verify(m, f, capital, sale);
          }
          expect(m.success).toBeGreaterThanOrEqual(7);
          expect(m.exports).toBeGreaterThanOrEqual(2);
          expect(m.rejected).toBeGreaterThanOrEqual(6);
          expect(m.staleRejected).toBeGreaterThanOrEqual(3);
        } finally {
          await f.db.close();
        }
      },
    ),
    {
      seed: Number(process.env['PBT_SEED'] ?? 730909),
      numRuns: Number(process.env['PBT_RUNS'] ?? 4),
      ...(process.env['PBT_PATH'] ? { path: process.env['PBT_PATH'] } : {}),
    },
  );
}, 180_000);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing generated source');
  return value;
}
