import { StateError, repo, relayHash, withRelayLock, type Context } from '@daifuku/kernel';
import { WorkforceSite } from '@daifuku/mod-workforce';
import type { z } from 'zod';
import type { createEdgeGatewayInput, registerEdgeDeviceInput, enqueueEdgeJobInput, edgeJobCommand, resolveEdgeJobInput, setEdgeGatewayActiveInput, setEdgeDeviceActiveInput} from './contract.ts';
import { edgePayloadText } from './contract.ts';
import { EdgeGateway, EdgeDevice, EdgeJob } from './entities.ts';
import { edgeWrite } from './internal.ts';
import { expected, liveGateway, liveDevice, pendingStates, jobResult, saveJob, sweepGateway } from './common.ts';
export async function createGateway(ctx: Context, i: z.infer<typeof createEdgeGatewayInput>) {
  return withRelayLock(ctx, 'site:' + i.siteId, async () => {
    const site = await repo(ctx, WorkforceSite).get(i.siteId); if (!site.active) throw new StateError('Site is disabled', 'Choose an active site.');
    if (await repo(ctx, EdgeGateway).count() >= 200) throw new StateError('Gateway limit reached', 'A company supports at most 200 gateways.');
    return edgeWrite(ctx, EdgeGateway, (inner) => repo(inner, EdgeGateway).create(i));
  });
}
export async function registerDevice(ctx: Context, i: z.infer<typeof registerEdgeDeviceInput>) {
  return withRelayLock(ctx, i.gatewayId, async () => { await liveGateway(ctx, i.gatewayId);
    if (await repo(ctx, EdgeDevice).count({ gatewayId: i.gatewayId }) >= 100) throw new StateError('Device limit reached', 'A gateway supports at most 100 devices.');
    return edgeWrite(ctx, EdgeDevice, (inner) => repo(inner, EdgeDevice).create({ ...i, key: i.gatewayId + ':' + i.localDeviceId })); });
}
export async function enqueueJob(ctx: Context, i: z.infer<typeof enqueueEdgeJobInput>) {
  const target = await repo(ctx, EdgeDevice).get(i.deviceId);
  return withRelayLock(ctx, target.gatewayId, async () => {
    const device = await liveDevice(ctx, i.deviceId), request = i.request, hash = relayHash(edgePayloadText(request));
    const [prior] = (await repo(ctx, EdgeJob).list({ where: { idempotencyKey: i.idempotencyKey }, limit: 1 })).items;
    if (prior) { if (prior.deviceId !== device.id || prior.payloadHash !== hash || prior.expiresAt.toISOString() !== new Date(i.expiresAt).toISOString()) throw new StateError('Idempotency key was used with different input', 'Reuse the original request or choose a new operation.'); return jobResult(prior); }
    const expiresAt = new Date(i.expiresAt);
    if (expiresAt <= ctx.now() || expiresAt.getTime() > ctx.now().getTime() + 86400000) throw new StateError('Job expiry must be within the next 24 hours', 'Choose a short operational expiry.');
    if (request.kind === 'cash.dispense' && device.driver !== 'simulator') throw new StateError('Cash operations require an explicit simulator', 'Real cash dispensing is not supported.');
    await sweepGateway(ctx, device.gatewayId);
    if (await repo(ctx, EdgeJob).count({ gatewayId: device.gatewayId, state: { $in: pendingStates } }) >= 500 || await repo(ctx, EdgeJob).count({ deviceId: device.id, state: { $in: pendingStates } }) >= 100) throw new StateError('Pending job limit reached', 'Resolve pending or uncertain work before adding more.');
    const job = await edgeWrite(ctx, EdgeJob, (inner) => repo(inner, EdgeJob).create({ gatewayId: device.gatewayId, deviceId: device.id, idempotencyKey: i.idempotencyKey, kind: request.kind, request, payloadHash: hash, expiresAt }));
    return jobResult(job);
  });
}
export async function cancelJob(ctx: Context, i: z.infer<typeof edgeJobCommand>) {
  const target = await repo(ctx, EdgeJob).get(i.jobId);
  return withRelayLock(ctx, target.gatewayId, async () => { const job = await repo(ctx, EdgeJob).get(i.jobId); expected(job.version, i.expectedVersion);
    if (job.state !== 'queued') throw new StateError('Only queued work can be cancelled', 'Started or uncertain operations require physical confirmation.');
    return jobResult(await saveJob(ctx, job, { state: 'cancelled', reason: i.reason })); });
}
export async function resolveJob(ctx: Context, i: z.infer<typeof resolveEdgeJobInput>) {
  const target = await repo(ctx, EdgeJob).get(i.jobId);
  return withRelayLock(ctx, target.gatewayId, async () => { const job = await repo(ctx, EdgeJob).get(i.jobId); expected(job.version, i.expectedVersion);
    if (job.state !== 'uncertain') throw new StateError('Only uncertain operations can be manually resolved', 'Refresh the board and inspect the physical device.');
    return jobResult(await saveJob(ctx, job, { state: i.resolution, reason: i.reason, evidence: i.evidence, resolvedAt: ctx.now() })); });
}
async function stopStarted(ctx: Context, gatewayId: string, deviceId?: string) {
  const jobs = await repo(ctx, EdgeJob).list({ where: { gatewayId, ...(deviceId ? { deviceId } : {}), state: { $in: ['executing', 'claimed'] } }, limit: 500 });
  for (const job of jobs.items) await saveJob(ctx, job, job.state === 'executing' ? { state: 'uncertain', reason: 'Device or gateway disabled during execution.' } : { state: 'queued', leaseUntil: null, reason: 'Disabled before execution.' });
}
export async function setGatewayActive(ctx: Context, i: z.infer<typeof setEdgeGatewayActiveInput>) {
  const target = await repo(ctx, EdgeGateway).get(i.gatewayId);
  return withRelayLock(ctx, 'site:' + target.siteId, () => withRelayLock(ctx, target.id, async () => {
    const gateway = await liveGateway(ctx, target.id, target.siteId, false); expected(gateway.version, i.expectedVersion);
    if (i.active && !(await repo(ctx, WorkforceSite).get(gateway.siteId)).active) throw new StateError('Site is disabled', 'Enable the site first.');
    if (!i.active) await stopStarted(ctx, gateway.id);
    return edgeWrite(ctx, EdgeGateway, (inner) => repo(inner, EdgeGateway).update(gateway.id, { active: i.active, reason: i.reason }, { expectedVersion: i.expectedVersion }));
  }));
}
export async function setDeviceActive(ctx: Context, i: z.infer<typeof setEdgeDeviceActiveInput>) {
  const target = await repo(ctx, EdgeDevice).get(i.deviceId);
  return withRelayLock(ctx, target.gatewayId, async () => { const device = await repo(ctx, EdgeDevice).get(target.id); expected(device.version, i.expectedVersion);
    if (!i.active) await stopStarted(ctx, device.gatewayId, device.id);
    return edgeWrite(ctx, EdgeDevice, (inner) => repo(inner, EdgeDevice).update(device.id, { active: i.active, reason: i.reason }, { expectedVersion: i.expectedVersion })); });
}
