import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { EdgeAgent } from '../src/agent.ts';
import { Credentials } from '../src/credentials.ts';
import { Journal } from '../src/journal.ts';
import { deviceBindingHash } from '../src/config.ts';
import { job, relayFixture, printerFixture } from './fixtures.ts';

type Step = { event: string; journals: string[]; sends: number[] };
type Trace = { id: string; steps: Step[] };
const traces = JSON.parse(await readFile(new URL('../../../verification/edge/traces.json', import.meta.url), 'utf8')) as Trace[];
const signal = () => new AbortController().signal;
function checkpoint(traceId: string, event: string): Step {
  const step = traces.find((trace) => trace.id === traceId)?.steps.find((step) => step.event === event);
  assert(step, `Missing model checkpoint ${traceId}: ${event}`); return step;
}
async function projection(directory: string, prints: number) {
  const journal = await Journal.open(directory), row = journal.records()[0];
  // The model's "result" means a durable result field, not an implementation enum.
  const phase = !row ? 'none' : row.phase === 'reported' ? 'reported' : row.result ? 'result' : row.phase === 'accepted' ? 'executing' : row.phase;
  return { journal: phase, sends: prints };
}
async function matches(directory: string, prints: number, step: Step) {
  expect(await projection(directory, prints), step.event).toEqual({ journal: step.journals[0], sends: step.sends[0] });
}
async function prepare(relay: Awaited<ReturnType<typeof relayFixture>>, printerUri: string) {
  const value = job({ kind: 'print.text', payload: { title: 'Synthetic model', text: 'Model trace only', copies: 1 } }); value.driver = 'ipp_text';
  const config = relay.config(); config.devices = [{ deviceId: value.deviceId, localDeviceId: value.localDeviceId, driver: 'ipp_text', printerUri }];
  const credentials = await Credentials.open(relay.directory, config); await credentials.pair(relay.state.pairing);
  const journal = await Journal.open(relay.directory); relay.state.queued = value;
  return { value, config, credentials, journal };
}

describe('AC-8: model journal/device projections against real TLS, disk and IPP fixtures', () => {
  it('EDGE-TRACE-LOST-START: durable intent precedes HTTP; lost grant never reaches the printer', async () => {
    const relay = await relayFixture(), printer = await printerFixture();
    try {
      const prepared = await prepare(relay, printer.uri), trace = 'EDGE-TRACE-LOST-START';
      const start = prepared.credentials.client.start.bind(prepared.credentials.client);
      let checkedIntent = false;
      vi.spyOn(prepared.credentials.client, 'start').mockImplementation(async (lease) => {
        await matches(relay.directory, printer.state.printCalls, checkpoint(trace, 'PersistStarting:1')); checkedIntent = true;
        return start(lease); // Keep the actual TLS transport and response loss.
      });
      relay.state.startLost = true;
      await new EdgeAgent(prepared.credentials, prepared.journal).tick(signal());
      await matches(relay.directory, printer.state.printCalls, checkpoint(trace, 'DeliverComplete:1'));
      expect(checkedIntent).toBe(true); expect(relay.state.startCalls).toBe(1);
      expect(relay.state.completeCalls[0]?.['result']).toMatchObject({ state: 'uncertain', code: 'start_response_unknown' });
      await new EdgeAgent(prepared.credentials, await Journal.open(relay.directory)).tick(signal());
      expect(relay.state.startCalls).toBe(1); expect(printer.state.printCalls).toBe(0);
    } finally { vi.restoreAllMocks(); await printer.close(); await relay.close(); }
  });
  it('EDGE-TRACE-PHYSICAL-UNKNOWN: lost printer and completion replies survive restart without resend', async () => {
    const trace = 'EDGE-TRACE-PHYSICAL-UNKNOWN'; let sendCheckpoint: Promise<void> | undefined;
    const relay = await relayFixture(), printer = await printerFixture((count) => {
      sendCheckpoint = matches(relay.directory, count, checkpoint(trace, 'PhysicalSend:1'));
      return sendCheckpoint;
    });
    try {
      const prepared = await prepare(relay, printer.uri);
      relay.state.completeLost = true; printer.state.lost = true;
      await expect(new EdgeAgent(prepared.credentials, prepared.journal).tick(signal())).rejects.toThrow('transport_failed');
      expect(sendCheckpoint).toBeDefined(); await sendCheckpoint;
      await matches(relay.directory, printer.state.printCalls, checkpoint(trace, 'DropComplete:1'));
      const first = relay.state.completeCalls[0]; assert(first);
      const reopened = await Journal.open(relay.directory);
      expect(reopened.records()[0]?.result).toMatchObject({ state: 'uncertain', code: 'device_response_unknown' });
      relay.state.completeLost = false;
      await new EdgeAgent(await Credentials.open(relay.directory, prepared.config), reopened).tick(signal());
      await matches(relay.directory, printer.state.printCalls, checkpoint(trace, 'DeliverComplete:1'));
      expect(relay.state.completeCalls).toHaveLength(2); expect(relay.state.completeCalls[1]).toEqual(first);
      expect(relay.state.startCalls).toBe(1); expect(printer.state.queryCalls).toBe(0);
    } finally { await printer.close(); await relay.close(); }
  });
  it('EDGE-TRACE-OBSOLETE: old journal is acknowledged only by an explicit fencing disposition', async () => {
    const relay = await relayFixture(), printer = await printerFixture();
    try {
      const prepared = await prepare(relay, printer.uri), trace = 'EDGE-TRACE-OBSOLETE'; relay.state.queued = null;
      await prepared.journal.begin(prepared.value, deviceBindingHash(prepared.config, prepared.value.deviceId));
      relay.state.completeAccepted = false;
      await expect(new EdgeAgent(prepared.credentials, await Journal.open(relay.directory)).tick(signal())).rejects.toThrow('job_result_not_accepted');
      await matches(relay.directory, printer.state.printCalls, checkpoint(trace, 'Recover:1'));
      relay.state.completeIgnored = 'obsolete_attempt';
      await new EdgeAgent(prepared.credentials, await Journal.open(relay.directory)).tick(signal());
      await matches(relay.directory, printer.state.printCalls, checkpoint(trace, 'DeliverComplete:1'));
      expect(relay.state.startCalls).toBe(0); expect(relay.state.completeCalls).toHaveLength(2);
      expect(relay.state.completeCalls[1]).toEqual(relay.state.completeCalls[0]); expect(relay.state.eventCalls).toHaveLength(0);
    } finally { await printer.close(); await relay.close(); }
  });
});
