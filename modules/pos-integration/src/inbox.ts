import { Conflict, DaifukuError, repo, StateError, withLock, withSavepoint, type Context, type Infer } from '@daifuku/kernel';
import { PosInbox, PosLocation } from './entities.ts';
import { normalizedPosEvent, type NormalizedPosEvent } from './contract.ts';
import { internalWrite } from './internal.ts';
import { paymentKey, postEvent } from './posting.ts';
export const inboxResult = (row: Infer<typeof PosInbox>) => ({ id: row.id, version: row.version, status: row.status, transactionId: row.transactionId, error: row.error });
export async function processInbox(ctx: Context, id: string, expectedVersion?: number) {
  const first = await repo(ctx, PosInbox).get(id), e = normalizedPosEvent.parse(first.event);
  return withLock(ctx, 'pos-payment:' + paymentKey(e.merchantId, e.paymentId ?? e.externalId), async () => {
    const row = await repo(ctx, PosInbox).lock(id);
    if (expectedVersion !== undefined && row.version !== expectedVersion) throw new Conflict('POS inbox changed', 'Reload the current inbox version.');
    if (row.status === 'posted' || row.status === 'ignored') return inboxResult(row);
    let status: Infer<typeof PosInbox>['status'] = 'posted', error: string | null = null, transactionId: string | null = null;
    try { transactionId = await withSavepoint(ctx, (inner) => postEvent(inner, row)); if (!transactionId) status = 'ignored'; }
    catch (failure) { status = failure instanceof StateError && failure.message === 'POS_PAYMENT_PENDING' ? 'deferred' : 'blocked'; error = failure instanceof DaifukuError ? `${failure.code}: ${failure.message} — ${failure.hint}`.slice(0, 500) : 'INTERNAL: POS processing failed'; }
    const updated = await internalWrite(ctx, PosInbox, (inner) => repo(inner, PosInbox).update(id, { status, error, transactionId, attempts: row.attempts + 1, lastAttemptAt: ctx.now() }));
    return inboxResult(updated);
  });
}
/** Signed adapter entry point; not exposed as a public action or permission bypass. */
export async function receivePosEvent(ctx: Context, locationId: string, raw: NormalizedPosEvent) {
  const event = normalizedPosEvent.parse(raw), location = await repo(ctx, PosLocation).get(locationId);
  if (!location.active || location.provider !== event.provider || location.merchantId !== event.merchantId || (event.locationId !== null && location.externalLocationId !== event.locationId)) throw new StateError('POS mapping does not match this event', 'Use the configured company, merchant and location mapping.');
  const result = await withLock(ctx, 'pos-event:' + event.eventId, async () => {
    const previous = (await repo(ctx, PosInbox).list({ where: { eventId: event.eventId }, limit: 1 })).items[0];
    if (previous) {
      if (previous.locationId !== location.id || normalizedPosEvent.parse(previous.event).rawHash !== event.rawHash) throw new Conflict('POS event ID has conflicting content', 'Do not reuse or alter an accepted external event.');
      return processInbox(ctx, previous.id);
    }
    const row = await internalWrite(ctx, PosInbox, (inner) => repo(inner, PosInbox).create({ locationId, eventId: event.eventId, externalId: event.externalId, paymentId: event.paymentId, kind: event.kind, event, status: 'received', attempts: 0, receivedAt: ctx.now() }));
    return processInbox(ctx, row.id);
  });
  if (event.kind === 'payment' && result.status === 'posted') {
    const pending = await repo(ctx, PosInbox).list({ where: { locationId, paymentId: event.externalId, status: 'deferred' }, limit: 500 });
    for (const row of pending.items) await processInbox(ctx, row.id);
    // Any additional rows retain deferred state and remain explicitly retryable in the inbox.
  }
  return result;
}
