// real_estate.move_in (spec AC-4): 入居処理 for a submitted lease, in one transaction:
//   1. the unit's status is refreshed (the submitted lease makes it occupied);
//   2. the start month is billed through contract.generate_invoices { period: start month, contractId, submit: false }
//      (the contract module prorates the first month and dates the invoice on the billing day of that month);
//   3. keyMoney > 0 adds a 礼金 line (quantity 1, unit price keyMoney, the unit usage's tax category) to that draft invoice —
//      a direct line write, so sales re-derives the totals once per rate on the whole invoice (hooks/lines.ts touch);
//   4. the invoice is submitted (posted: Dr 売掛金 / Cr sales.accounts.revenue / Cr 仮受消費税);
//   5. depositMonths > 0 creates the deposit row (amount = months × the lease's monthly lines, rounded with the contract's
//      rounding mode to the currency scale) and, with depositReceivedDate, receives it (real_estate.receive_deposit).
// A second move_in for the same lease is refused (the start month is already billed).
import { Decimal, defineAction, DOCSTATUS, currencyScale, getCompany, label, repo, runAction, StateError, ValidationError, type Context } from '@daifuku/kernel';
import { Contract, ContractBilling, ContractLine, generateInvoicesOutput, type ContractRow } from '@daifuku/mod-contract';
import { Product } from '@daifuku/mod-product';
import { loadInvoiceLines, SalesInvoice, SalesInvoiceLine } from '@daifuku/mod-sales';
import { z } from 'zod';
import { RealEstateDeposit } from '../entities/deposit.ts';
import { RealEstateUnit } from '../entities/unit.ts';
import { refreshUnitStatus } from '../hooks/unit-status.ts';
import { extDecimal, unitIdOf } from '../load.ts';
import { rentTaxCategory, type RentTaxCategory } from '../services/tax-rule.ts';
import { localDate, receiveDeposit } from './receive-deposit.ts';

export const KEY_MONEY_PRODUCT_CODE = 'KEY_MONEY';
export const KEY_MONEY_DESCRIPTION = '礼金';

export const moveInInput = z.object({ contractId: z.uuid(), depositReceivedDate: localDate.optional(), accountId: z.uuid().optional() });
export type MoveInInput = z.output<typeof moveInInput>;
export const moveInOutput = z.object({ invoiceId: z.uuid(), number: z.string().nullable(), total: z.string(), depositId: z.uuid().optional() });
export type MoveInResult = z.output<typeof moveInOutput>;

export const LEASE_HINT = 'move_in needs a submitted, active contract with ext.unitId (賃貸借契約 → 部屋・区画).';

/** The lease's unit id; INVALID_STATE unless the contract is submitted, active and bound to a unit. */
export function assertLease(contract: ContractRow): string {
  const unitId = unitIdOf(contract);
  if (contract.docstatus !== DOCSTATUS.submitted || contract.status !== 'active' || unitId === null) {
    throw new StateError(`contract ${contract.number ?? contract.id} is not an active lease (docstatus ${contract.docstatus}, status ${contract.status}, unit ${unitId ?? 'none'})`, LEASE_HINT, { contractId: contract.id, docstatus: contract.docstatus, status: contract.status, unitId });
  }
  return unitId;
}

async function addKeyMoneyLine(ctx: Context, invoiceId: string, keyMoney: Decimal, taxCategory: RentTaxCategory): Promise<void> {
  const lines = await loadInvoiceLines(ctx, invoiceId);
  const seq = Math.max(0, ...lines.map((l) => l.seq)) + 1;
  const product = (await repo(ctx, Product).list({ where: { code: KEY_MONEY_PRODUCT_CODE }, limit: 1 })).items[0];
  await repo(ctx, SalesInvoiceLine).create({ invoiceId, seq, productId: product?.id ?? null, description: KEY_MONEY_DESCRIPTION, quantity: Decimal.from(1), unitPrice: keyMoney, taxCategory });
}

