// real_estate.return_deposit (spec AC-4): 敷金の返還（原状回復費の控除つき）. v1 returns a deposit in one go: `amount` must be
// the deposit amount (the whole 預り金 is released). Posts, dated `date`:
//   Dr 預り金 amount / Cr 普通預金 amount − deduction (when > 0) / Cr 雑収入 or deductionAccountId deduction (when > 0)
// and records returnedDate, returnedAmount (= cash paid back), deductionAmount and the entry on the deposit. The contract
// need not be ended first (order is free). The deduction line carries no tax category in v1 — whether the kept amount is
// taxable depends on what it pays for (docs/domain/real-estate.md#deposit-deduction, 【未確認】); adjust by journal entry.
// The entry's source is `real_estate_deposit_return`: accounting allows one live entry per (sourceEntity, sourceId), and
// the receipt already holds `real_estate_deposit`.
import { Decimal, defineAction, label, repo, snapshot, StateError, ValidationError, type Context } from '@daifuku/kernel';
import { postFromSource, type LineInput } from '@daifuku/mod-accounting';
import { Contract } from '@daifuku/mod-contract';
import { Partner } from '@daifuku/mod-partner';
import { z } from 'zod';
import { RealEstateDeposit } from '../entities/deposit.ts';
import { withDepositWrite } from '../hooks/deposit.ts';
import { accountIdByCode } from '../load.ts';
import { loadRealEstateAccounts } from '../settings.ts';
import { bankAccountId, decimalString, depositDescription, localDate, type DepositRow } from './receive-deposit.ts';

export const DEPOSIT_RETURN_SOURCE = 'real_estate_deposit_return';

export const returnDepositInput = z.object({
  depositId: z.uuid(),
  date: localDate,
  amount: decimalString,
  deductionAmount: decimalString.optional(),
  deductionAccountId: z.uuid().optional(),
  accountId: z.uuid().optional(),
});
export type ReturnDepositInput = z.output<typeof returnDepositInput>;

function checkedAmounts(deposit: DepositRow, input: ReturnDepositInput): { amount: Decimal; deduction: Decimal } {
  const amount = Decimal.from(input.amount);
  const deduction = Decimal.from(input.deductionAmount ?? '0');
  const issues: { path: string; message: string }[] = [];
  if (!amount.eq(deposit.amount)) issues.push({ path: 'amount', message: `must equal the deposit amount ${deposit.amount.toString()} (v1 returns a deposit in full)` });
  if (deduction.isNegative()) issues.push({ path: 'deductionAmount', message: 'must be >= 0' });
  if (deduction.gt(amount)) issues.push({ path: 'deductionAmount', message: `must be <= amount ${amount.toString()}` });
  if (deposit.receivedDate !== null && input.date < deposit.receivedDate) issues.push({ path: 'date', message: `must be on or after the receipt date ${deposit.receivedDate}` });
  if (issues.length > 0) throw new ValidationError(`real_estate_deposit ${deposit.id} cannot be returned`, issues, 'Pass amount = the deposit amount and the kept part as deductionAmount.');
  return { amount, deduction };
}

async function returnLines(ctx: Context, deposit: DepositRow, input: ReturnDepositInput, amount: Decimal, deduction: Decimal): Promise<LineInput[]> {
  const accounts = await loadRealEstateAccounts(ctx);
  const partnerId = deposit.partnerId;
  const lines: LineInput[] = [{ accountId: await accountIdByCode(ctx, accounts.deposit, 'deposit'), debit: amount, partnerId, memo: '預り金（敷金）返還' }];
  const cash = amount.minus(deduction);
  if (cash.gt(0)) lines.push({ accountId: await bankAccountId(ctx, input.accountId), credit: cash, partnerId, memo: '敷金返還' });
  if (deduction.gt(0)) lines.push({ accountId: input.deductionAccountId ?? (await accountIdByCode(ctx, accounts.deduction, 'deduction')), credit: deduction, partnerId, memo: '敷金から控除（原状回復費）' });
  return lines;
}

export async function returnDeposit(ctx: Context, input: ReturnDepositInput): Promise<DepositRow> {
  const r = repo(ctx, RealEstateDeposit);
  const deposit = await r.lock(input.depositId);
  if (deposit.journalEntryId === null) throw new StateError(`real_estate_deposit ${deposit.id} has not been received`, 'Receive it first with real_estate.receive_deposit.', { depositId: deposit.id });
  if (deposit.returnJournalEntryId !== null) {
    throw new StateError(`real_estate_deposit ${deposit.id} was already returned on ${String(deposit.returnedDate)}`, 'A deposit can be returned only once. Check the linked return and deposit ledger; a return correction workflow is not supported yet.', { depositId: deposit.id, returnJournalEntryId: deposit.returnJournalEntryId });
  }
  const { amount, deduction } = checkedAmounts(deposit, input);
  const contract = await repo(ctx, Contract).get(deposit.contractId);
  const partner = await repo(ctx, Partner).get(deposit.partnerId);
  const entry = await postFromSource(ctx, {
    sourceEntity: DEPOSIT_RETURN_SOURCE,
    sourceId: deposit.id,
    date: input.date,
    description: depositDescription('敷金返還', contract.number, partner.name),
    lines: await returnLines(ctx, deposit, input, amount, deduction),
  });
  return withDepositWrite(ctx, (owned) => repo(owned, RealEstateDeposit).update(deposit.id, { returnedDate: input.date, returnedAmount: amount.minus(deduction), deductionAmount: deduction, returnJournalEntryId: entry.id }));
}

export const returnDepositAction = defineAction({
  name: 'real_estate.return_deposit',
  description: label(
    '敷金を返還します（v1 は全額を一度に精算）: amount = 敷金額、deductionAmount = 原状回復費などで返還しない額。Dr 預り金 / Cr 普通預金（amount − 控除）/ Cr 雑収入または deductionAccountId（控除）を転記し、敷金台帳に記録します。契約の終了（move_out）の前後どちらでも可。',
    'Return a security deposit in full: amount = the deposit, deductionAmount = the part kept (e.g. restoration). Posts Dr deposits held / Cr bank (amount − deduction) / Cr miscellaneous income or deductionAccountId (deduction) and records it on the deposit. Works before or after move_out.',
  ),
  input: returnDepositInput,
  output: RealEstateDeposit.schemas.json,
  permission: { entity: RealEstateDeposit.name, op: 'update' },
  handler: async (ctx, input) => snapshot({ ...(await returnDeposit(ctx, input)) }),
});
