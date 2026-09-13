import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EdgeAgent } from '../src/agent.ts';
import { Credentials } from '../src/credentials.ts';
import { Journal } from '../src/journal.ts';
import { deviceBindingHash } from '../src/config.ts';
import { job, relayFixture } from './fixtures.ts';
async function prepared() {
  const relay = await relayFixture(),
    config = relay.config(),
    value = job();
  config.devices = [
    { deviceId: value.deviceId, localDeviceId: value.localDeviceId, driver: 'simulator', simulationConfirmed: true },
  ];
  const credentials = await Credentials.open(relay.directory, config);
  await credentials.pair(relay.state.pairing);
  const journal = await Journal.open(relay.directory);
  await journal.begin(value, deviceBindingHash(config, value.deviceId));
  await journal.update(value.id, { result: { state: 'uncertain', code: 'start_response_unknown' } });
  return { relay, credentials, journal, value };
}
describe('explicit server acknowledgement of obsolete durable records', () => {
  it.each(['obsolete_attempt', 'manually_resolved'] as const)(
    'settles only the old local result for %s without sending physical status or starting',
    async (ignored) => {
      const f = await prepared(),
        codes: string[] = [];
      try {
        f.relay.state.completeAccepted = false;
        f.relay.state.completeIgnored = ignored;
        await new EdgeAgent(f.credentials, f.journal, (code) => codes.push(code)).tick(new AbortController().signal);
        expect(f.journal.records()[0]?.phase).toBe('reported');
        expect(f.relay.state.startCalls).toBe(0);
        expect(f.relay.state.eventCalls).toHaveLength(0);
        expect(codes).toContain('job_result_' + ignored);
      } finally {
        await f.relay.close();
      }
    },
  );
  it('retains an unacknowledged result when false has no explicit disposition', async () => {
    const f = await prepared();
    try {
      f.relay.state.completeAccepted = false;
      await expect(new EdgeAgent(f.credentials, f.journal).tick(new AbortController().signal)).rejects.toThrow(
        'job_result_not_accepted',
      );
      expect(f.journal.records()[0]?.phase).toBe('starting');
      expect(f.relay.state.claims).toBe(0);
    } finally {
      await f.relay.close();
    }
  });
  it.each(['same_process', 'after_restart'] as const)(
    'keeps the original observation time after a delayed completion acknowledgement: %s',
    async (recovery) => {
      const f = await prepared();
      try {
        const observedAt = f.journal.records()[0]?.updatedAt;
        if (!observedAt) throw new Error('Synthetic result timestamp missing');
        f.relay.state.completeLost = true;
        await expect(new EdgeAgent(f.credentials, f.journal).tick(new AbortController().signal)).rejects.toThrow(
          'transport_failed',
        );
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 2 * 86400000);
        f.relay.state.completeLost = false;
        const journal = recovery === 'after_restart' ? await Journal.open(f.relay.directory) : f.journal;
        await new EdgeAgent(f.credentials, journal).tick(new AbortController().signal);
        expect(f.relay.state.eventCalls).toHaveLength(1);
        expect(f.relay.state.eventCalls[0]?.['observedAt']).toBe(observedAt);
        expect(f.relay.state.eventCalls[0]?.['observedAt']).not.toBe(new Date().toISOString());
        expect(f.relay.state.startCalls).toBe(0);
        expect(f.relay.state.completeCalls).toHaveLength(2);
      } finally {
        vi.useRealTimers();
        await f.relay.close();
      }
    },
  );
  it('removes an expired observation only after the server acknowledges that disposition', async () => {
    const f = await prepared(),
      codes: string[] = [];
    try {
      f.relay.state.completeAccepted = false;
      f.relay.state.completeIgnored = 'obsolete_attempt';
      f.relay.state.eventIgnored = 'expired';
      await f.journal.event({
        eventId: randomUUID(),
        deviceId: f.value.deviceId,
        localDeviceId: f.value.localDeviceId,
        observedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
        status: 'unknown',
        code: 'previous_observation',
      });
      await new EdgeAgent(f.credentials, f.journal, (code) => codes.push(code)).tick(new AbortController().signal);
      expect(f.journal.events()).toHaveLength(0);
      expect(codes).toContain('device_event_expired');
      expect(f.relay.state.claims).toBe(1);
      expect(f.relay.state.startCalls).toBe(0);
    } finally {
      await f.relay.close();
    }
  });
});