/** Deposit of the lease: the existing row, or a new one when depositMonths > 0; null when the lease takes no deposit. */
async function leaseDeposit(ctx: Context, contract: ContractRow, unitId: string): Promise<string | null> {
  const r = repo(ctx, RealEstateDeposit);
  const existing = (await r.list({ where: { contractId: contract.id }, limit: 1 })).items[0];
  if (existing) return existing.id;
  const months = extDecimal(contract, 'depositMonths');
  if (!months.gt(0)) return null;
  const lines = (await repo(ctx, ContractLine).list({ where: { contractId: contract.id }, limit: 500 })).items;
  const monthly = Decimal.sum(lines.map((l) => l.amount));
  const scale = currencyScale((await getCompany(ctx)).currency);
  const created = await r.create({ contractId: contract.id, partnerId: contract.partnerId, unitId, amount: months.times(monthly).round(contract.roundingMode, scale) });
  return created.id;
}

export async function moveIn(ctx: Context, input: MoveInInput): Promise<MoveInResult> {
  const contract = await repo(ctx, Contract).lock(input.contractId);
  const unitId = assertLease(contract);
  const unit = await repo(ctx, RealEstateUnit).get(unitId);
  const period = contract.startDate.slice(0, 7);
  const billed = (await repo(ctx, ContractBilling).list({ where: { contractId: contract.id, period }, limit: 1 })).items[0];
  if (billed) throw new StateError(`contract ${contract.number ?? contract.id} has already moved in (${period} is billed)`, 'Bill later months with contract.generate_invoices.', { contractId: contract.id, period, invoiceId: billed.invoiceId });
  await refreshUnitStatus(ctx, unitId);
  const generated = generateInvoicesOutput.parse(await runAction(ctx, 'contract.generate_invoices', { period, contractId: contract.id, submit: false }));
  const created = generated.created[0];
  if (!created) throw new StateError(`contract ${contract.number ?? contract.id}: no invoice for ${period} (${generated.skipped[0]?.reason ?? 'unknown'})`, LEASE_HINT, { skipped: generated.skipped });
  const keyMoney = extDecimal(contract, 'keyMoney');
  if (keyMoney.gt(0)) await addKeyMoneyLine(ctx, created.invoiceId, keyMoney, rentTaxCategory(unit.usage, contract));
  await runAction(ctx, 'sales_invoice.submit', { id: created.invoiceId });
  const invoice = await repo(ctx, SalesInvoice).get(created.invoiceId);
  const depositId = await leaseDeposit(ctx, contract, unitId);
  if (input.depositReceivedDate !== undefined) {
    if (depositId === null) throw new ValidationError(`contract ${contract.number ?? contract.id} takes no deposit`, [{ path: 'depositReceivedDate', message: 'the lease has depositMonths 0' }], 'Omit depositReceivedDate, or set ext.depositMonths on the lease before submitting it.');
    await receiveDeposit(ctx, { depositId, date: input.depositReceivedDate, ...(input.accountId ? { accountId: input.accountId } : {}) });
  }
  return { invoiceId: invoice.id, number: invoice.number, total: invoice.total.toString(), ...(depositId ? { depositId } : {}) };
}

export const moveInAction = defineAction({
  name: 'real_estate.move_in',
  description: label(
    '入居処理: 確定済みの賃貸借契約（ext.unitId あり）について、部屋を入居中にし、開始月の家賃請求書を作り（日割り）、礼金があれば同じ請求書に礼金行を足して確定・転記し、敷金月数があれば敷金台帳を作ります（depositReceivedDate を渡すと受領まで）。',
    'Move-in for a submitted lease (contract with ext.unitId): marks the unit occupied, bills the start month (prorated), adds a key-money line to that invoice when keyMoney > 0, submits it, and creates the deposit when depositMonths > 0 (received when depositReceivedDate is given).',
  ),
  input: moveInInput,
  output: moveInOutput,
  permission: { roles: ['sales'] },
  handler: (ctx, input) => moveIn(ctx, input),
});
