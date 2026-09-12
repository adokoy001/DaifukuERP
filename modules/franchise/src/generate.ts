import type { Decimal} from '@daifuku/kernel';
import { Conflict, repo, saveLines, StateError, submitDocument, withLock, type Context, type Infer } from '@daifuku/kernel';
import { SalesInvoice, SalesInvoiceLine } from '@daifuku/mod-sales';
import { PurchaseInvoice, PurchaseInvoiceLine } from '@daifuku/mod-purchase';
import type { z } from 'zod';
import type { generateInput } from './contract.ts';
import { contractSnapshot } from './contract.ts';
import { FranchiseAgreement, FranchiseSettlement } from './entities.ts';
import { monthBounds, royalty } from './calculation.ts';
import { writeFranchise } from './internal.ts';
export function result(row: Infer<typeof FranchiseSettlement>) { return { id: row.id, version: row.version, status: row.status, invoiceId: row.salesInvoiceId ?? row.purchaseInvoiceId, paymentId: row.paymentId }; }
function snapshot(row: Infer<typeof FranchiseAgreement>) { return contractSnapshot.parse({ ...row, rate: row.rate.toString(), fixedAmount: row.fixedAmount.toString() }); }
export async function generateFranchise(ctx: Context, input: z.infer<typeof generateInput>) {
 return withLock(ctx, `franchise:${input.agreementId}:${input.month}`, async () => {
  const agreement = await repo(ctx, FranchiseAgreement).lock(input.agreementId, 'read');
  if (agreement.version !== input.expectedAgreementVersion) throw new Conflict('FC契約が変更されました。', '契約を読み込み直してください。');
  const existing = (await repo(ctx, FranchiseSettlement).list({ where: { agreementId: agreement.id, month: input.month, status: { $ne: 'cancelled' } }, limit: 1 })).items[0];
  if (existing) { if (existing.grossSales.toString() !== input.grossSales || existing.netSales.toString() !== input.netSales || existing.sourceReference !== input.sourceReference || existing.date !== input.date || existing.dueDate !== input.dueDate) throw new Conflict('同じ契約・月に異なる精算資料が存在します。', '現在の精算を確認し、訂正は理由を記録して取消後に再作成してください。'); return result(existing); }
  const contract = snapshot(agreement), fee = royalty(contract, input.month, input.grossSales, input.netSales), end = monthBounds(input.month).to;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(ctx.now());
  if (fee.lte(0) || input.date < end || input.date > today || input.dueDate < input.date) throw new StateError('精算額または請求日・期日が不正です。', '月末以降かつ本日以前の請求日、請求日以降の期日と正の精算額を指定してください。ゼロ円月は請求を生成しません。');
  const invoice = await createInvoice(ctx, agreement, input, fee);
  return writeFranchise(ctx, async (inner) => result(await repo(inner, FranchiseSettlement).create({ agreementId: agreement.id, month: input.month, direction: agreement.direction, status: 'invoiced', grossSales: input.grossSales, netSales: input.netSales, sourceReference: input.sourceReference, contract, fee, total: invoice.total, tax: invoice.taxTotal, date: input.date, dueDate: input.dueDate, ...(agreement.direction === 'bill' ? { salesInvoiceId: invoice.id } : { purchaseInvoiceId: invoice.id }) })));
 });
}
async function createInvoice(ctx: Context, agreement: Infer<typeof FranchiseAgreement>, input: z.infer<typeof generateInput>, fee: Decimal) {
 const header = { partnerId: agreement.partnerId, date: input.date, dueDate: input.dueDate, priceIncludesTax: false, note: `FC精算 ${agreement.code} ${input.month} / ${input.sourceReference}` }, line = { description: `FC精算 ${agreement.name} ${input.month}`, quantity: '1', unitPrice: fee, taxCategory: agreement.taxCategory };
 if (agreement.direction === 'bill') { const invoice = await repo(ctx, SalesInvoice).create(header); await saveLines(ctx, SalesInvoice, invoice.id, { [SalesInvoiceLine.name]: [line] }); return submitDocument(ctx, SalesInvoice, invoice.id); }
 const invoice = await repo(ctx, PurchaseInvoice).create(header); await saveLines(ctx, PurchaseInvoice, invoice.id, { [PurchaseInvoiceLine.name]: [{ ...line, accountId: agreement.expenseAccountId }] }); return submitDocument(ctx, PurchaseInvoice, invoice.id);
}
