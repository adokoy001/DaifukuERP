// contract.end (spec AC-2): sets endDate on a submitted contract (allowOnSubmit update). endDate must be on or after
// startDate. The status follows from the header's before_update (hooks/recalc.ts): 'ended' when endDate is before the
// first day of today's month, otherwise 'active' (so moving endDate into the future re-activates the contract).
// Invoices already generated past the new endDate are not adjusted (credit notes are out of scope).
import { defineAction, DOCSTATUS, isLocalDate, label, repo, snapshot, StateError, type Context } from '@daifuku/kernel';
import { z } from 'zod';
import { Contract } from '../entities/contract.ts';
import { assertDateRange } from '../hooks/recalc.ts';
import type { ContractRow } from '../load.ts';

export const END_STATE_HINT = 'Only submitted contracts can be ended; on a draft set endDate with contract.update, a cancelled contract is read-only.';

export const endContractInput = z.object({
  id: z.uuid(),
  endDate: z.string().refine(isLocalDate, 'must be YYYY-MM-DD'),
});
export type EndContractInput = z.output<typeof endContractInput>;

export async function endContract(ctx: Context, input: EndContractInput): Promise<ContractRow> {
  const r = repo(ctx, Contract);
  const contract = await r.lock(input.id);
  if (contract.docstatus !== DOCSTATUS.submitted) {
    throw new StateError(`contract ${contract.number ?? contract.id} is not submitted (docstatus ${contract.docstatus})`, END_STATE_HINT, { id: contract.id, docstatus: contract.docstatus });
  }
  assertDateRange(contract.startDate, input.endDate);
  return r.update(contract.id, { endDate: input.endDate });
}

export const endContractAction = defineAction({
  name: 'contract.end',
  description: label(
    '確定済みの契約に終了日（endDate、開始日以降）を設定します。終了日が今月 1 日より前なら状態は ended、以降なら active。終了月の請求は終了日までの日割りになります。',
    'Sets endDate (on or after startDate) on a submitted contract. Status becomes ended when endDate is before the first day of the current month, active otherwise. The last month is prorated to endDate.',
  ),
  input: endContractInput,
  output: Contract.schemas.json,
  permission: { entity: Contract.name, op: 'update' },
  handler: async (ctx, input) => snapshot({ ...(await endContract(ctx, input)) }),
});
