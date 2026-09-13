import { describe, it, expect } from 'vitest';
import { edgeJobRequest, edgePayloadText, edgePairInput, edgeEventInput, edgeLease } from '../src/contract.ts';
describe('bounded device wire contract', () => {
  it('canonicalizes the complete request consistently despite property insertion order', () => {
    const first = edgeJobRequest.parse({ kind: 'print.text', payload: { title: 'T', text: '日本語', copies: 1 } });
    const second = edgeJobRequest.parse({ payload: { copies: 1, text: '日本語', title: 'T' }, kind: 'print.text' });
    expect(edgePayloadText(first)).toBe(edgePayloadText(second));
    expect(edgePayloadText(first)).toBe('{"kind":"print.text","payload":{"copies":1,"text":"日本語","title":"T"}}');
  });
  it('rejects arbitrary destinations, commands, control kinds and oversized printing', () => {
    for (const request of [
      { kind: 'shell', payload: { command: 'exit' } },
      { kind: 'device.status', payload: { url: 'https://example.com' } },
      { kind: 'print.text', payload: { text: 'x'.repeat(16001), title: 'T', copies: 1 } },
      { kind: 'print.text', payload: { text: 'x', title: 'T', copies: 6 } },
      { kind: 'cash.dispense', payload: { amount: '1.5', currency: 'JPY' } },
      { kind: 'cash.dispense', payload: { amount: '100', currency: 'USD' } },
    ])
      expect(edgeJobRequest.safeParse(request).success).toBe(false);
  });
  it('accepts only high entropy shaped credentials, UUID events and positive fencing attempts', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(
      edgePairInput.safeParse({
        pairingToken: 'short',
        credentialSecret: 'x'.repeat(43),
        protocolVersion: 1,
        agentVersion: 'test',
      }).success,
    ).toBe(false);
    expect(edgeLease.safeParse({ jobId: id, leaseToken: 'x'.repeat(43), attempt: 0 }).success).toBe(false);
    expect(
      edgeEventInput.safeParse({
        eventId: id,
        deviceId: id,
        localDeviceId: '../printer',
        observedAt: '2026-09-12T00:00:00Z',
        status: 'online',
        code: 'ready',
      }).success,
    ).toBe(false);
  });
});
