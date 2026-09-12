import { repo, relayPresence, withRelayLock, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import { EdgeGateway, EdgeDevice, EdgeJob, EdgeDeviceEvent } from './entities.ts';
import type { edgeBoardInput} from './contract.ts';
import { edgeBoardOutput } from './contract.ts';
import { saveJob } from './common.ts';
export async function edgeBoard(ctx: Context, input: z.infer<typeof edgeBoardInput>) {
  const filter = input.gatewayId ? { gatewayId: input.gatewayId } : {};
  const overdue = await repo(ctx, EdgeJob).list({ where: { ...filter, state: 'executing', $or: [{ leaseUntil: { $lte: ctx.now().toISOString() } }, { expiresAt: { $lte: ctx.now().toISOString() } }] }, limit: 200 });
  for (const candidate of overdue.items) await withRelayLock(ctx, candidate.gatewayId, async () => {
    const job = await repo(ctx, EdgeJob).get(candidate.id);
    if (job.state === 'executing' && ((job.leaseUntil && job.leaseUntil <= ctx.now()) || job.expiresAt <= ctx.now())) await saveJob(ctx, job, { state: 'uncertain', reason: 'Gateway offline or execution lease expired; confirm the physical outcome.' });
  });
  const gateways = await repo(ctx, EdgeGateway).list({ limit: 200, orderBy: [{ field: 'code', dir: 'asc' }] });
  const devices = await repo(ctx, EdgeDevice).list({ where: filter, limit: 200, orderBy: [{ field: 'name', dir: 'asc' }] });
  const jobs = await repo(ctx, EdgeJob).list({ where: filter, limit: 200, orderBy: [{ field: 'createdAt', dir: 'desc' }, { field: 'id', dir: 'desc' }] });
  const events = await repo(ctx, EdgeDeviceEvent).list({ where: filter, limit: 100, orderBy: [{ field: 'receivedAt', dir: 'desc' }] });
  const presence = new Map((await relayPresence(ctx, EdgeGateway.name)).map((r) => [r.gatewayId, r]));
  return edgeBoardOutput.parse({ gateways: gateways.items.map((g) => ({ ...g, paired: presence.has(g.id), lastSeenAt: presence.get(g.id)?.lastSeenAt?.toISOString() ?? null, credentialExpiresAt: presence.get(g.id)?.expiresAt.toISOString() ?? null })), devices: devices.items,
    jobs: jobs.items.map((j) => ({ ...j, createdAt: j.createdAt.toISOString(), expiresAt: j.expiresAt.toISOString(), resolvedAt: j.resolvedAt?.toISOString() ?? null })),
    events: events.items.map((e) => ({ id: e.id, gatewayId: e.gatewayId, eventId: e.eventId, deviceId: e.deviceId, localDeviceId: e.localDeviceId, status: e.status, code: e.code, observedAt: e.observedAt.toISOString(), receivedAt: e.receivedAt.toISOString() })), serverTime: ctx.now().toISOString(), truncated: [gateways, devices, jobs, events, overdue].some((r) => r.total > r.items.length) });
}
