import {
  cancelDocument,
  Conflict,
  DOCSTATUS,
  repo,
  saveLines,
  StateError,
  submitDocument,
  type Context,
  type Infer,
} from '@daifuku/kernel';
import { Payment, PaymentAllocation } from '@daifuku/mod-payment';
import { SalesInvoice } from '@daifuku/mod-sales';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import type { z } from 'zod';
import type { cancelInput, settleInput } from './contract.ts';
import { contractSnapshot } from './contract.ts';
import { FranchiseSettlement } from './entities.ts';
import { result } from './generate.ts';
import { writeFranchise } from './internal.ts';
export async function currentInvoice(ctx: Context, row: Infer<typeof FranchiseSettlement>) {
  if (row.salesInvoiceId) return repo(ctx, SalesInvoice).lock(row.salesInvoiceId, 'read');
  if (row.purchaseInvoiceId) return repo(ctx, PurchaseInvoice).lock(row.purchaseInvoiceId, 'read');
  throw new StateError('精算に請求書がありません。', '生成処理の原資料を確認してください。');
}
export async function settleFranchise(ctx: Context, input: z.infer<typeof settleInput>) {
  const row = await repo(ctx, FranchiseSettlement).lock(input.settlementId);
  if (row.version !== input.expectedVersion)
    throw new Conflict('精算が変更されました。', '最新の残高を読み込み直してください。');
  if (row.status === 'cancelled')
    throw new StateError('取消済み精算は入出金できません。', '新しい精算を作成してください。');
  if (row.paymentId) {
    const payment = await repo(ctx, Payment).get(row.paymentId);
    if (payment.date !== input.date || payment.accountId !== input.accountId || payment.method !== input.method)
      throw new Conflict('別の入出金条件で精算済みです。', '保存済み入出金を確認してください。');
    return result(row);
  }
  const invoice = await currentInvoice(ctx, row);
  if (!invoice.balance.eq(input.expectedBalance))
    throw new Conflict(
      '請求残高が確認時点から変わりました。',
      '最新の残高を取得し、金額を確認してから入出金してください。',
    );
  const contract = contractSnapshot.parse(row.contract);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(ctx.now());
  if (
    invoice.docstatus !== DOCSTATUS.submitted ||
    invoice.balance.lte(0) ||
    input.date < row.date ||
    input.date > today
  )
    throw new StateError(
      '入出金対象または日付が不正です。',
      '確定済み未決済請求の請求日以降・本日以前の日付を指定してください。',
    );
  const payment = await repo(ctx, Payment).create({
    direction: row.direction === 'bill' ? 'receive' : 'pay',
    partnerId: contract.partnerId,
    date: input.date,
    amount: invoice.balance,
    accountId: input.accountId,
    method: input.method,
    note: `FC精算 ${contract.code} ${row.month}`,
  });
  await saveLines(ctx, Payment, payment.id, {
    [PaymentAllocation.name]: [
      {
        invoiceEntity: row.salesInvoiceId ? SalesInvoice.name : PurchaseInvoice.name,
        invoiceId: invoice.id,
        amount: invoice.balance,
      },
    ],
  });
  await submitDocument(ctx, Payment, payment.id);
  return writeFranchise(ctx, async (inner) =>
    result(await repo(inner, FranchiseSettlement).update(row.id, { status: 'paid', paymentId: payment.id })),
  );
}
export async function cancelFranchise(ctx: Context, input: z.infer<typeof cancelInput>) {
  const row = await repo(ctx, FranchiseSettlement).lock(input.settlementId);
  if (row.version !== input.expectedVersion || row.status === 'cancelled')
    throw new Conflict('精算が変更されたか取消済みです。', '最新の精算を読み込み直してください。');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(ctx.now());
  if (input.date < row.date || input.date > today)
    throw new StateError('取消日は請求日以降・本日以前にしてください。', '締め期間と入出金履歴も確認してください。');
  return writeFranchise(ctx, async (inner) => {
    if (row.paymentId) {
      const payment = await repo(inner, Payment).get(row.paymentId);
      if (payment.docstatus !== DOCSTATUS.submitted)
        throw new StateError('連動入出金の状態が不正です。', '原資料を確認してください。');
      await cancelDocument(inner, Payment, payment.id, { correctionDate: input.date });
    }
    if (row.salesInvoiceId)
      await cancelDocument(inner, SalesInvoice, row.salesInvoiceId, { correctionDate: input.date });
    else if (row.purchaseInvoiceId)
      await cancelDocument(inner, PurchaseInvoice, row.purchaseInvoiceId, { correctionDate: input.date });
    return result(
      await repo(inner, FranchiseSettlement).update(row.id, {
        status: 'cancelled',
        cancelledDate: input.date,
        cancelReason: input.reason,
      }),
    );
  });
}
