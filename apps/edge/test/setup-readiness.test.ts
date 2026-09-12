import { afterEach, expect, it, vi } from 'vitest';
import { jsonFile } from '../setup/io.ts';
import { awaitService } from '../setup/readiness.ts';
import type { ServiceAdapter, ServiceContext } from '../setup/types.ts';
vi.mock('../setup/io.ts', () => ({ jsonFile: vi.fn() }));
const context: ServiceContext = { platform: 'linux', installationId: 'd031f4cf-3a22-4fb0-8879-51be1f5bcc65', installRoot: '/opt/edge', statePath: '/var/lib/edge', releaseDir: '/opt/edge/releases/one', nodePath: '/opt/edge/releases/one/node', appPath: '/opt/edge/releases/one/edge.mjs', configPath: '/var/lib/edge/config.json', logPath: '/var/lib/edge/logs', servicePath: '/opt/edge/service' };
function adapter(): ServiceAdapter {
  const empty = async () => undefined;
  return { platform: 'linux', serviceId: 'daifuku-edge', defaults: () => ({ installRoot: context.installRoot, statePath: context.statePath }), assertAdministrator: empty, prepare: empty, protect: empty, register: empty, start: empty, stop: empty, uninstall: empty, inspect: vi.fn(async () => ({ serviceExists: true, serviceRunning: true, serviceOwned: true, processId: 42, conflicts: [] })) };
}
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
it('waits for the current process heartbeat instead of accepting a recently stopped process', async () => {
  vi.useFakeTimers(); const now = Date.now();
  vi.mocked(jsonFile).mockResolvedValueOnce({ pid: 41, observedAt: new Date(now).toISOString(), phase: 'running' }).mockResolvedValue({ pid: 42, observedAt: new Date(now).toISOString(), phase: 'pairing_required' });
  let settled = false; const pending = awaitService(context, adapter(), now).then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1000); await pending; expect(settled).toBe(true);
});
it.each(['future', 'stopped', 'error'])('does not declare installation ready for a %s heartbeat', async (kind) => {
  vi.useFakeTimers(); const now = Date.now();
  vi.mocked(jsonFile).mockResolvedValue({ pid: 42, observedAt: new Date(now + (kind === 'future' ? 120000 : 0)).toISOString(), phase: kind === 'future' ? 'running' : kind });
  const rejected = expect(awaitService(context, adapter(), now)).rejects.toThrow('service_runtime_start_not_confirmed_resume_required');
  await vi.advanceTimersByTimeAsync(61000); await rejected;
});
it('refuses a live matching heartbeat when native service ownership cannot be established', async () => {
  const host = adapter(); vi.mocked(host.inspect).mockResolvedValue({ serviceExists: true, serviceRunning: true, serviceOwned: false, processId: 42, conflicts: ['untrusted definition'] });
  vi.mocked(jsonFile).mockResolvedValue({ pid: 42, observedAt: new Date().toISOString(), phase: 'running' });
  await expect(awaitService(context, host, Date.now())).rejects.toThrow('service_registration_conflict');
});
