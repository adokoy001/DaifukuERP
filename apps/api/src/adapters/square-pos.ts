import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ValidationError } from '@daifuku/kernel';
import { normalizedPosEvent, type NormalizedPosEvent } from '@daifuku/mod-pos-integration';
import { z } from 'zod';
export const squareConnectionSchema = z.object({ key: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), tenantId: z.uuid(), userId: z.uuid(), companyId: z.uuid(), locationId: z.uuid(), merchantId: z.string().min(1).max(100), externalLocationId: z.string().min(1).max(100), notificationUrl: z.url().refine((value) => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search; }), signatureKey: z.string().min(16).max(500) }).strict();
export type SquareConnection = z.infer<typeof squareConnectionSchema>;
export function parseSquareConnections(raw: string | undefined): SquareConnection[] {
  if (!raw?.trim()) return [];
  const rows = z.array(squareConnectionSchema).max(100).parse(JSON.parse(raw));
  if (new Set(rows.map((row) => row.key)).size !== rows.length || new Set(rows.map((row) => `${row.merchantId}:${row.externalLocationId}`)).size !== rows.length) throw new Error('Square connection keys and merchant/location mappings must be unique.');
  return rows;
}
export function verifySquareSignature(body: string, signature: string | undefined, connection: Pick<SquareConnection, 'notificationUrl' | 'signatureKey'>): boolean {
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac('sha256', connection.signatureKey).update(connection.notificationUrl).update(body).digest(), received = Buffer.from(signature, 'base64');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === 'string' ? value : null;
function money(value: unknown) { const row = object(value); return { amount: typeof row.amount === 'number' && Number.isSafeInteger(row.amount) && row.amount >= 0 ? String(row.amount) : null, currency: string(row.currency) }; }
/** Whitelist-only extraction: provider customer/card/address fields never enter persisted data or logs. */
export function normalizeSquareEvent(body: string): NormalizedPosEvent {
  let raw: unknown; try { raw = JSON.parse(body); } catch { throw new ValidationError('Malformed Square event JSON', [], 'Send the original signed JSON body.'); }
  const envelope = object(raw), data = object(envelope.data), objects = object(data.object);
  const eventId = string(envelope.event_id), merchantId = string(envelope.merchant_id), eventAt = string(envelope.created_at), type = string(envelope.type) ?? '';
  if (!eventId || !merchantId || !eventAt || !z.iso.datetime({ offset: true }).safeParse(eventAt).success) throw new ValidationError('Malformed Square event envelope', [], 'Require event_id, merchant_id and created_at from the signed event.');
  const kind = ['payment.created', 'payment.updated'].includes(type) ? 'payment' : ['refund.created', 'refund.updated'].includes(type) ? 'refund' : 'unsupported';
  const item = object(objects[kind]), externalId = string(item.id) ?? string(data.id) ?? eventId, state = string(item.status) ?? 'UNKNOWN', locationId = string(item.location_id), paymentId = kind === 'refund' ? string(item.payment_id) : null;
  const amount = money(kind === 'payment' ? item.total_money : item.amount_money), created = string(item.created_at), updated = string(item.updated_at) ?? created;
  let unsupportedReason = kind === 'unsupported' ? 'Unsupported Square event type' : null;
  if (kind !== 'unsupported' && (!created || !updated || !z.iso.datetime({ offset: true }).safeParse(created).success || !z.iso.datetime({ offset: true }).safeParse(updated).success || !string(item.id))) unsupportedReason = 'Missing or invalid provider transaction identity/time';
  if (kind === 'payment' && !locationId) unsupportedReason = 'Payment location is missing';
  if (kind === 'refund' && !paymentId) unsupportedReason = 'Refund payment reference is missing';
  if (!(kind === 'payment' ? ['APPROVED', 'PENDING', 'COMPLETED', 'CANCELED', 'FAILED'] : ['PENDING', 'COMPLETED', 'REJECTED', 'FAILED']).includes(state)) unsupportedReason = 'Unknown provider transaction status';
  if (state === 'COMPLETED' && (!amount.amount || !amount.currency)) unsupportedReason = 'Completed money is missing or unsafe';
  return normalizedPosEvent.parse({ provider: 'square', eventId, merchantId, locationId, kind: unsupportedReason ? 'unsupported' : kind, externalId, paymentId, state, occurredAt: created && z.iso.datetime({ offset: true }).safeParse(created).success ? created : eventAt, updatedAt: updated && z.iso.datetime({ offset: true }).safeParse(updated).success ? updated : eventAt, ...amount, rawHash: createHash('sha256').update(body).digest('hex'), unsupportedReason });
}
