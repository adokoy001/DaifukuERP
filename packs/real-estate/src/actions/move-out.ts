// real_estate.move_out (spec AC-4): 退去処理. Sets the lease's endDate through contract.end (the contract module prorates the
// last month to endDate and marks the contract ended once endDate is before this month) and refreshes the unit: it becomes
// vacant once endDate has passed (endDate < today) and no other lease is signed for it. The deposit is returned separately
// with real_estate.return_deposit, before or after.
import { defineAction, DOCSTATUS, label, repo, runAction, StateError, type Context } from '@daifuku/kernel';
import { Contract } from '@daifuku/mod-contract';
import { z } from 'zod';
import { refreshUnitStatus } from '../hooks/unit-status.ts';
import { unitIdOf } from '../load.ts';
import { UNIT_STATUSES } from '../services/rent-roll.ts';
import { LEASE_HINT } from './move-in.ts';
import { localDate } from './receive-deposit.ts';

export const moveOutInput = z.object({ contractId: z.uuid(), endDate: localDate });
export type MoveOutInput = z.output<typeof moveOutInput>;
export const moveOutOutput = z.object({
  contractId: z.uuid(),
  endDate: z.string(),
  contractStatus: z.string(),
  unitId: z.uuid(),
  unitStatus: z.enum(UNIT_STATUSES),
});
export type MoveOutResult = z.output<typeof moveOutOutput>;

export async function moveOut(ctx: Context, input: MoveOutInput): Promise<MoveOutResult> {
  const r = repo(ctx, Contract);
  const contract = await r.get(input.contractId);
  const unitId = unitIdOf(contract);
  if (contract.docstatus !== DOCSTATUS.submitted || unitId === null) {
    throw new StateError(`contract ${contract.number ?? contract.id} is not a submitted lease`, LEASE_HINT, {
      contractId: contract.id,
      docstatus: contract.docstatus,
      unitId,
    });
  }
  await runAction(ctx, 'contract.end', { id: contract.id, endDate: input.endDate });
  const unitStatus = (await refreshUnitStatus(ctx, unitId)) ?? 'vacant';
  const ended = await r.get(contract.id);
  return { contractId: ended.id, endDate: input.endDate, contractStatus: ended.status, unitId, unitStatus };
}

export const moveOutAction = defineAction({
  name: 'real_estate.move_out',
  description: label(
    '退去処理: 賃貸借契約に終了日を設定し（contract.end。終了月は終了日までの日割り）、終了日を過ぎていれば部屋を空室にします。敷金の返還は real_estate.return_deposit で別に行います。',
    'Move-out: sets the lease end date (contract.end; the last month is prorated to it) and marks the unit vacant once the end date has passed. Return the deposit separately with real_estate.return_deposit.',
  ),
  input: moveOutInput,
  output: moveOutOutput,
  permission: { roles: ['sales'] },
  handler: (ctx, input) => moveOut(ctx, input),
});
