import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import {
  repo,
  runAction,
  registerCrudActions,
  newId,
  relayCredentials,
  newRelaySecret,
  relayHash,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { WorkforceSite } from '@daifuku/mod-workforce';
import {
  EdgeJob,
  claimJob,
  startJob,
  completeJob,
  heartbeatJob,
  type EdgeClaimedJob,
  type EdgeResult,
} from '../src/index.ts';

type Step = { event: string; states: string[]; attempts: number[]; grants: number[] };
type Trace = { id: string; steps: Step[] };
const traces = JSON.parse(
  await readFile(new URL('../../../verification/edge/traces.json', import.meta.url), 'utf8'),
) as Trace[];
const serverProjection = ({ event, states, attempts, grants }: Step): Step => ({ event, states, attempts, grants });
let db: TestDb;
beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});
const lease = (job: EdgeClaimedJob) => ({ jobId: job.id, attempt: job.attempt, leaseToken: job.leaseToken });

async function fixture() {
  let clock = new Date();
  const run = <T>(work: (ctx: Context) => Promise<T>, extra: Partial<ContextParams> = {}) =>
    db.run({ now: () => clock, ...extra }, work);
  const action = (name: string, input: unknown) =>
    run((ctx) => runAction(ctx, name, input)) as Promise<{ id: string; state: string; version: number }>;
  const site = await run((ctx) => repo(ctx, WorkforceSite).create({ code: newId(), name: 'Model trace site' }));
  const gateway = await action('edge.create_gateway', { siteId: site.id, code: newId(), name: 'Model trace gateway' });
  const device = await action('edge.register_device', {
    gatewayId: gateway.id,
    localDeviceId: 'model',
    name: 'Synthetic printer',
    driver: 'simulator',
  });
  const credentialId = newId();
  await db.owner.drizzle.insert(relayCredentials).values({
    id: credentialId,
    tenantId: db.tenantId,
    companyId: db.companyId,
    gatewayId: gateway.id,
    siteId: site.id,
    secretHash: relayHash(newRelaySecret()),
    credentialVersion: 1,
    expiresAt: new Date(clock.getTime() + 86400000),
  });
  const machine = <T>(work: (ctx: Context) => Promise<T>) =>
    run(work, {
      actor: { type: 'relay', id: gateway.id },
      roles: ['relay'],
      relay: { credentialId, credentialVersion: 1, gatewayId: gateway.id, siteId: site.id },
    });
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    clock = new Date(clock.getTime() + 10);
    ids.push(
      (
        await action('edge.enqueue', {
          deviceId: device.id,
          idempotencyKey: newId(),
          request: { kind: 'print.text', payload: { title: 'Synthetic model', text: 'No actual device', copies: 1 } },
          expiresAt: new Date(clock.getTime() + 3600000).toISOString(),
        })
      ).id,
    );
  }
  const rows = () => run(async (ctx) => Promise.all(ids.map((id) => repo(ctx, EdgeJob).get(id))));
  return {
    action,
    machine,
    ids,
    rows,
    advance: () => {
      clock = new Date(clock.getTime() + 91000);
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Replay = {
  claims: Map<number, EdgeClaimedJob>;
  results: Map<number, EdgeResult>;
  grants: number[];
  completed: Set<string>;
  resolved: Set<string>;
};
const localOnly = new Set([
  'Init',
  'PersistStarting',
  'SendStart',
  'DeliverStart',
  'DropStart',
  'PersistExecuting',
  'PhysicalSend',
  'SendComplete',
  'DropComplete',
  'DeliverComplete',
  'Crash',
]);

async function serverStep(f: Fixture, replay: Replay, event: string): Promise<void> {
  const [operation, workerText, argument] = event.split(':'),
    worker = Number(workerText);
  if (operation === 'Claim') {
    const response = await f.machine(claimJob);
    assert(response.job);
    expect(response.job.id).toBe(f.ids[Number(argument) - 1]);
    replay.claims.set(worker, response.job);
    return;
  }
  if (operation === 'BlockedClaim') {
    expect((await f.machine(claimJob)).job).toBeNull();
    return;
  }
  if (operation === 'Recover') {
    if (!replay.results.has(worker)) replay.results.set(worker, { state: 'uncertain', code: 'trace_result' });
    return;
  }
  if (operation === 'RecordResult') {
    assert(argument === 'succeeded' || argument === 'uncertain');
    replay.results.set(worker, { state: argument, code: 'trace_result' });
    return;
  }
  if (operation === 'Resolve') {
    const row = (await f.rows())[worker - 1];
    assert(row);
    await f.action('edge.resolve', {
      jobId: row.id,
      expectedVersion: row.version,
      resolution: 'failed',
      reason: 'Synthetic operator review',
      evidence: 'Simulator stopped; no physical hardware used',
    });
    replay.resolved.add(row.id);
    return;
  }
  if (operation && localOnly.has(operation)) return; // Agent/delivery projections are exercised separately.
  const job = replay.claims.get(worker);
  assert(job, 'A claimed job is required for this trace step');
  if (operation === 'ExpireClaim') {
    f.advance();
    expect((await f.machine((ctx) => heartbeatJob(ctx, lease(job)))).accepted).toBe(false);
    return;
  }
  if (operation === 'CommitStart' || operation === 'ReplayStart') {
    const current = (await f.rows()).find((row) => row.id === job.id);
    assert(current);
    if (current.attempt !== job.attempt)
      await expect(f.machine((ctx) => startJob(ctx, lease(job)))).rejects.toThrow('superseded');
    else {
      const response = await f.machine((ctx) => startJob(ctx, lease(job)));
      const index = f.ids.indexOf(job.id);
      assert(index >= 0);
      if (response.startGranted) replay.grants[index] = (replay.grants[index] ?? 0) + 1;
      if (operation === 'ReplayStart') expect(response.startGranted).toBe(false);
    }
    return;
  }
  if (operation !== 'CommitComplete') throw new Error('Unmapped formal trace event: ' + event);
  const result = replay.results.get(worker);
  assert(result);
  const before = (await f.rows()).find((row) => row.id === job.id);
  assert(before);
  const response = await f.machine((ctx) => completeJob(ctx, { ...lease(job), result }));
  const ignored =
    before.attempt !== job.attempt ? 'obsolete_attempt' : replay.resolved.has(job.id) ? 'manually_resolved' : undefined;
  if (ignored) {
    expect(response).toMatchObject({ accepted: false, ignored, state: before.state, version: before.version });
    expect((await f.rows()).find((row) => row.id === job.id)).toEqual(before);
  } else {
    expect(response.accepted).toBe(true);
    replay.completed.add(job.id);
  }
}

describe('AC-7/8: finite Edge model trace projections through real Repository transactions', () => {
  for (const trace of traces)
    it(trace.id, async () => {
      const f = await fixture(),
        replay: Replay = {
          claims: new Map(),
          results: new Map(),
          grants: [0, 0],
          completed: new Set(),
          resolved: new Set(),
        };
      const observed: Step[] = [];
      for (const step of trace.steps) {
        await serverStep(f, replay, step.event);
        const rows = await f.rows();
        const projection = {
          event: step.event,
          states: rows.map((row) => row.state),
          attempts: rows.map((row) => row.attempt),
          grants: [...replay.grants],
        };
        expect(projection, `${trace.id}: ${step.event}`).toEqual(serverProjection(step));
        observed.push(projection);
      }
      expect(observed).toEqual(trace.steps.map(serverProjection));
      expect(replay.claims.size).toBeGreaterThan(0);
      expect(replay.completed.size).toBeGreaterThan(0);
    });
});
