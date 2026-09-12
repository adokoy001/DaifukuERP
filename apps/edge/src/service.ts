import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Credentials } from './credentials.ts';
import type { Journal } from './journal.ts';
import { EdgeAgent } from './agent.ts';
import { EdgeError, errorCode } from './errors.ts';
import { syncJson } from './files.ts';
import { macAccountGroups, nativeDirectoryRunner, sameMacGroups } from './macos-membership.ts';
import { currentServiceIdentity, unprivilegedServiceIdentity } from './service-identity.ts';
import { connectService } from './pairing-inbox.ts';
export const SERVICE_RETRY_MS = 30000;
type Phase = 'pairing_required' | 'connecting' | 'running' | 'credential_rejected' | 'stopped' | 'error';
class ServiceStatus {
  private phase: Phase = 'connecting';
  private identityVerified = false;
  private queue = Promise.resolve();
  constructor(private readonly path: string) {}
  verifyIdentity(value: boolean): Promise<void> { this.identityVerified = value; return this.refresh(); }
  set(phase: Phase): Promise<void> { this.phase = phase; return this.refresh(); }
  refresh(): Promise<void> { this.queue = this.queue.then(() => syncJson(this.path, { pid: process.pid, phase: this.phase, observedAt: new Date().toISOString(), unprivilegedIdentityVerified: this.identityVerified, unprivilegedIdentityRequired: process.env.DAIFUKU_EDGE_REQUIRE_UNPRIVILEGED_IDENTITY === '1', identity: currentServiceIdentity() })); return this.queue; }
}
async function verifyUnprivilegedIdentity(): Promise<boolean> {
  if (process.env.DAIFUKU_EDGE_REQUIRE_UNPRIVILEGED_IDENTITY !== '1') return false;
  const identity = currentServiceIdentity();
  if (!unprivilegedServiceIdentity(identity) || !sameMacGroups(identity.groups, await macAccountGroups(nativeDirectoryRunner))) throw new EdgeError('service_identity_not_unprivileged');
  return true;
}
export async function runService(credentials: Credentials, journal: Journal, directory: string, signal: AbortSignal, log: (code: string) => void): Promise<void> {
  const status = new ServiceStatus(join(directory, 'service-status.json')), local = new AbortController();
  const stop = () => local.abort(); signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
  let statusFailed = false;
  await status.set('connecting');
  const timer = setInterval(() => { void status.refresh().catch(() => { statusFailed = true; local.abort(); }); }, SERVICE_RETRY_MS);
  try {
    while (!local.signal.aborted) {
      try {
        await status.verifyIdentity(false); await status.verifyIdentity(await verifyUnprivilegedIdentity());
        const phase = await connectService(credentials, directory); await status.set(phase); log(phase);
        if (phase === 'running') await new EdgeAgent(credentials, journal, log).run(local.signal);
      } catch (error) {
        if (statusFailed) throw new EdgeError('service_status_write_failed');
        const code = errorCode(error); log(code); await status.set(code === 'credential_rejected' ? 'credential_rejected' : 'error');
      }
      if (!local.signal.aborted) await delay(SERVICE_RETRY_MS, undefined, { signal: local.signal }).catch(() => undefined);
    }
    if (statusFailed) throw new EdgeError('service_status_write_failed');
  } finally { clearInterval(timer); signal.removeEventListener('abort', stop); await status.set('stopped'); }
}
