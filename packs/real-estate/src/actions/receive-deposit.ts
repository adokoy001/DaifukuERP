// real_estate.receive_deposit (spec AC-4): 敷金の受領. Posts Dr 普通預金 (accountId, default real_estate.accounts.bank →
// payment.accounts.bank) / Cr 預り金 (real_estate.accounts.deposit) through accounting.postFromSource, then records the
// receipt date and entry on the deposit. A returnable deposit is not consideration for a supply (不課税, No.6225): it is
// never invoiced, and the bank line carries no tax category so the 消費税集計表 skips it (the 預り金 line is marked
// out_of_scope for the audit trail; liability lines are not summarised).
import { Decimal, defineAction, isLocalDate, label, repo, snapshot, StateError, ValidationError, type Context, type Infer } from '@daifuku/kernel';
import { postFromSource } from '@daifuku/mod-accounting';
import { Contract } from '@daifuku/mod-contract';
import { Partner } from '@daifuku/mod-partner';
import { z } from 'zod';
import { RealEstateDeposit } from '../entities/deposit.ts';
import { assertDepositLease, withDepositWrite } from '../hooks/deposit.ts';
import { accountIdByCode } from '../load.ts';
import { DEPOSIT_TAX_CATEGORY } from '../services/tax-rule.ts';
import { depositBankCode, loadRealEstateAccounts } from '../settings.ts';

export type DepositRow = Infer<typeof RealEstateDeposit>;

export const localDate = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');
export const decimalString = z.string().refine((s) => Decimal.isDecimalString(s), 'must be a decimal string');

export const receiveDepositInput = z.object({ depositId: z.uuid(), date: localDate, accountId: z.uuid().optional() });
export type ReceiveDepositInput = z.output<typeof receiveDepositInput>;

export const RECEIVED_HINT = 'A deposit can be received only once. Check the linked receipt and deposit ledger; a receipt correction workflow is not supported yet.';

/** Journal description: `敷金受領 CTR-2026-000003 株式会社ウエスト企画`. */
export function depositDescription(kind: '敷金受領' | '敷金返還', contractNumber: string | null, partnerName: string): string {
  return [kind, contractNumber, partnerName].filter((s) => s !== null && s !== '').join(' ');
}

export async function bankAccountId(ctx: Context, accountId: string | undefined): Promise<string> {
  return accountId ?? accountIdByCode(ctx, await depositBankCode(ctx), 'bank');
}

export async function receiveDeposit(ctx: Context, input: ReceiveDepositInput): Promise<DepositRow> {
  const r = repo(ctx, RealEstateDeposit);
  const deposit = await r.lock(input.depositId);
  await assertDepositLease(ctx, { ...deposit });
  if (deposit.journalEntryId !== null || deposit.receivedDate !== null) {
    throw new StateError(`real_estate_deposit ${deposit.id} was already received on ${String(deposit.receivedDate)}`, RECEIVED_HINT, { depositId: deposit.id, journalEntryId: deposit.journalEntryId });
  }
  if (!deposit.amount.gt(0)) throw new ValidationError(`real_estate_deposit ${deposit.id} amount must be greater than 0`, [{ path: 'amount', message: 'must be > 0' }], 'Set the deposit amount, then receive it.');
  const accounts = await loadRealEstateAccounts(ctx);
  const bankId = await bankAccountId(ctx, input.accountId);
  const depositAccountId = await accountIdByCode(ctx, accounts.deposit, 'deposit');
  const contract = await repo(ctx, Contract).get(deposit.contractId);
  const partner = await repo(ctx, Partner).get(deposit.partnerId);
  const entry = await postFromSource(ctx, {
    sourceEntity: RealEstateDeposit.name,
    sourceId: deposit.id,
    date: input.date,
    description: depositDescription('敷金受領', contract.number, partner.name),
    lines: [
      { accountId: bankId, debit: deposit.amount, partnerId: deposit.partnerId, memo: '敷金受領' },
      { accountId: depositAccountId, credit: deposit.amount, partnerId: deposit.partnerId, taxCategory: DEPOSIT_TAX_CATEGORY, memo: '預り金（敷金）' },
    ],
  });
  return withDepositWrite(ctx, (owned) => repo(owned, RealEstateDeposit).update(deposit.id, { receivedDate: input.date, journalEntryId: entry.id }));
}

export const receiveDepositAction = defineAction({
  name: 'real_estate.receive_deposit',
  description: label(
    '敷金を受領します: Dr 普通預金（accountId、省略時は設定 real_estate.accounts.bank）/ Cr 預り金 の仕訳を転記し、敷金台帳に受領日と仕訳を記録します。敷金は返還するので売上ではなく不課税（請求書に載せない）。',
    'Receive a security deposit: posts Dr bank (accountId, default real_estate.accounts.bank) / Cr deposits held and records the date and entry on the deposit. Returnable deposits are not sales (out of scope; never invoiced).',
  ),
  input: receiveDepositInput,
  output: RealEstateDeposit.schemas.json,
  permission: { entity: RealEstateDeposit.name, op: 'update' },
  handler: async (ctx, input) => snapshot({ ...(await receiveDeposit(ctx, input)) }),
});
