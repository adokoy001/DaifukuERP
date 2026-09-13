import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EdgeAgent } from '../src/agent.ts';
import { Credentials } from '../src/credentials.ts';
import { Journal } from '../src/journal.ts';
import { deviceBindingHash } from '../src/config.ts';
import { notifications } from '../src/notifications.ts';
import { job, printerFixture, relayFixture, until } from './fixtures.ts';
async function prepare(relay: Awaited<ReturnType<typeof relayFixture>>, value = job(), printerUri?: string) {
  if (printerUri) value.driver = 'ipp_text';
  const config = relay.config();
  config.devices = [
    printerUri
      ? { deviceId: value.deviceId, localDeviceId: value.localDeviceId, driver: 'ipp_text', printerUri }
      : {
          deviceId: value.deviceId,
          localDeviceId: value.localDeviceId,
          driver: 'simulator',
          simulationConfirmed: true,
        },
  ];
  const credentials = await Credentials.open(relay.directory, config);
  await credentials.pair(relay.state.pairing);
  return { value, config, credentials, journal: await Journal.open(relay.directory) };
}
describe('outbound agent durable execution and recovery', () => {
  it('executes a explicitly configured simulator through HTTPS and persists metadata without job body', async () => {
    const relay = await relayFixture();
    try {
      const value = job({
          kind: 'print.text',
          payload: { title: 'Private title', text: 'DO_NOT_STORE_PRINT_BODY_123', copies: 1 },
        }),
        prepared = await prepare(relay, value);
      relay.state.queued = value;
      const agent = new EdgeAgent(prepared.credentials, prepared.journal);
      await agent.tick(new AbortController().signal);
      await agent.tick(new AbortController().signal);
      expect(relay.state.startCalls).toBe(1);
      expect(relay.state.completeCalls[0]?.['result']).toMatchObject({ state: 'succeeded', code: 'simulated_print' });
      expect(relay.state.eventCalls).toHaveLength(1);
      const disk = await readFile(join(relay.directory, 'journal.json'), 'utf8');
      expect(disk).not.toContain('DO_NOT_STORE_PRINT_BODY');
      expect(disk).not.toContain('Private title');
      expect(disk).toContain(value.payloadHash);
    } finally {
      await relay.close();
    }
  });
  it.each(['start_response_lost', 'already_started'] as const)(
    'never prints when start permission is ambiguous: %s',
    async (kind) => {
      const relay = await relayFixture(),
        printer = await printerFixture();
      try {
        const prepared = await prepare(
          relay,
          job({ kind: 'print.text', payload: { title: 'Test', text: 'test', copies: 1 } }),
          printer.uri,
        );
        relay.state.queued = prepared.value;
        relay.state.startLost = kind === 'start_response_lost';
        relay.state.startGranted = false;
        await new EdgeAgent(prepared.credentials, prepared.journal).tick(new AbortController().signal);
        expect(printer.state.printCalls).toBe(0);
        expect(relay.state.completeCalls[0]?.['result']).toMatchObject({ state: 'uncertain' });
      } finally {
        await printer.close();
        await relay.close();
      }
    },
  );
  it('never resends Print-Job after a printer accepted it but its response was lost', async () => {
    const relay = await relayFixture(),
      printer = await printerFixture();
    printer.state.lost = true;
    try {
      const prepared = await prepare(
        relay,
        job({ kind: 'print.text', payload: { title: 'Test', text: 'test', copies: 1 } }),
        printer.uri,
      );
      relay.state.queued = prepared.value;
      relay.state.completeLost = true;
      await expect(
        new EdgeAgent(prepared.credentials, prepared.journal).tick(new AbortController().signal),
      ).rejects.toThrow();
      expect(printer.state.printCalls).toBe(1);
      relay.state.completeLost = false;
      await new EdgeAgent(prepared.credentials, await Journal.open(relay.directory)).tick(new AbortController().signal);
      expect(printer.state.printCalls).toBe(1);
      expect(relay.state.completeCalls.at(-1)?.['result']).toMatchObject({ state: 'uncertain' });
    } finally {
      await printer.close();
      await relay.close();
    }
  });
  it('recovers an accepted printer job by its fixed endpoint and stored job-id without reprinting', async () => {
    const relay = await relayFixture(),
      printer = await printerFixture();
    try {
      const prepared = await prepare(
        relay,
        job({ kind: 'print.text', payload: { title: 'Test', text: 'test', copies: 1 } }),
        printer.uri,
      );
      await prepared.journal.begin(prepared.value, deviceBindingHash(prepared.config, prepared.value.deviceId));
      await prepared.journal.update(prepared.value.id, { phase: 'accepted', deviceJobId: '41' });
      await new EdgeAgent(prepared.credentials, await Journal.open(relay.directory)).tick(new AbortController().signal);
      expect(printer.state.printCalls).toBe(0);
      expect(printer.state.queryCalls).toBe(1);
      expect(relay.state.completeCalls[0]?.['result']).toMatchObject({ state: 'succeeded', deviceJobId: '41' });
    } finally {
      await printer.close();
      await relay.close();
    }
  });
  it('does not query a different printer after the local destination changes', async () => {
    const relay = await relayFixture(),
      printer = await printerFixture();
    try {
      const prepared = await prepare(
        relay,
        job({ kind: 'print.text', payload: { title: 'Test', text: 'test', copies: 1 } }),
        printer.uri,
      );
      await prepared.journal.begin(prepared.value, deviceBindingHash(prepared.config, prepared.value.deviceId));
      await prepared.journal.update(prepared.value.id, { phase: 'accepted', deviceJobId: '41' });
      const changed = {
        ...prepared.config,
        devices: prepared.config.devices.map((row) =>
          row.driver === 'ipp_text' ? { ...row, printerUri: printer.uri + '-changed' } : row,
        ),
      };
      const credentials = await Credentials.open(relay.directory, changed);
      await new EdgeAgent(credentials, await Journal.open(relay.directory)).tick(new AbortController().signal);
      expect(printer.state.queryCalls).toBe(0);
      expect(relay.state.completeCalls[0]?.['result']).toMatchObject({
        state: 'uncertain',
        code: 'local_device_mapping_changed',
      });
    } finally {
      await printer.close();
      await relay.close();
    }
  });
  it('marks an interrupted start intent uncertain instead of starting again on recovery', async () => {
    const relay = await relayFixture();
    try {
      const prepared = await prepare(relay);
      await prepared.journal.begin(prepared.value, deviceBindingHash(prepared.config, prepared.value.deviceId));
      await new EdgeAgent(prepared.credentials, await Journal.open(relay.directory)).tick(new AbortController().signal);
      expect(relay.state.startCalls).toBe(0);
      expect(relay.state.completeCalls[0]?.['result']).toMatchObject({ state: 'uncertain' });
    } finally {
      await relay.close();
    }
  });
  it('refuses a tampered request hash or unconfigured target before asking to start', async () => {
    const relay = await relayFixture();
    try {
      const prepared = await prepare(relay);
      prepared.value.payloadHash = 'a'.repeat(64);
      relay.state.queued = prepared.value;
      await new EdgeAgent(prepared.credentials, prepared.journal).tick(new AbortController().signal);
      expect(relay.state.startCalls).toBe(0);
      expect(relay.state.completeCalls[0]?.['result']).toMatchObject({
        state: 'uncertain',
        code: 'local_job_validation_failed',
      });
    } finally {
      await relay.close();
    }
  });
  it('uses verified WSS with native Authorization and small notifications', async () => {
    const relay = await relayFixture(),
      abort = new AbortController();
    let wakeups = 0;
    try {
      const prepared = await prepare(relay);
      const connected = notifications(
        prepared.config,
        () => prepared.credentials.authorization(),
        () => {
          wakeups++;
        },
        abort.signal,
      );
      await until(() => wakeups >= 2);
      expect(relay.state.notifications).toBe(1);
      abort.abort();
      await connected;
    } finally {
      abort.abort();
      await relay.close();
    }
  });
  it('finds a job by periodic HTTPS claim while all WebSocket notifications are unavailable', async () => {
    const relay = await relayFixture(),
      abort = new AbortController();
    try {
      const prepared = await prepare(relay);
      relay.server.removeAllListeners('upgrade');
      relay.server.on('upgrade', (_request, socket) => socket.destroy());
      const running = new EdgeAgent(prepared.credentials, prepared.journal).run(abort.signal);
      await until(() => relay.state.claims >= 1);
      relay.state.queued = prepared.value;
      await until(() => relay.state.completeCalls.length >= 1, 22000);
      abort.abort();
      await running;
      expect(relay.state.startCalls).toBe(1);
    } finally {
      abort.abort();
      await relay.close();
    }
  }, 30000);
});
