// docs/specs/event-delivery.md AC-8: signature format with fixed key, time and body.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhookSignature, webhookBody, webhookHeaders } from '../src/webhook-signing.ts';

const SECRET = 'whsec_fixed-test-secret';
const DELIVERY = '0190d0a8-0000-7000-8000-000000000001';
const BODY = webhookBody({
  deliveryId: DELIVERY,
  eventId: '0190d0a8-0000-7000-8000-000000000002',
  topic: 'sales_invoice.submitted',
  occurredAt: '2026-10-30T01:02:03.000Z',
  companyId: '0190d0a8-0000-7000-8000-000000000003',
  data: { id: 'x', total: '1100' },
});

describe('webhook signing', () => {
  it('AC-8 body has exactly the envelope fields in order', () => {
    expect(Object.keys(JSON.parse(BODY) as object)).toEqual([
      'deliveryId',
      'eventId',
      'topic',
      'occurredAt',
      'companyId',
      'data',
    ]);
  });

  it('AC-8 signs <delivery id>.<timestamp>.<body> with HMAC-SHA256 keyed by the secret string', () => {
    const expected = createHmac('sha256', SECRET).update(`${DELIVERY}.1793340000.${BODY}`).digest('hex');
    expect(signWebhook(SECRET, DELIVERY, 1793340000, BODY)).toBe(`v1=${expected}`);
    expect(signWebhook(SECRET, DELIVERY, 1793340000, Buffer.from(BODY))).toBe(`v1=${expected}`);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it('AC-8 headers carry the delivery id, event id, topic, timestamp and signature', () => {
    const headers = webhookHeaders({
      secret: SECRET,
      deliveryId: DELIVERY,
      eventId: 'e',
      topic: 'sales_invoice.submitted',
      timestamp: 1793340000,
      body: BODY,
    });
    expect(headers).toMatchObject({
      'content-type': 'application/json',
      'user-agent': 'Daifuku-Webhook/1',
      'daifuku-delivery-id': DELIVERY,
      'daifuku-event-id': 'e',
      'daifuku-topic': 'sales_invoice.submitted',
      'daifuku-timestamp': '1793340000',
    });
    expect(
      verifyWebhookSignature(SECRET, DELIVERY, headers['daifuku-timestamp'] ?? '', BODY, headers['daifuku-signature']),
    ).toBe(true);
  });

  it('AC-8 verification fails for one changed byte, another secret, delivery id or timestamp', () => {
    const header = signWebhook(SECRET, DELIVERY, 1793340000, BODY);
    const changed = BODY.replace('1100', '1101');
    expect(verifyWebhookSignature(SECRET, DELIVERY, 1793340000, changed, header)).toBe(false);
    expect(verifyWebhookSignature(`${SECRET}x`, DELIVERY, 1793340000, BODY, header)).toBe(false);
    expect(verifyWebhookSignature(SECRET, `${DELIVERY.slice(0, -1)}2`, 1793340000, BODY, header)).toBe(false);
    expect(verifyWebhookSignature(SECRET, DELIVERY, 1793340001, BODY, header)).toBe(false);
    expect(verifyWebhookSignature(SECRET, DELIVERY, 'abc', BODY, header)).toBe(false);
    expect(verifyWebhookSignature(SECRET, DELIVERY, 1793340000, BODY, undefined)).toBe(false);
    expect(verifyWebhookSignature(SECRET, DELIVERY, 1793340000, BODY, `v1=00, ${header}`)).toBe(true);
  });
});
