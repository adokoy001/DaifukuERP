import { Conflict, Decimal, repo, StateError, todayLocal, withLock, type Context, type Infer } from '@daifuku/kernel';
import { postFromSource, reverseSourceEntry } from '@daifuku/mod-accounting';
import type { PosInbox } from './entities.ts';
import { PosLocation, PosTransaction } from './entities.ts';
import { normalizedPosEvent } from './contract.ts';
import { internalWrite } from './internal.ts';
import { assertLocationAccounts } from './location.ts';
export const paymentKey = (merchant: string, externalId: string) => `square:${merchant}:payment:${externalId}`;
export async function postEvent(ctx: Context, inbox: Infer<typeof PosInbox>): Promise<string | null> {
  const event = normalizedPosEvent.parse(inbox.event),
    location = await repo(ctx, PosLocation).get(inbox.locationId);
  if (!location.active)
    throw new StateError('POS location is inactive', 'Reactivate the reviewed mapping before retrying.');
  if (event.kind === 'unsupported')
    throw new StateError(
      'Unsupported POS event',
      event.unsupportedReason ?? 'Use a supported completed payment or refund event.',
    );
  if (event.state !== 'COMPLETED') return null;
  if (todayLocal(new Date(event.occurredAt)) > todayLocal(ctx.now()))
    throw new StateError('POS event date is in the future', 'Review the signed provider timestamp before retrying.');
  if (event.currency !== 'JPY' || !event.amount || !Decimal.from(event.amount).gt('0'))
    throw new StateError('Unsupported POS money', 'Only positive integer JPY amounts are supported.');
  const amount = event.amount;
  const key = `square:${event.merchantId}:${event.kind}:${event.externalId}`,
    rows = repo(ctx, PosTransaction);
  const existing = (await rows.list({ where: { key }, limit: 1 })).items[0];
  if (existing) {
    if (
      existing.locationId !== location.id ||
      !existing.amount.eq(event.amount) ||
      existing.kind !== event.kind ||
      existing.date !== todayLocal(new Date(event.occurredAt)) ||
      (existing.paymentId && (await rows.get(existing.paymentId)).externalId !== event.paymentId)
    )
      throw new Conflict(
        'External POS identity has conflicting content',
        'Investigate the original provider transaction; a posted source is immutable.',
      );
    if (existing.status !== 'posted')
      throw new StateError(
        'Original POS source was cancelled',
        'A replay cannot repost a manually corrected transaction.',
      );
    return existing.id;
  }
  let parent: Infer<typeof PosTransaction> | undefined;
  if (event.kind === 'refund') {
    parent = (await rows.list({ where: { key: paymentKey(event.merchantId, event.paymentId ?? '') }, limit: 1 }))
      .items[0];
    if (!parent)
      throw new StateError('POS_PAYMENT_PENDING', 'Receive the completed original payment, then retry this refund.');
    parent = await rows.lock(parent.id);
    if (
      todayLocal(new Date(event.occurredAt)) < parent.date ||
      parent.status !== 'posted' ||
      parent.locationId !== location.id ||
      parent.refunded.plus(event.amount).gt(parent.amount)
    )
      throw new StateError(
        'Refund exceeds or does not match the original payment',
        'Review the payment location, cancellation and cumulative refunds.',
      );
  }
  const accounts = parent ?? location;
  await assertLocationAccounts(ctx, { ...accounts });
  return internalWrite(ctx, PosTransaction, async (inner) => {
    const source = await repo(inner, PosTransaction).create({
      locationId: location.id,
      key,
      kind: event.kind as 'payment' | 'refund',
      externalId: event.externalId,
      paymentId: parent?.id ?? null,
      date: todayLocal(new Date(event.occurredAt)),
      amount,
      currency: 'JPY',
      refunded: '0',
      rawHash: event.rawHash,
      settlementAccountId: accounts.settlementAccountId,
      suspenseAccountId: accounts.suspenseAccountId,
      status: 'posted',
    });
    const debit = event.kind === 'payment' ? source.settlementAccountId : source.suspenseAccountId,
      credit = event.kind === 'payment' ? source.suspenseAccountId : source.settlementAccountId;
    const entry = await postFromSource(inner, {
      sourceEntity: PosTransaction.name,
      sourceId: source.id,
      date: source.date,
      description: `Square ${event.kind} ${event.externalId}`,
      lines: [
        { accountId: debit, debit: source.amount },
        { accountId: credit, credit: source.amount },
      ],
    });
    await repo(inner, PosTransaction).update(source.id, { journalEntryId: entry.id });
    if (parent) await repo(inner, PosTransaction).update(parent.id, { refunded: parent.refunded.plus(source.amount) });
    return source.id;
  });
}
export async function correctTransaction(
  ctx: Context,
  input: { transactionId: string; expectedVersion: number; date: string; reason: string },
) {
  const first = await repo(ctx, PosTransaction).get(input.transactionId),
    location = await repo(ctx, PosLocation).get(first.locationId);
  const parent = first.paymentId ? await repo(ctx, PosTransaction).get(first.paymentId) : first;
  return withLock(ctx, 'pos-payment:' + paymentKey(location.merchantId, parent.externalId), async () => {
    const source = await repo(ctx, PosTransaction).lock(first.id);
    if (source.version !== input.expectedVersion)
      throw new Conflict('POS source changed', 'Reload its current version.');
    if (
      source.status !== 'posted' ||
      !source.journalEntryId ||
      input.date < source.date ||
      input.date > todayLocal(ctx.now()) ||
      !source.refunded.isZero()
    )
      throw new StateError(
        'POS correction is not permitted',
        'Use a current open correction date and cancel all refunds before correcting a payment.',
      );
    if (source.kind === 'payment') {
      const later = await repo(ctx, PosTransaction).list({
        where: { paymentId: source.id, cancelledDate: { $gt: input.date } },
        limit: 1,
      });
      if (later.items.length)
        throw new StateError(
          'Payment correction precedes a refund correction',
          'Choose a date on or after every refund correction.',
        );
    }
    await reverseSourceEntry(ctx, {
      id: source.journalEntryId,
      sourceEntity: PosTransaction.name,
      sourceId: source.id,
      date: input.date,
    });
    return internalWrite(ctx, PosTransaction, async (inner) => {
      const updated = await repo(inner, PosTransaction).update(source.id, {
        status: 'cancelled',
        cancelledDate: input.date,
        cancelReason: input.reason,
      });
      if (source.paymentId) {
        const original = await repo(inner, PosTransaction).lock(source.paymentId);
        await repo(inner, PosTransaction).update(original.id, { refunded: original.refunded.minus(source.amount) });
      }
      return { id: updated.id, version: updated.version, status: updated.status };
    });
  });
}
