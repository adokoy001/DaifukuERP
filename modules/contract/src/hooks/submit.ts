// contract before_submit (spec AC-2): at least one line, endDate >= startDate, status from endDate and today
// ('active' for a running or future contract; a contract whose endDate is already before this month is 'ended' — its
// months up to endDate stay billable) and nextPeriod = the month of startDate. The kernel writes these fields together
// with docstatus and the CTR- number.
import { isLocalDate, registry, repo, todayLocal, ValidationError, type Context, type HookArgs } from '@daifuku/kernel';
import { ContractLine } from '../entities/contract-line.ts';
import { Contract } from '../entities/contract.ts';
import { periodOf, statusFor } from '../services/periods.ts';
import { assertDateRange } from './recalc.ts';

export const NO_LINES_HINT = 'Add at least one contract_line (lines.contract_line), then submit.';

async function beforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const id = row.id as string;
  const lines = await repo(ctx, ContractLine).count({ contractId: id });
  if (lines === 0)
    throw new ValidationError(
      `contract ${id} has no lines`,
      [{ path: 'lines', message: 'at least 1 line is required' }],
      NO_LINES_HINT,
    );
  assertDateRange(row.startDate, row.endDate);
  const startDate = typeof row.startDate === 'string' && isLocalDate(row.startDate) ? row.startDate : null;
  if (startDate === null)
    throw new ValidationError(
      `contract ${id} has no valid startDate`,
      [{ path: 'startDate', message: 'required' }],
      'Set startDate, then submit.',
    );
  const endDate = typeof row.endDate === 'string' && isLocalDate(row.endDate) ? row.endDate : null;
  Object.assign(row, { status: statusFor(endDate, todayLocal(ctx.now())), nextPeriod: periodOf(startDate) });
}

export function registerSubmitHook(): void {
  registry.registerHook(Contract.name, 'before_submit', beforeSubmit);
}
