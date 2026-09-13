import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { matchesMacServiceIdentity } from '../src/service-identity.ts';
import { jsonFile } from './io.ts';
import type { ServiceAdapter, ServiceContext } from './types.ts';
/** A live OS process and a matching fresh runtime heartbeat prove the private paths are usable. */
export async function awaitService(context: ServiceContext, adapter: ServiceAdapter, startedAt: number): Promise<void> {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const inspection = await adapter.inspect(context),
      raw = await jsonFile(join(context.statePath, 'service-status.json'));
    const state = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const observed = typeof state.observedAt === 'string' ? Date.parse(state.observedAt) : NaN;
    const age = Date.now() - observed;
    if (inspection.conflicts.length || !inspection.serviceOwned) throw new Error('service_registration_conflict');
    if (
      inspection.serviceRunning &&
      matchesMacServiceIdentity(context.platform, state, inspection.account) &&
      inspection.processId === state.pid &&
      observed >= startedAt &&
      age >= 0 &&
      age < 90000 &&
      ['pairing_required', 'connecting', 'running', 'credential_rejected'].includes(String(state.phase))
    )
      return;
    await delay(1000);
  }
  throw new Error('service_runtime_start_not_confirmed_resume_required');
}
