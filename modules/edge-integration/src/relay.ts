import { StateError, repo, newRelaySecret, relayHash, touchRelayPresence, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import { EdgeJob, EdgeDevice, EdgeDeviceEvent } from './entities.ts';
import { edgeWrite } from './internal.ts';
import { relayWork, sweepGateway, pendingStates, liveDevice, saveJob } from './common.ts';
import type { edgeLease, edgeCompleteInput, edgeEventInput} from './contract.ts';
import { EDGE_LEASE_SECONDS, EDGE_POLL_MS, type EdgeClaimedJob } from './contract.ts';
const leaseUntil = (ctx: Context, expiry: Date) => new Date(Math.min(expiry.getTime(), ctx.now().getTime() + EDGE_LEASE_SECONDS * 1000));
export async function claimJob(ctx: Context) {
  return relayWork(ctx, async () => {
    await touchRelayPresence(ctx); await sweepGateway(ctx, ctx.actor.id);
    const jobs = (await repo(ctx, EdgeJob).list({ where: { gatewayId: ctx.actor.id, state: { $in: pendingStates } }, limit: 500, orderBy: [{ field: 'createdAt', dir: 'asc' }, { field: 'id', dir: 'asc' }] })).items;
    const busy = new Set(jobs.filter((j) => j.state !== 'queued').map((j) => j.deviceId));
    const devices = new Map((await repo(ctx, EdgeDevice).list({ where: { gatewayId: ctx.actor.id, active: true }, limit: 100 })).items.map((d) => [d.id, d]));
    let selected: (typeof jobs)[number] | undefined;
    for (const candidate of jobs) {
      if (candidate.state !== 'queued' || busy.has(candidate.deviceId) || !devices.has(candidate.deviceId)) continue;
      // A late uncertainty report can increase pending counts after enqueue: never infer safety from a page limit.
      if (await repo(ctx, EdgeJob).count({ deviceId: candidate.deviceId, state: { $in: ['claimed', 'executing', 'uncertain'] } })) { busy.add(candidate.deviceId); continue; }
      selected = candidate; break;
    }
    let job: EdgeClaimedJob | null = null;
    if (selected) {
      const token = newRelaySecret(), until = leaseUntil(ctx, selected.expiresAt), device = devices.get(selected.deviceId);
      if (!device || !selected.request) throw new StateError('Invalid device job binding', 'Review the device configuration.');
      const claimed = await saveJob(ctx, selected, { state: 'claimed', attempt: selected.attempt + 1, leaseHash: relayHash(token), leaseUntil: until, reason: null });
      job = { id: claimed.id, deviceId: device.id, localDeviceId: device.localDeviceId, driver: device.driver, request: selected.request, payloadHash: claimed.payloadHash, leaseToken: token, attempt: claimed.attempt, leaseUntil: until.toISOString(), expiresAt: claimed.expiresAt.toISOString() };
    }
    return { job, serverTime: ctx.now().toISOString(), pollAfterMs: EDGE_POLL_MS };
  });
}
async function leasedJob(ctx: Context, input: z.infer<typeof edgeLease>) {
  const job = await repo(ctx, EdgeJob).get(input.jobId);
  if (job.attempt !== input.attempt || job.leaseHash !== relayHash(input.leaseToken)) throw new StateError('The claim has been superseded', 'Do not execute or retry this physical operation.');
  return job;
}
export async function startJob(ctx: Context, input: z.infer<typeof edgeLease>) {
  return relayWork(ctx, async () => {
    await sweepGateway(ctx, ctx.actor.id); let job = await leasedJob(ctx, input); let startGranted = false;
    if (job.state === 'claimed' && job.leaseUntil && job.leaseUntil > ctx.now() && job.expiresAt > ctx.now()) {
      await liveDevice(ctx, job.deviceId);
      job = await saveJob(ctx, job, { state: 'executing', startedAt: ctx.now(), leaseUntil: leaseUntil(ctx, job.expiresAt) }); startGranted = true;
    }
    return { startGranted, state: job.state, leaseUntil: job.leaseUntil?.toISOString() ?? null, serverTime: ctx.now().toISOString() };
  });
}
export async function heartbeatJob(ctx: Context, input: z.infer<typeof edgeLease>) {
  return relayWork(ctx, async () => {
    await touchRelayPresence(ctx); await sweepGateway(ctx, ctx.actor.id); let job = await leasedJob(ctx, input); const accepted = job.state === 'executing';
    if (accepted) job = await saveJob(ctx, job, { leaseUntil: leaseUntil(ctx, job.expiresAt) });
    return { accepted, state: job.state, leaseUntil: job.leaseUntil?.toISOString() ?? null, serverTime: ctx.now().toISOString() };
  });
}
export async function completeJob(ctx: Context, input: z.infer<typeof edgeCompleteInput>) {
  return relayWork(ctx, async () => {
    const job = await repo(ctx, EdgeJob).get(input.jobId);
    if (job.attempt !== input.attempt || job.leaseHash !== relayHash(input.leaseToken)) return { accepted: false, state: job.state, version: job.version, ignored: 'obsolete_attempt' as const };
    if (job.resolvedAt) return { accepted: false, state: job.state, version: job.version, ignored: 'manually_resolved' as const };
    if (job.state === 'succeeded' || job.state === 'failed') {
      const accepted = job.result?.state === input.result.state && job.result.code === input.result.code && job.result.deviceJobId === input.result.deviceJobId && job.result.summary === input.result.summary;
      return { accepted, state: job.state, version: job.version };
    }
    // A persisted starting journal may outlive an unreceived start request. Stop the device conservatively.
    const unknownBeforeStart = ['claimed', 'queued', 'expired'].includes(job.state) && input.result.state === 'uncertain';
    if (!unknownBeforeStart && !['executing', 'uncertain'].includes(job.state)) throw new StateError('The job cannot accept this outcome', 'Do not retry the physical operation; review its current state.');
    if (input.result.state !== 'uncertain' && !job.startedAt) throw new StateError('No execution start was granted', 'Only a physical operator can resolve this uncertain pre-start outcome.');
    const changed = await saveJob(ctx, job, { state: input.result.state, result: input.result, reason: input.result.summary ?? input.result.code });
    return { accepted: true, state: changed.state, version: changed.version };
  });
}
export async function recordDeviceEvent(ctx: Context, input: z.infer<typeof edgeEventInput>) {
  return relayWork(ctx, async () => {
    const device = await liveDevice(ctx, input.deviceId, false);
    if (device.localDeviceId !== input.localDeviceId) throw new StateError('Device binding mismatch', 'Use the paired local device mapping.');
    const observedAt = new Date(input.observedAt);
    if (observedAt.getTime() > ctx.now().getTime() + 300000) throw new StateError('Observation time is outside the accepted window', 'Synchronize the relay clock.');
    if (observedAt.getTime() < ctx.now().getTime() - 7 * 86400000) return { ok: true as const, duplicate: false, ignored: 'expired' as const };
    const key = ctx.actor.id + ':' + input.eventId, bodyHash = relayHash(JSON.stringify({ ...input, observedAt: observedAt.toISOString() }));
    const [prior] = (await repo(ctx, EdgeDeviceEvent).list({ where: { gatewayId: ctx.actor.id, eventId: input.eventId }, limit: 1 })).items;
    if (prior) { if (prior.bodyHash !== bodyHash) throw new StateError('Event identity was reused with different content', 'Preserve event UUID and content while retrying.'); return { ok: true as const, duplicate: true }; }
    await touchRelayPresence(ctx);
    await edgeWrite(ctx, EdgeDeviceEvent, (inner) => repo(inner, EdgeDeviceEvent).create({ ...input, observedAt, gatewayId: ctx.actor.id, key, bodyHash, receivedAt: ctx.now() }));
    return { ok: true as const, duplicate: false };
  });
}
export async function notificationPending(ctx: Context) { return relayWork(ctx, async () => { await touchRelayPresence(ctx); return (await repo(ctx, EdgeJob).count({ gatewayId: ctx.actor.id, state: { $in: ['queued', 'claimed', 'executing'] } })) > 0; }); }
