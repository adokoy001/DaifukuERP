import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import {
  EDGE_HEARTBEAT_MS,
  edgePayloadText,
  type EdgeClaimedJob,
  type EdgeLease,
  type EdgeResult,
} from '@daifuku/mod-edge-integration/contract';
import { deviceBindingHash, type EdgeConfig } from './config.ts';
import type { RelayClient } from './client.ts';
import { executeDevice, localDevice } from './drivers/index.ts';
import { EdgeError } from './errors.ts';
import type { Journal, JournalRecord } from './journal.ts';
export const leaseOf = (row: JournalRecord): EdgeLease => ({
  jobId: row.jobId,
  leaseToken: row.leaseToken,
  attempt: row.attempt,
});
function integrity(job: EdgeClaimedJob, config: EdgeConfig): void {
  localDevice(config, job);
  if (createHash('sha256').update(edgePayloadText(job.request)).digest('hex') !== job.payloadHash)
    throw new EdgeError('job_hash_mismatch');
}
async function leaseHeartbeat(
  client: RelayClient,
  lease: EdgeLease,
  controller: AbortController,
  update: (until: number) => void,
): Promise<void> {
  while (!controller.signal.aborted) {
    await delay(EDGE_HEARTBEAT_MS, undefined, { signal: controller.signal }).catch(() => undefined);
    if (controller.signal.aborted) return;
    try {
      const result = await client.heartbeat(lease);
      if (!result.accepted || !result.leaseUntil) controller.abort();
      else update(performance.now() + Date.parse(result.leaseUntil) - Date.parse(result.serverTime));
    } catch {
      controller.abort();
    }
  }
}
export async function performJob(
  client: RelayClient,
  journal: Journal,
  job: EdgeClaimedJob,
  signal: AbortSignal,
): Promise<JournalRecord> {
  const record = await journal.begin(job, deviceBindingHash(client.config, job.deviceId)),
    lease = leaseOf(record);
  try {
    integrity(job, client.config);
  } catch {
    return journal.update(job.id, { result: { state: 'uncertain', code: 'local_job_validation_failed' } });
  }
  let start: Awaited<ReturnType<RelayClient['start']>>;
  try {
    start = await client.start(lease);
  } catch {
    return journal.update(job.id, { result: { state: 'uncertain', code: 'start_response_unknown' } });
  }
  if (!start.startGranted || !start.leaseUntil)
    return journal.update(job.id, { result: { state: 'uncertain', code: 'start_permission_not_granted' } });
  await journal.update(job.id, { phase: 'executing' });
  const controller = new AbortController(),
    stop = () => controller.abort();
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  let deadline = performance.now() + Date.parse(start.leaseUntil) - Date.parse(start.serverTime);
  const expiry = performance.now() + Date.parse(job.expiresAt) - Date.parse(start.serverTime);
  const heartbeat = leaseHeartbeat(client, lease, controller, (until) => {
    deadline = until;
  });
  let result: EdgeResult;
  try {
    result = await executeDevice(client.config, job, {
      signal: controller.signal,
      canSend: () => !controller.signal.aborted && performance.now() < Math.min(deadline, expiry),
      accepted: async (reference) => {
        await journal.update(job.id, { phase: 'accepted', deviceJobId: reference });
      },
    });
  } catch {
    result = { state: 'uncertain', code: 'device_response_unknown' };
  } finally {
    controller.abort();
    signal.removeEventListener('abort', stop);
    await heartbeat;
  }
  const reference = journal.records().find((row) => row.jobId === job.id)?.deviceJobId;
  return journal.update(job.id, {
    result: reference && !result.deviceJobId ? { ...result, deviceJobId: reference } : result,
  });
}
