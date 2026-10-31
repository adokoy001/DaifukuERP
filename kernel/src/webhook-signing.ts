// Webhook body and signature (docs/specs/event-delivery.md AC-8, ADR-0037). The format is Daifuku's own and fully
// specified here: HMAC-SHA256 keyed with the displayed secret string (UTF-8) over `<delivery id>.<timestamp>.<body bytes>`,
// sent as `Daifuku-Signature: v1=<lowercase hex>`. The delivery id is the same for every attempt and manual resend, so a
// receiver drops duplicates by `Daifuku-Delivery-Id`; the timestamp lets it refuse old replays.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_USER_AGENT = 'Daifuku-Webhook/1';
export const WEBHOOK_SIGNATURE_VERSION = 'v1';
/** Bodies above this size are not sent (`payload_too_large`). */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export interface WebhookEnvelope {
  deliveryId: string;
  eventId: string;
  topic: string;
  /** ISO time of the event (the outbox row's created_at). */
  occurredAt: string;
  companyId: string;
  data: unknown;
}

/** The exact body text that is signed and sent. */
export function webhookBody(envelope: WebhookEnvelope): string {
  const { deliveryId, eventId, topic, occurredAt, companyId, data } = envelope;
  return JSON.stringify({ deliveryId, eventId, topic, occurredAt, companyId, data });
}

/** `v1=<hex>` for one attempt. `timestamp` is the attempt's UNIX time in seconds. */
export function signWebhook(secret: string, deliveryId: string, timestamp: number, body: string | Uint8Array): string {
  const mac = createHmac('sha256', Buffer.from(secret, 'utf8'));
  mac.update(Buffer.from(`${deliveryId}.${timestamp}.`, 'utf8'));
  mac.update(typeof body === 'string' ? Buffer.from(body, 'utf8') : body);
  return `${WEBHOOK_SIGNATURE_VERSION}=${mac.digest('hex')}`;
}

/** Headers of one attempt (Content-Type, User-Agent and the Daifuku-* headers). */
export function webhookHeaders(input: {
  secret: string;
  deliveryId: string;
  eventId: string;
  topic: string;
  timestamp: number;
  body: string;
}): Record<string, string> {
  return {
    'content-type': 'application/json',
    'user-agent': WEBHOOK_USER_AGENT,
    'daifuku-delivery-id': input.deliveryId,
    'daifuku-event-id': input.eventId,
    'daifuku-topic': input.topic,
    'daifuku-timestamp': String(input.timestamp),
    'daifuku-signature': signWebhook(input.secret, input.deliveryId, input.timestamp, input.body),
  };
}

/**
 * Receiver-side check (also used by tests and the manual's example): recomputes the signature over the received bytes
 * and compares in constant time. The caller should also refuse timestamps far from its own clock.
 */
export function verifyWebhookSignature(
  secret: string,
  deliveryId: string,
  timestamp: string | number,
  body: string | Uint8Array,
  header: string | undefined,
): boolean {
  if (!header || !/^\d{1,12}$/.test(String(timestamp))) return false;
  const expected = Buffer.from(signWebhook(secret, deliveryId, Number(timestamp), body), 'utf8');
  return header
    .split(',')
    .map((part) => Buffer.from(part.trim(), 'utf8'))
    .some((candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected));
}
