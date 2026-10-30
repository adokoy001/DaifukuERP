// Reproducible synthetic benchmark of the cash forecast (docs/specs/cash-forecast.md verification step 6). Not part of
// the gate: timing is reported, never asserted. Seeds a fresh test database (TEST_DATABASE_URL_OWNER /
// TEST_DATABASE_URL) with open submitted sales and purchase invoices and active monthly contracts, then times
// banking.cash_forecast and banking.cash_schedule for a 90-day period.
// Run: pnpm exec tsx modules/banking/test/cash-forecast-benchmark.ts
// Sizes: CASH_BENCH_INVOICES (open invoices in total, half sales and half purchase; default 5000),
//        CASH_BENCH_CONTRACTS (default 500).
import { registerCrudActions, repo, runAction, type Context } from '@daifuku/kernel';
import { freshDb } from '@daifuku/kernel/testing';
import { Account, openFiscalYear } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { BankingModule } from '../src/index.ts';

const INVOICES = Number(process.env.CASH_BENCH_INVOICES ?? 5000);
const CONTRACTS = Number(process.env.CASH_BENCH_CONTRACTS ?? 500);
const NOW = new Date('2026-09-13T03:00:00Z');
const BATCH = 100;

async function main() {
  if (BankingModule.name !== 'banking') throw new Error('Missing module');
  registerCrudActions();
  const db = await freshDb();
  const run = <T>(fn: (ctx: Context) => Promise<T>) => db.run({ now: () => NOW }, fn);
  const started = performance.now();
  const { partnerId, expense } = await run(async (ctx) => {
    await openFiscalYear(ctx, { startDate: '2026-01-01' });
    const ids: Record<string, string> = {};
    for (const [code, type] of [
      ['1000', 'asset'],
      ['1100', 'asset'],
      ['1300', 'asset'],
      ['2100', 'liability'],
      ['4000', 'revenue'],
      ['5000', 'expense'],
      ['2200', 'liability'],
      ['1500', 'asset'],
    ] as const)
      ids[code] = (
        await repo(ctx, Account).create({
          code,
          name: `計測 ${code}`,
          type,
          partnerRequired: code === '1300' || code === '2100',
        })
      ).id;
    const partner = await repo(ctx, Partner).create({ name: '計測取引先', isCustomer: true, isSupplier: true });
    return { partnerId: partner.id, expense: ids['5000'] };
  });
  const day = (n: number) => {
    const d = new Date('2026-09-13T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  for (let i = 0; i < INVOICES; i += BATCH)
    await run(async (ctx) => {
      for (let j = i; j < Math.min(INVOICES, i + BATCH); j++) {
        const entity = j % 2 === 0 ? 'sales_invoice' : 'purchase_invoice';
        const created = (await runAction(ctx, `${entity}.create`, {
          partnerId,
          date: '2026-09-01',
          dueDate: day((j % 120) - 20),
          lines: {
            [`${entity}_line`]: [
              {
                ...(entity === 'purchase_invoice' ? { accountId: expense } : {}),
                description: '計測',
                unitPrice: String(1000 + (j % 997)),
                taxCategory: 'exempt',
              },
            ],
          },
        })) as { id: string };
        await runAction(ctx, `${entity}.submit`, { id: created.id });
      }
    });
  for (let i = 0; i < CONTRACTS; i += BATCH)
    await run(async (ctx) => {
      for (let j = i; j < Math.min(CONTRACTS, i + BATCH); j++) {
        const draft = (await runAction(ctx, 'contract.create', {
          partnerId,
          title: `計測契約 ${j}`,
          startDate: '2026-01-01',
          billingDay: 1 + (j % 28),
          lines: { contract_line: [{ description: '月額', unitPrice: String(10000 + j), taxCategory: 'exempt' }] },
        })) as { id: string };
        await runAction(ctx, 'contract.submit', { id: draft.id });
      }
    });
  const seededMs = performance.now() - started;
  const input = { from: '2026-09-13', to: day(89) };
  const timings: Record<string, number[]> = { 'banking.cash_forecast': [], 'banking.cash_schedule': [] };
  const sizes: Record<string, number> = {};
  for (let round = 0; round < 3; round++)
    for (const name of Object.keys(timings)) {
      const t0 = performance.now();
      const result = (await run((ctx) => runAction(ctx, name, input))) as {
        rows: unknown[];
        meta: { rowCount?: number };
      };
      timings[name]?.push(Math.round(performance.now() - t0));
      sizes[name] = result.meta.rowCount ?? result.rows.length;
    }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.warn(
    JSON.stringify({
      invoices: INVOICES,
      contracts: CONTRACTS,
      seededSeconds: Math.round(seededMs / 1000),
      rows: sizes,
      runsMs: timings,
      medianMs: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, median(v)])),
    }),
  );
  await db.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
