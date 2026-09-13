import { z } from 'zod';
export const normalizedPosEvent = z
  .object({
    provider: z.literal('square'),
    eventId: z.string().min(1).max(200),
    merchantId: z.string().min(1).max(100),
    locationId: z.string().max(100).nullable(),
    kind: z.enum(['payment', 'refund', 'unsupported']),
    externalId: z.string().min(1).max(200),
    paymentId: z.string().max(200).nullable(),
    state: z.string().max(80),
    occurredAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    amount: z.string().regex(/^\d+$/).nullable(),
    currency: z.string().max(10).nullable(),
    rawHash: z.string().regex(/^[a-f0-9]{64}$/),
    unsupportedReason: z.string().max(200).nullable(),
  })
  .strict();
export type NormalizedPosEvent = z.infer<typeof normalizedPosEvent>;
export const inboxStates = ['received', 'ignored', 'deferred', 'blocked', 'posted'] as const;
export const posResult = z.object({
  id: z.uuid(),
  version: z.number().int(),
  status: z.enum(inboxStates),
  transactionId: z.uuid().nullable(),
  error: z.string().nullable(),
});
export const retryInput = z.object({ inboxId: z.uuid(), expectedVersion: z.number().int().min(1) }).strict();
export const correctInput = z
  .object({
    transactionId: z.uuid(),
    expectedVersion: z.number().int().min(1),
    date: z.iso.date(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
