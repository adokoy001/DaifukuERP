import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeSquareEvent, parseSquareConnections, verifySquareSignature } from '../src/adapters/square-pos.ts';
const connection = {
  notificationUrl: 'https://erp.example.invalid/webhooks/square/main',
  signatureKey: 'test-signature-key-32-characters!!',
};
function body(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    event_id: 'evt-1',
    merchant_id: 'merchant',
    type: 'payment.updated',
    created_at: '2026-08-31T05:00:00Z',
    data: {
      id: 'payment-1',
      object: {
        payment: {
          id: 'payment-1',
          location_id: 'store',
          status: 'COMPLETED',
          created_at: '2026-08-31T04:00:00Z',
          updated_at: '2026-08-31T05:00:00Z',
          total_money: { amount: 1100, currency: 'JPY' },
          buyer_email_address: 'private@example.invalid',
          ...extra,
        },
      },
    },
  });
}
describe('Square official webhook boundary', () => {
  it('verifies configured URL plus exact raw body, rejects tampering and malformed signatures', () => {
    const raw = body(),
      signature = createHmac('sha256', connection.signatureKey)
        .update(connection.notificationUrl + raw)
        .digest('base64');
    expect(verifySquareSignature(raw, signature, connection)).toBe(true);
    expect(verifySquareSignature(raw + ' ', signature, connection)).toBe(false);
    expect(
      verifySquareSignature(raw, signature, { ...connection, notificationUrl: connection.notificationUrl + '/' }),
    ).toBe(false);
    for (const value of [undefined, '', 'x'.repeat(44), signature.slice(1)])
      expect(verifySquareSignature(raw, value, connection)).toBe(false);
  });
  it('normalizes whitelisted JPY payment data using stable transaction created time', () => {
    const normalized = normalizeSquareEvent(body());
    expect(normalized).toMatchObject({
      kind: 'payment',
      amount: '1100',
      currency: 'JPY',
      occurredAt: '2026-08-31T04:00:00Z',
      updatedAt: '2026-08-31T05:00:00Z',
    });
    expect(JSON.stringify(normalized)).not.toContain('private@');
    expect(normalized.rawHash).toHaveLength(64);
  });
  it('does not guess total amount, unsafe integers or unknown status', () => {
    for (const extra of [
      { total_money: null, amount_money: { amount: 1000, currency: 'JPY' } },
      { total_money: { amount: 9007199254740992, currency: 'JPY' } },
      { status: 'FUTURE_STATUS' },
    ])
      expect(normalizeSquareEvent(body(extra)).kind).toBe('unsupported');
    expect(() => normalizeSquareEvent('{')).toThrow('Malformed Square event JSON');
  });
  it('supports refunds without a location only when an original payment reference is present', () => {
    const raw = JSON.parse(body()) as Record<string, unknown>;
    raw.type = 'refund.updated';
    raw.data = {
      object: {
        refund: {
          id: 'refund',
          payment_id: 'payment-1',
          status: 'COMPLETED',
          created_at: '2026-09-01T00:00:00Z',
          amount_money: { amount: 500, currency: 'JPY' },
        },
      },
    };
    expect(normalizeSquareEvent(JSON.stringify(raw))).toMatchObject({
      kind: 'refund',
      paymentId: 'payment-1',
      locationId: null,
      amount: '500',
    });
  });
  it('requires unique exact mappings and explicit HTTPS callback configuration', () => {
    expect(parseSquareConnections(undefined)).toEqual([]);
    const cfg = {
      ...connection,
      key: 'main',
      tenantId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      companyId: '00000000-0000-4000-8000-000000000003',
      locationId: '00000000-0000-4000-8000-000000000004',
      merchantId: 'merchant',
      externalLocationId: 'store',
    };
    expect(parseSquareConnections(JSON.stringify([cfg]))).toHaveLength(1);
    expect(() => parseSquareConnections(JSON.stringify([cfg, { ...cfg, key: 'second' }]))).toThrow('unique');
    expect(() =>
      parseSquareConnections(JSON.stringify([{ ...cfg, notificationUrl: 'http://erp.invalid/path' }])),
    ).toThrow();
  });
});
