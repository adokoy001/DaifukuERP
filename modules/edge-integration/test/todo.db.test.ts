// docs/specs/inbox.md AC-1..AC-3: edge.todo counts jobs whose physical result needs confirmation (uncertain, or
// executing past lease/expiry) inside the caller's gateway site boundary, without changing job state.
import {
  appMeta,
  newId,
  newRelaySecret,
  PermissionDenied,
  registerCrudActions,
  relayCredentials,
  relayHash,
  repo,
  runAction,
  todoResult,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { WorkforceSite } from '@daifuku/mod-workforce';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimJob, completeJob, EdgeJob, startJob } from '../src/index.ts';

let db: TestDb;
let clock = new Date('2026-09-12T00:00:00Z');
const run = <T>(fn: (ctx: Context) => Promise<T>, extra: Partial<ContextParams> = {}) =>
  db.run({ now: () => clock, ...extra }, fn);
const action = <T = { id: string; version: number }>(name: string, input: unknown) =>
  run((ctx) => runAction(ctx, name, input)) as Promise<T>;
const todo = async (params: Partial<ContextParams> = {}) =>
  todoResult.parse(await run((ctx) => runAction(ctx, 'edge.todo', {}), params));
const person = (role: string, siteIds?: string[]): Partial<ContextParams> => ({
  roles: [role],
  actor: { type: 'user', id: newId() },
  ...(siteIds ? { accessScope: 'sites' as const, siteIds } : {}),
});

async function startedJob() {
  const site = await run((ctx) => repo(ctx, WorkforceSite).create({ code: newId(), name: 'Site' }));
  const gateway = await action('edge.create_gateway', { siteId: site.id, code: newId(), name: 'LAN gateway' });
  const device = await action('edge.register_device', {
    gatewayId: gateway.id,
    localDeviceId: 'printer',
    name: 'Printer',
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
  const machine: Partial<ContextParams> = {
    actor: { type: 'relay', id: gateway.id },
    roles: ['relay'],
    relay: { credentialId, credentialVersion: 1, gatewayId: gateway.id, siteId: site.id },
  };
  await action('edge.enqueue', {
    deviceId: device.id,
    idempotencyKey: newId(),
    request: { kind: 'print.text', payload: { text: 'Synthetic receipt', title: 'Test', copies: 1 } },
    expiresAt: new Date(clock.getTime() + 3600000).toISOString(),
  });
  const claimed = await run(claimJob, machine);
  if (!claimed.job) throw new Error('Expected a claimed job');
  const lease = { jobId: claimed.job.id, attempt: claimed.job.attempt, leaseToken: claimed.job.leaseToken };
  await run((ctx) => startJob(ctx, lease), machine);
  return { site, job: claimed.job, lease, machine };
}

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
});
afterAll(async () => {
  await db?.close();
});

describe('edge.todo (docs/specs/inbox.md)', () => {
  it('AC-1 AC-2: uncertain and overdue executing jobs per site; the provider never changes job state', async () => {
    expect(await todo()).toEqual({ items: [] });
    const east = await startedJob();
    const west = await startedJob();
    expect(await todo()).toEqual({ items: [] }); // executing within its lease: nothing to confirm yet
    await run(
      (ctx) => completeJob(ctx, { ...east.lease, result: { state: 'uncertain', code: 'lost_response' } }),
      east.machine,
    );
    clock = new Date(clock.getTime() + 91000); // west's execution lease has expired
    expect(await todo()).toEqual({
      items: [
        {
          key: 'uncertain_jobs',
          label: { ja: '結果の確認が必要な機器処理', en: 'Device jobs whose result needs confirmation' },
          count: 2,
          href: '/operations/devices',
          severity: 'warn',
        },
      ],
    });
    expect((await todo(person('edge_manager', [east.site.id]))).items[0]?.count).toBe(1);
    expect((await todo(person('edge_manager', [west.site.id]))).items[0]?.count).toBe(1);
    expect(await todo(person('edge_manager', [newId()]))).toEqual({ items: [] });
    expect((await run((ctx) => repo(ctx, EdgeJob).get(west.job.id))).state).toBe('executing');

    const uncertain = await run((ctx) => repo(ctx, EdgeJob).get(east.job.id));
    await action('edge.resolve', {
      jobId: uncertain.id,
      expectedVersion: uncertain.version,
      reason: 'Checked the printer',
      evidence: 'Printed receipt found at the counter',
      resolution: 'succeeded',
    });
    expect(await todo(person('edge_manager', [east.site.id]))).toEqual({ items: [] });
  });

  it('AC-1 AC-3: operators (who cannot run edge.resolve) and read-only roles are refused and do not see the provider', async () => {
    for (const params of [
      person('edge_operator', [newId()]),
      person('edge_operator'),
      person('workforce_hr'),
      person('sales'),
    ]) {
      await expect(todo(params)).rejects.toBeInstanceOf(PermissionDenied);
      expect(await run(async (ctx) => appMeta(ctx).actions.map((a) => a.name), params)).not.toContain('edge.todo');
    }
    expect(
      await run(async (ctx) => appMeta(ctx).actions.map((a) => a.name), person('edge_manager', [newId()])),
    ).toContain('edge.todo');
  });
});
