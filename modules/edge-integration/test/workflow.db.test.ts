import assert from 'node:assert/strict';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import {
  repo,
  runAction,
  registerCrudActions,
  newId,
  relayCredentials,
  newRelaySecret,
  relayHash,
  defineAction,
  label,
  type Context,
  type ContextParams,
} from '@daifuku/kernel';
import { z } from 'zod';
import { WorkforceSite, WorkforceEmployee } from '@daifuku/mod-workforce';
import {
  EdgeGateway,
  EdgeDevice,
  EdgeJob,
  EdgeDeviceEvent,
  claimJob,
  startJob,
  completeJob,
  heartbeatJob,
  recordDeviceEvent,
  type EdgeClaimedJob,
} from '../src/index.ts';
let db: TestDb;
let clock = new Date();
const run = <T>(fn: (ctx: Context) => Promise<T>, extra: Partial<ContextParams> = {}) =>
  db.run({ now: () => clock, ...extra }, fn);
const action = <T = { id: string; version: number; state: string }>(name: string, input: unknown) =>
  run((ctx) => runAction(ctx, name, input)) as Promise<T>;
async function fixture(driver: 'simulator' | 'ipp_text' = 'simulator') {
  const site = await run((ctx) => repo(ctx, WorkforceSite).create({ code: newId(), name: 'Site' }));
  const gateway = await action('edge.create_gateway', { siteId: site.id, code: newId(), name: 'LAN gateway' });
  const device = await action('edge.register_device', {
    gatewayId: gateway.id,
    localDeviceId: 'printer',
    name: 'Printer',
    driver,
  });
  const secret = newRelaySecret(),
    credentialId = newId();
  await db.owner.drizzle.insert(relayCredentials).values({
    id: credentialId,
    tenantId: db.tenantId,
    companyId: db.companyId,
    gatewayId: gateway.id,
    siteId: site.id,
    secretHash: relayHash(secret),
    credentialVersion: 1,
    expiresAt: new Date(clock.getTime() + 86400000),
  });
  const params: Partial<ContextParams> = {
    actor: { type: 'relay', id: gateway.id },
    roles: ['relay'],
    relay: { credentialId, credentialVersion: 1, gatewayId: gateway.id, siteId: site.id },
  };
  const machine = <T>(fn: (ctx: Context) => Promise<T>) => run(fn, params);
  const queue = () =>
    action('edge.enqueue', {
      deviceId: device.id,
      idempotencyKey: newId(),
      request: { kind: 'print.text', payload: { text: 'Synthetic receipt', title: 'Test', copies: 1 } },
      expiresAt: new Date(clock.getTime() + 3600000).toISOString(),
    });
  return { site, gateway, device, params, machine, queue, secret };
}
const lease = (job: EdgeClaimedJob) => ({ jobId: job.id, attempt: job.attempt, leaseToken: job.leaseToken });
const getClaim = async (f: Awaited<ReturnType<typeof fixture>>) => {
  const response = await f.machine(claimJob);
  assert(response.job);
  return response.job;
};
beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});
describe('edge device execution safety', () => {
  it('serializes concurrent claims and grants each start exactly once', async () => {
    const f = await fixture();
    await f.queue();
    await f.queue();
    const claims = await Promise.all([f.machine(claimJob), f.machine(claimJob)]);
    expect(claims.filter((c) => c.job)).toHaveLength(1);
    const job = claims.find((c) => c.job)?.job;
    assert(job);
    const starts = await Promise.all([
      f.machine((ctx) => startJob(ctx, lease(job))),
      f.machine((ctx) => startJob(ctx, lease(job))),
    ]);
    expect(starts.filter((s) => s.startGranted)).toHaveLength(1);
    expect((await f.machine(claimJob)).job).toBeNull();
    const result = { state: 'succeeded' as const, code: 'printed', deviceJobId: '33' };
    const done = await f.machine((ctx) => completeJob(ctx, { ...lease(job), result }));
    expect(done).toMatchObject({ accepted: true, state: 'succeeded' });
    expect(await f.machine((ctx) => completeJob(ctx, { ...lease(job), result }))).toEqual(done);
    expect((await getClaim(f)).id).not.toBe(job.id);
  });
  it('reclaims only unstarted leases and rejects an older fencing attempt', async () => {
    const f = await fixture();
    await f.queue();
    const first = await getClaim(f);
    clock = new Date(clock.getTime() + 91000);
    const second = await getClaim(f);
    expect(second.id).toBe(first.id);
    expect(second.attempt).toBe(first.attempt + 1);
    await expect(f.machine((ctx) => startJob(ctx, lease(first)))).rejects.toThrow('superseded');
    expect(
      await f.machine((ctx) => completeJob(ctx, { ...lease(first), result: { state: 'uncertain', code: 'restart' } })),
    ).toMatchObject({ accepted: false, ignored: 'obsolete_attempt', state: 'claimed' });
    expect((await f.machine((ctx) => startJob(ctx, lease(second)))).startGranted).toBe(true);
  });
  it('moves offline executing jobs to uncertain from the board and blocks later work', async () => {
    const f = await fixture();
    await f.queue();
    await f.queue();
    const job = await getClaim(f);
    await f.machine((ctx) => startJob(ctx, lease(job)));
    clock = new Date(clock.getTime() + 91000);
    const board = await action<{ jobs: { id: string; state: string }[] }>('edge.board', { gatewayId: f.gateway.id });
    expect(board.jobs.find((j) => j.id === job.id)?.state).toBe('uncertain');
    expect((await f.machine(claimJob)).job).toBeNull();
    expect((await f.machine((ctx) => heartbeatJob(ctx, lease(job)))).accepted).toBe(false);
    expect(
      (
        await f.machine((ctx) =>
          completeJob(ctx, { ...lease(job), result: { state: 'succeeded', code: 'ipp_completed', deviceJobId: '33' } }),
        )
      ).accepted,
    ).toBe(true);
    expect((await getClaim(f)).id).not.toBe(job.id);
  });
  it('accepts uncertain from a starting journal without granting I/O and protects manual resolution', async () => {
    const f = await fixture();
    await f.queue();
    const job = await getClaim(f);
    const unknown = await f.machine((ctx) =>
      completeJob(ctx, { ...lease(job), result: { state: 'uncertain', code: 'lost_start_response' } }),
    );
    expect(unknown.state).toBe('uncertain');
    expect((await f.machine((ctx) => startJob(ctx, lease(job)))).startGranted).toBe(false);
    const resolved = await action('edge.resolve', {
      jobId: job.id,
      expectedVersion: unknown.version,
      reason: 'Checked the printer',
      evidence: 'No physical output, operation cancelled by operator',
      resolution: 'failed',
    });
    expect(
      await f.machine((ctx) => completeJob(ctx, { ...lease(job), result: { state: 'succeeded', code: 'late' } })),
    ).toMatchObject({ accepted: false, ignored: 'manually_resolved', state: 'failed', version: resolved.version });
    await expect(
      action('edge.resolve', {
        jobId: job.id,
        expectedVersion: unknown.version,
        reason: 'Again',
        evidence: 'Again',
        resolution: 'succeeded',
      }),
    ).rejects.toThrow();
  });
  it('deduplicates observations but rejects UUID retargeting and another gateway', async () => {
    const f = await fixture(),
      other = await fixture();
    const input = {
      eventId: newId(),
      deviceId: f.device.id,
      localDeviceId: 'printer',
      observedAt: clock.toISOString(),
      status: 'online' as const,
      code: 'ready',
    };
    const results = await Promise.all([
      f.machine((ctx) => recordDeviceEvent(ctx, input)),
      f.machine((ctx) => recordDeviceEvent(ctx, input)),
    ]);
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    await expect(f.machine((ctx) => recordDeviceEvent(ctx, { ...input, code: 'different' }))).rejects.toThrow(
      'different content',
    );
    await expect(other.machine((ctx) => recordDeviceEvent(ctx, input))).rejects.toThrow();
    expect(await f.machine((ctx) => repo(ctx, EdgeDeviceEvent).count())).toBe(1);
    const board = await action<{ events: { code: string }[] }>('edge.board', { gatewayId: f.gateway.id });
    expect(board.events).toMatchObject([{ code: 'ready' }]);
    const expired = { ...input, eventId: newId(), observedAt: new Date(clock.getTime() - 8 * 86400000).toISOString() };
    expect(await f.machine((ctx) => recordDeviceEvent(ctx, expired))).toEqual({
      ok: true,
      duplicate: false,
      ignored: 'expired',
    });
    await expect(other.machine((ctx) => recordDeviceEvent(ctx, expired))).rejects.toThrow();
    expect(await f.machine((ctx) => repo(ctx, EdgeDeviceEvent).count())).toBe(1);
  });
  it('checks cash driver, payload limits, idempotency and generic mutations', async () => {
    const f = await fixture('ipp_text');
    await expect(
      action('edge.enqueue', {
        deviceId: f.device.id,
        idempotencyKey: newId(),
        request: { kind: 'cash.dispense', payload: { amount: '1000', currency: 'JPY' } },
        expiresAt: new Date(clock.getTime() + 60000).toISOString(),
      }),
    ).rejects.toThrow('simulator');
    const queued = await f.queue();
    await expect(run((ctx) => repo(ctx, EdgeJob).update(queued.id, { state: 'succeeded' }))).rejects.toThrow();
    await expect(run((ctx) => repo(ctx, EdgeGateway).update(f.gateway.id, { siteId: newId() }))).rejects.toThrow();
    await expect(run((ctx) => repo(ctx, EdgeDevice).delete(f.device.id))).rejects.toThrow();
    const cancelled = await action('edge.cancel', {
      jobId: queued.id,
      expectedVersion: queued.version,
      reason: 'Not needed',
    });
    expect(cancelled.state).toBe('cancelled');
    expect((await f.machine(claimJob)).job).toBeNull();
  });
  it('denies machine role-union/sharedRead/authenticated holes and scopes site-only staff', async () => {
    const f = await fixture(),
      other = await fixture();
    await expect(f.machine((ctx) => repo(ctx, WorkforceSite).list())).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(
      run((ctx) => repo(ctx, WorkforceEmployee).list(), { ...f.params, roles: ['relay', 'admin'] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect((await f.machine((ctx) => repo(ctx, EdgeGateway).list())).items.map((g) => g.id)).toEqual([f.gateway.id]);
    const auth = defineAction({
      name: 'edge_test.authenticated',
      description: label('Test', 'Test'),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      permission: 'authenticated',
      handler: async () => ({ ok: true }),
    });
    await expect(f.machine((ctx) => runAction(ctx, auth.name, {}))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    const staff = { roles: ['edge_manager'], accessScope: 'sites' as const, siteIds: [f.site.id] };
    expect((await run((ctx) => repo(ctx, WorkforceSite).list(), staff)).items.map((s) => s.id)).toEqual([f.site.id]);
    await expect(run((ctx) => repo(ctx, WorkforceEmployee).list(), staff)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(run((ctx) => repo(ctx, EdgeGateway).get(other.gateway.id), staff)).rejects.toThrow();
    await expect(
      run((ctx) => repo(ctx, EdgeGateway).list(), {
        roles: ['edge_manager'],
        accessScope: 'stores',
        storeIds: [f.site.id],
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('serializes site disabling with active gateways and preserves configuration version during polling', async () => {
    const f = await fixture();
    await expect(run((ctx) => repo(ctx, WorkforceSite).update(f.site.id, { active: false }))).rejects.toThrow(
      'active LAN gateways',
    );
    await f.machine(claimJob);
    await f.machine(claimJob);
    expect((await run((ctx) => repo(ctx, EdgeGateway).get(f.gateway.id))).version).toBe(f.gateway.version);
    await action('edge.set_gateway_active', {
      gatewayId: f.gateway.id,
      expectedVersion: f.gateway.version,
      active: false,
      reason: 'Maintenance',
    });
    await expect(f.machine(claimJob)).rejects.toThrow('disabled');
    await run((ctx) => repo(ctx, WorkforceSite).update(f.site.id, { active: false }));
  });
});
