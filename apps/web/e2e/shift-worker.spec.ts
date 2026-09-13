import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { signInQuality } from './quality-helpers.ts';
const fixtureUrl = '/@fs' + fileURLToPath(new URL('../../../modules/workforce/test/shift-fixture.ts', import.meta.url));

test('shift recommendation runs the full 100-person case in a real worker without blocking the page', async ({
  page,
}) => {
  test.setTimeout(60000);
  await signInQuality(page);
  await page.goto('/workforce/shifts');
  const metrics = await page.evaluate(
    async ({ sourceUrl, workerUrl }) => {
      const fixtures = await import(/* @vite-ignore */ sourceUrl);
      const workerModule = await import(/* @vite-ignore */ workerUrl);
      const problem = fixtures.benchmarkProblem();
      let ticks = 0;
      let largestGap = 0;
      let previous = performance.now();
      const ticker = setInterval(() => {
        const now = performance.now();
        largestGap = Math.max(largestGap, now - previous);
        previous = now;
        ticks++;
      }, 20);
      const run = () =>
        new Promise<{
          assignments: unknown[];
          evaluation: { issues: unknown[]; shortage: number };
          iterations: number;
        }>((resolve, reject) => {
          const worker = new workerModule.default();
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error('Worker timed out'));
          }, 20000);
          worker.onerror = () => {
            clearTimeout(timer);
            worker.terminate();
            reject(new Error('Worker failed'));
          };
          worker.onmessage = (event: MessageEvent) => {
            clearTimeout(timer);
            worker.terminate();
            if (event.data.kind !== 'result') reject(new Error('Invalid worker result'));
            else resolve(event.data.result);
          };
          worker.postMessage({ problem, options: { seed: 20260912 } });
        });
      try {
        const start = performance.now();
        const result = await run();
        const elapsedMs = performance.now() - start;
        const second = await run();
        return {
          elapsedMs,
          ticks,
          largestGap,
          assigned: result.assignments.length,
          shortage: result.evaluation.shortage,
          issues: result.evaluation.issues,
          iterations: result.iterations,
          reproducible: JSON.stringify(result) === JSON.stringify(second),
        };
      } finally {
        clearInterval(ticker);
      }
    },
    { sourceUrl: fixtureUrl, workerUrl: '/src/workers/shift.worker.ts?worker' },
  );
  expect(metrics.issues).toEqual([]);
  expect(metrics.assigned).toBe(500);
  expect(metrics.shortage).toBe(340);
  expect(metrics.reproducible).toBe(true);
  expect(metrics.ticks).toBeGreaterThan(3);
  await test
    .info()
    .attach('shift-worker-benchmark.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  console.log('SHIFT_WORKER_BENCHMARK ' + JSON.stringify(metrics));
});
