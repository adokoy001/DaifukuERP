import { Conflict, PermissionDenied, StateError, assertRelayCredential, repo, withRelayLock, type Context } from '@daifuku/kernel';
import { EdgeGateway, EdgeDevice, EdgeJob, type Job } from './entities.ts';
import { edgeWrite } from './internal.ts';
export const pendingStates = ['queued', 'claimed', 'executing', 'uncertain'];
export const jobResult = (job: Job) => ({ id: job.id, version: job.version, state: job.state });
export function expected(actual: number, wanted: number) { if (actual !== wanted) throw new Conflict('Device record changed concurrently', 'Reload the device board before retrying.'); }
export async function liveGateway(ctx: Context, gatewayId: string, siteId?: string, active = true) {
  const gateway = await repo(ctx, EdgeGateway).get(gatewayId);
  if ((active && !gateway.active) || (siteId && gateway.siteId !== siteId)) throw new StateError('Gateway is disabled or its site binding changed', 'Ask an operator to review this gateway.');
  return gateway;
}
export async function relayWork<T>(ctx: Context, work: () => Promise<T>): Promise<T> {
  if (ctx.actor.type !== 'relay' || !ctx.relay) throw new PermissionDenied('relay', 'operate', ctx.roles);
  const binding = ctx.relay;
  return withRelayLock(ctx, ctx.actor.id, async () => { await assertRelayCredential(ctx); await liveGateway(ctx, ctx.actor.id, binding.siteId); return work(); });
}
export async function liveDevice(ctx: Context, deviceId: string, active = true) {
  const device = await repo(ctx, EdgeDevice).get(deviceId);
  await liveGateway(ctx, device.gatewayId);
  if (active && !device.active) throw new StateError('Device is disabled', 'Enable the intended device before submitting work.'); return device;
}
export async function saveJob(ctx: Context, job: Job, patch: Parameters<ReturnType<typeof repo<typeof EdgeJob>>['update']>[1]) {
  return edgeWrite(ctx, EdgeJob, (inner) => repo(inner, EdgeJob).update(job.id, patch, { expectedVersion: job.version }));
}
/** Sweep only bounded unfinished rows. Started operations never re-enter the queue. */
export async function sweepGateway(ctx: Context, gatewayId: string) {
  const rows = await repo(ctx, EdgeJob).list({ where: { gatewayId, state: { $in: pendingStates } }, limit: 500, orderBy: [{ field: 'createdAt', dir: 'asc' }] });
  for (const job of rows.items) {
    if (job.state === 'uncertain') continue;
    if (job.state === 'executing' && ((job.leaseUntil && job.leaseUntil <= ctx.now()) || job.expiresAt <= ctx.now())) await saveJob(ctx, job, { state: 'uncertain', reason: 'Execution acknowledgement or lease expired; physical outcome requires confirmation.' });
    else if (job.expiresAt <= ctx.now()) await saveJob(ctx, job, { state: 'expired', reason: 'Expired before execution.' });
    else if (job.state === 'claimed' && job.leaseUntil && job.leaseUntil <= ctx.now()) await saveJob(ctx, job, { state: 'queued', leaseUntil: null, reason: 'Unstarted claim expired.' });
  }
}
