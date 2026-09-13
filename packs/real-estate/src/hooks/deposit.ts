// real_estate_deposit guard (spec AC-1/AC-4). The receipt/return fields mirror posted journal entries, so only
// real_estate.receive_deposit / return_deposit (inside withDepositWrite) may write them:
// - create: they are reset (a copied or hand-made row starts un-received); partnerId/unitId default from the lease;
// - update: a patch that changes one of them, or changes the amount of a received deposit → INVALID_STATE;
// - delete: a received deposit cannot be deleted (its journal entry would be orphaned).
// The mark is per Context (one transaction), like the contract module's billing ledger and the kernel's isSavingLines.
import {
  Decimal,
  defineWriteCapability,
  isDecimal,
  isUuid,
  registry,
  repo,
  StateError,
  ValidationError,
  withWriteCapability,
  type Context,
  type HookArgs,
} from '@daifuku/kernel';
import { Contract } from '@daifuku/mod-contract';
import { DEPOSIT_SYSTEM_FIELDS, RealEstateDeposit } from '../entities/deposit.ts';
import { unitIdOf } from '../load.ts';

export const DEPOSIT_LEDGER_HINT =
  'Receipt and return are recorded by real_estate.receive_deposit / real_estate.return_deposit, which also post the journal entries.';

const writers = new WeakMap<Context, number>();
const depositWrite = defineWriteCapability({
  name: 'real-estate-deposit-ledger',
  entity: RealEstateDeposit.name,
  fields: DEPOSIT_SYSTEM_FIELDS,
  operations: ['update'],
});

export async function withDepositWrite<T>(ctx: Context, fn: (owned: Context) => Promise<T>): Promise<T> {
  return withWriteCapability(ctx, depositWrite, async (owned) => {
    writers.set(owned, 1);
    try {
      return await fn(owned);
    } finally {
      writers.delete(owned);
    }
  });
}

export function isDepositWrite(ctx: Context): boolean {
  return (writers.get(ctx) ?? 0) > 0;
}

function asDecimal(v: unknown): Decimal | null {
  if (isDecimal(v)) return v;
  if (typeof v === 'string' && Decimal.isDecimalString(v)) return Decimal.from(v);
  if (typeof v === 'number' && Number.isInteger(v)) return Decimal.from(v);
  return null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if ((a ?? null) === null || (b ?? null) === null) return (a ?? null) === (b ?? null);
  const da = asDecimal(a);
  const db = asDecimal(b);
  return da !== null && db !== null ? da.eq(db) : String(a) === String(b);
}

export async function assertDepositLease(ctx: Context, row: Record<string, unknown>): Promise<void> {
  if (typeof row.contractId !== 'string' || !isUuid(row.contractId)) return;
  const contract = await repo(ctx, Contract).get(row.contractId);
  const unitId = unitIdOf(contract);
  const issues: { path: string; message: string }[] = [];
  if (row.partnerId === undefined) row.partnerId = contract.partnerId;
  if (row.unitId === undefined) row.unitId = unitId;
  if (row.partnerId !== contract.partnerId) issues.push({ path: 'partnerId', message: 'must match the lease partner' });
  if ((row.unitId ?? null) !== unitId) issues.push({ path: 'unitId', message: 'must match the lease unit' });
  if (issues.length)
    throw new ValidationError(
      'The deposit identity does not match its lease',
      issues,
      'Choose the lease partner and unit. Existing unreceived deposits can be deleted and recreated before receipt.',
    );
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (!previous) {
    if (!isDepositWrite(ctx))
      Object.assign(row, {
        receivedDate: null,
        returnedDate: null,
        returnedAmount: '0',
        deductionAmount: '0',
        journalEntryId: null,
        returnJournalEntryId: null,
      });
    await assertDepositLease(ctx, row);
    return;
  }
  if (isDepositWrite(ctx)) return;
  const touched: string[] = [...DEPOSIT_SYSTEM_FIELDS, 'contractId', 'partnerId', 'unitId'].filter(
    (k) => row[k] !== undefined && !sameValue(row[k], previous[k]),
  );
  if (previous.journalEntryId !== null && row.amount !== undefined && !sameValue(row.amount, previous.amount))
    touched.push('amount');
  if (touched.length > 0) {
    throw new StateError(
      `real_estate_deposit ${String(previous.id)}: ${touched.join(', ')} cannot be changed directly`,
      DEPOSIT_LEDGER_HINT,
      { fields: touched },
    );
  }
}

async function beforeDelete(_ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.journalEntryId !== null && row.journalEntryId !== undefined) {
    throw new StateError(
      `real_estate_deposit ${String(row.id)} has been received and cannot be deleted`,
      'Return the deposit with real_estate.return_deposit instead.',
      { journalEntryId: row.journalEntryId },
    );
  }
}

export function registerDepositHooks(): void {
  registry.registerHook(RealEstateDeposit.name, 'before_validate', beforeValidate);
  registry.registerHook(RealEstateDeposit.name, 'before_delete', beforeDelete);
}
