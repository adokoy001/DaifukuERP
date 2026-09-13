import {
  Conflict,
  DOCSTATUS,
  registry,
  repo,
  StateError,
  withLock,
  type Context,
  type HookArgs,
} from '@daifuku/kernel';
import { Contract } from '@daifuku/mod-contract';
import { unitIdOf } from '../load.ts';

/** A rentable unit has one lease for each calendar day. End dates are inclusive. */
async function assertExclusiveLease(ctx: Context, { row }: HookArgs): Promise<void> {
  const unitId = unitIdOf(row);
  if (!unitId || typeof row.startDate !== 'string') return;
  await withLock(ctx, `real-estate-unit:${unitId}`, async () => undefined);
  const endDate = typeof row.endDate === 'string' ? row.endDate : '9999-12-31';
  const others = await repo(ctx, Contract).list({
    where: {
      $and: [
        { 'ext.unitId': unitId, docstatus: DOCSTATUS.submitted },
        { id: { $ne: row.id as string } },
        { startDate: { $lte: endDate } },
        { $or: [{ endDate: null }, { endDate: { $gte: row.startDate } }] },
      ],
    },
    limit: 1,
  });
  if (others.items.length)
    throw new Conflict(
      'This unit already has a lease for the selected dates',
      'End the previous lease before the new lease starts, or select another rentable unit.',
    );
}

export function registerLeasePeriodHooks(): void {
  registry.registerHook(Contract.name, 'before_submit', assertExclusiveLease);
  registry.registerHook(Contract.name, 'before_update', async (ctx, args) => {
    if (args.row.docstatus !== DOCSTATUS.submitted) return;
    if (args.previous && unitIdOf(args.previous) !== unitIdOf(args.row))
      throw new StateError(
        'A submitted lease cannot move to another unit',
        'End this lease and create a new lease for the other unit.',
      );
    await assertExclusiveLease(ctx, args);
  });
}
