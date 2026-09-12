import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseConfig } from '../src/config.ts';
import { ippRequest, parseIpp } from '../src/drivers/ipp-codec.ts';
import { printText, printerTransport, terminalJob } from '../src/drivers/ipp.ts';
import { printerFixture } from './fixtures.ts';
const request = { kind: 'print.text', payload: { text: '日本語 test', title: 'Synthetic test', copies: 1 } } as const;
describe('bounded IPP protocol and device outcomes', () => {
  it('roundtrips typed attributes and rejects truncated, oversized or mismatched replies', () => {
    const encoded = ippRequest(11, 'ipp://localhost/print', [{ name: 'requested-attributes', tag: 0x44, values: ['job-id', 'job-state'] }]);
    expect(parseIpp(encoded.body, encoded.requestId).attributes.get('requested-attributes')).toEqual(['job-id', 'job-state']);
    for (const body of [encoded.body.subarray(0, 7), encoded.body.subarray(0, -1), Buffer.alloc(262145)]) expect(() => parseIpp(body)).toThrow();
    expect(() => parseIpp(encoded.body, encoded.requestId + 1)).toThrow();
  });
  it('does not call acceptance completion and observes job state until the printer reports complete', async () => {
    const printer = await printerFixture(); printer.state.jobStates = [5, 9]; const references: string[] = [];
    try { const device = { deviceId: randomUUID(), localDeviceId: 'printer', driver: 'ipp_text' as const, printerUri: printer.uri }, config = parseConfig({ apiBaseUrl: 'https://erp.example', requestTimeoutMs: 1000, devices: [device] }), signal = new AbortController().signal;
      const result = await printText(printerTransport(device, config, signal), request, { signal, canSend: () => true, accepted: async (value) => { references.push(value); } }, 3000);
      expect(result).toMatchObject({ state: 'succeeded', code: 'ipp_reported_completed', deviceJobId: '41' }); expect(references).toEqual(['41']); expect(printer.state.printCalls).toBe(1); expect(printer.state.queryCalls).toBe(2);
    } finally { await printer.close(); }
  });
  it('fails before printing when Japanese text lacks an explicitly supported UTF-8 media type', async () => {
    const printer = await printerFixture(); printer.state.asciiOnly = true;
    try { const device = { deviceId: randomUUID(), localDeviceId: 'printer', driver: 'ipp_text' as const, printerUri: printer.uri }, config = parseConfig({ apiBaseUrl: 'https://erp.example', devices: [device] }), signal = new AbortController().signal;
      const result = await printText(printerTransport(device, config, signal), request, { signal, canSend: () => true, accepted: async () => undefined }, 1000); expect(result.code).toBe('ipp_text_format_unsupported'); expect(printer.state.printCalls).toBe(0);
    } finally { await printer.close(); }
  });
  it('does not send escape or device control sequences as plain text', async () => {
    const calls: number[] = [], signal = new AbortController().signal;
    const result = await printText(async (operation) => { calls.push(operation); throw new Error('Unexpected device request'); }, { ...request, payload: { ...request.payload, text: 'text' + String.fromCharCode(27) + '@' } }, { signal, canSend: () => true, accepted: async () => undefined }, 1000);
    expect(result.code).toBe('text_control_characters_rejected'); expect(calls).toEqual([]);
  });
  it('treats forwarded completion and completion with errors as uncertain', () => {
    for (const reason of ['queued-in-device', 'job-completed-with-errors', 'job-completed-with-warnings']) expect(terminalJob({ code: 0, requestId: 1, attributes: new Map([['job-state', [9]], ['job-state-reasons', [reason]]]) }, '41')).toMatchObject({ state: 'uncertain' });
    expect(terminalJob({ code: 0, requestId: 1, attributes: new Map([['job-state', [7]]]) }, '41')).toMatchObject({ state: 'failed', code: 'ipp_cancelled' });
  });
});
