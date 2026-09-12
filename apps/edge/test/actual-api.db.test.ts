import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { edgeRoutes } from '@daifuku/mod-edge-integration/contract';
import { EdgeAgent } from '../src/agent.ts';
import { Credentials } from '../src/credentials.ts';
import { Journal } from '../src/journal.ts';
import { deviceBindingHash, parseConfig, type EdgeConfig } from '../src/config.ts';
import { notifications } from '../src/notifications.ts';
import { actualApiFixture, apiTlsProxy } from './api-fixture.ts';
import { until } from './fixtures.ts';
let api: Awaited<ReturnType<typeof actualApiFixture>>, proxy: Awaited<ReturnType<typeof apiTlsProxy>>, config: EdgeConfig, credentials: Credentials;
const signal = () => new AbortController().signal;
type Board = { jobs: { id: string; state: string; version: number; attempt: number }[]; events: { deviceId: string; code: string; observedAt: string; receivedAt: string }[] };
beforeAll(async () => { api = await actualApiFixture(); proxy = await apiTlsProxy(api.address); config = parseConfig({ apiBaseUrl: proxy.baseUrl, caFile: proxy.cert, requestTimeoutMs: 2000, devices: [{ deviceId: api.deviceId, localDeviceId: api.localDeviceId, driver: 'simulator', simulationConfirmed: true }] }); credentials = await Credentials.open(proxy.directory, config); }, 40000);
afterAll(async () => { await proxy?.close(); await api?.close(); });
describe('agent against the actual API and dedicated database through TLS', () => {
  it('recovers lost pairing/rotation responses and a committed result without duplicate execution', async () => {
    proxy.state.dropNext = edgeRoutes.pair; await expect(credentials.pair(api.pairingToken)).rejects.toThrow('transport_failed');
    credentials = await Credentials.open(proxy.directory, config); expect(await credentials.session()).toMatchObject({ gatewayId: api.gatewayId, credentialVersion: 1 });
    const old = credentials.authorization(); proxy.state.dropNext = edgeRoutes.rotate; await expect(credentials.rotate()).rejects.toThrow('transport_failed');
    credentials = await Credentials.open(proxy.directory, config); expect(await credentials.session()).toMatchObject({ credentialVersion: 2 }); await expect(credentials.client.session(old)).rejects.toThrow('credential_rejected');
    proxy.state.dropNext = edgeRoutes.complete; const first = new EdgeAgent(credentials, await Journal.open(proxy.directory)); await expect(first.tick(signal())).rejects.toThrow('transport_failed');
    const observedAt = first.journal.records().find((row) => row.jobId === api.jobId)?.updatedAt; if (!observedAt) throw new Error('Synthetic observation timestamp missing');
    const before = await api.request<Board>('board'); expect(before.jobs.find((row) => row.id === api.jobId)).toMatchObject({ state: 'succeeded', attempt: 1 });
    await new EdgeAgent(credentials, await Journal.open(proxy.directory)).tick(signal());
    const after = await api.request<Board>('board'); expect(after.jobs).toEqual(before.jobs); expect(after.events).toHaveLength(1); expect(after.events[0]).toMatchObject({ deviceId: api.deviceId, code: 'simulated_print', observedAt }); expect(proxy.state.calls.get(edgeRoutes.start)).toBe(1);
    const journal = await readFile(join(proxy.directory, 'journal.json'), 'utf8'); expect(journal).not.toContain('Synthetic end-to-end receipt'); expect(journal).not.toContain(old);
  });
  it('acknowledges an expired observation and recovers an obsolete attempt without touching the current claim', async () => {
    const journal = await Journal.open(proxy.directory), codes: string[] = [], agent = new EdgeAgent(credentials, journal, (code) => codes.push(code));
    await journal.event({ eventId: randomUUID(), deviceId: api.deviceId, localDeviceId: api.localDeviceId, observedAt: new Date(Date.now() - 8 * 86400000).toISOString(), status: 'unknown', code: 'offline_observation' });
    await agent.tick(signal()); expect(journal.events()).toHaveLength(0); expect(codes).toContain('device_event_expired');
    await api.request('enqueue'); const first = (await credentials.client.claim()).job; if (!first) throw new Error('Synthetic claim missing');
    await journal.begin(first, deviceBindingHash(config, first.deviceId)); expect(await api.request('expire_claim', { jobId: first.id })).toMatchObject({ expired: true });
    const current = (await credentials.client.claim()).job; if (!current) throw new Error('Synthetic replacement claim missing');
    expect(current.attempt).toBe(first.attempt + 1); const before = await api.request<Board>('board');
    expect(await agent.tick(signal())).toBe(false); const after = await api.request<Board>('board'); expect(after.jobs).toEqual(before.jobs); expect(journal.records().find((row) => row.jobId === first.id)?.phase).toBe('reported'); expect(codes).toContain('job_result_obsolete_attempt'); expect(proxy.state.calls.get(edgeRoutes.start)).toBe(1);
    const lease = { jobId: current.id, leaseToken: current.leaseToken, attempt: current.attempt };
    await credentials.client.complete(lease, { state: 'uncertain', code: 'synthetic_manual_review' });
    const local = await Journal.open(join(proxy.directory, 'resolved')); await local.begin(current, deviceBindingHash(config, current.deviceId));
    const resolved = await api.request<{ state: string; version: number }>('resolve', { jobId: current.id });
    await new EdgeAgent(credentials, local, (code) => codes.push(code)).tick(signal()); const verified = await api.request<Board>('board');
    expect(verified.jobs.find((row) => row.id === current.id)).toMatchObject({ state: resolved.state, version: resolved.version }); expect(codes).toContain('job_result_manually_resolved'); expect(local.records()[0]?.phase).toBe('reported'); expect(proxy.state.calls.get(edgeRoutes.start)).toBe(1);
  });
  it('receives WSS hints and records a lost start acknowledgement as uncertain, blocking subsequent work', async () => {
    const abort = new AbortController(); let wakes = 0;
    const subscribed = notifications(config, () => credentials.authorization(), () => { wakes++; }, abort.signal);
    try {
      await until(() => wakes >= 1); const queued = await api.request<{ id: string }>('enqueue'); await until(() => wakes >= 2, 7000);
      proxy.state.dropNext = edgeRoutes.start; await new EdgeAgent(credentials, await Journal.open(proxy.directory)).tick(signal());
      const board = await api.request<Board>('board'); expect(board.jobs.find((row) => row.id === queued.id)).toMatchObject({ state: 'uncertain', attempt: 1 });
      await api.request('enqueue'); expect(await new EdgeAgent(credentials, await Journal.open(proxy.directory)).tick(signal())).toBe(false); expect(proxy.state.calls.get(edgeRoutes.start)).toBe(2);
    } finally { abort.abort(); await subscribed; }
  }, 12000);
  it('closes an existing WSS session after revocation and refuses further HTTPS work', async () => {
    const abort = new AbortController(); let opened = false; const closedBefore = proxy.state.closedUpgrades;
    const subscribed = notifications(config, () => credentials.authorization(), () => { opened = true; }, abort.signal);
    try { await until(() => opened); await api.request('revoke'); await until(() => proxy.state.closedUpgrades > closedBefore, 7000); await expect(credentials.session()).rejects.toThrow('credential_rejected'); await expect(credentials.client.claim()).rejects.toThrow('credential_rejected'); }
    finally { abort.abort(); await subscribed; }
  }, 12000);
});
