import { DOCSTATUS, Conflict, StateError, cancelDocument, contentHash, repo, saveLines, submitDocument, todayLocal, type Context, type Infer } from '@daifuku/kernel';
import { Payment, PaymentAllocation } from '@daifuku/mod-payment';
import { SalesInvoice } from '@daifuku/mod-sales';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import type { z } from 'zod';
import type { bankReconcileInput, bankUndoInput } from './contract.ts';
import { BankAccount, BankReconciliation, BankStatement } from './entities.ts';
import { bankLock, bankWrite, checkRequest, checkVersion } from './internal.ts';
import { reconciliationView } from './views.ts';
type ReconcileInput = z.infer<typeof bankReconcileInput>;
async function existingPayment(ctx: Context, input: ReconcileInput, statement: Infer<typeof BankStatement>, accountId: string) {
  const payment = await repo(ctx, Payment).lock(input.targetId);
  checkVersion(payment.version, input.targetVersion);
  if (payment.docstatus !== DOCSTATUS.submitted || payment.currency !== 'JPY' || payment.method !== 'bank_transfer' || payment.direction !== statement.direction || payment.accountId !== accountId || !payment.amount.eq(statement.amount) || !payment.amount.eq(input.expectedBalance)) throw new StateError('既存入出金が明細と一致しません。', '確定済み、振込、方向、金額、預金科目を再確認してください。');
  if (await repo(ctx, BankReconciliation).count({ paymentId: payment.id, state: 'active' })) throw new Conflict('この入出金は別の銀行明細と照合済みです。', '既存の照合を確認してください。');
  return payment.id;
}
async function createPayment(ctx: Context, input: ReconcileInput, statement: Infer<typeof BankStatement>, accountId: string) {
  const entity = statement.direction === 'receive' ? SalesInvoice : PurchaseInvoice;
  const invoice = await repo(ctx, entity).lock(input.targetId);
  const paymentDate = input.paymentDate ?? statement.bookedOn;
  checkVersion(invoice.version, input.targetVersion);
  if (!invoice.balance.eq(input.expectedBalance)) throw new Conflict('請求残高が変更されました。', '候補を再取得して残高を確認してください。');
  if (invoice.docstatus !== DOCSTATUS.submitted || invoice.status !== 'open' || invoice.balance.lt(statement.amount) || paymentDate < invoice.date || paymentDate < statement.bookedOn || paymentDate > todayLocal(ctx.now())) throw new StateError('未決済の請求残高と記帳日を確認してください。', '明細日・請求日以降、本日以前、請求残高以内で記帳します。再照合では訂正取消日以降の記帳日を明示してください。');
  const payment = await repo(ctx, Payment).create({ direction: statement.direction, partnerId: invoice.partnerId, date: paymentDate, amount: statement.amount, method: 'bank_transfer', accountId, note: `銀行明細 ${statement.externalId} / 明細日 ${statement.bookedOn}` });
  await saveLines(ctx, Payment, payment.id, { [PaymentAllocation.name]: [{ invoiceEntity: entity.name, invoiceId: invoice.id, amount: statement.amount }] });
  await submitDocument(ctx, Payment, payment.id);
  return payment.id;
}
export function reconcile(ctx: Context, input: ReconcileInput) {
  return bankLock(ctx, async () => {
    const requestHash = contentHash(JSON.stringify(input));
    const prior = (await repo(ctx, BankReconciliation).list({ where: { requestId: input.requestId }, limit: 1 })).items[0];
    if (prior) { checkRequest(prior.requestHash, requestHash); return reconciliationView(prior); }
    const statement = await repo(ctx, BankStatement).lock(input.statementId);
    if (await repo(ctx, BankReconciliation).count({ statementId: statement.id, state: 'active' })) throw new Conflict('この銀行明細は照合済みです。', '保存済みの照合結果を確認してください。');
    const account = await repo(ctx, BankAccount).get(statement.bankAccountId);
    if (!account.active) throw new StateError('銀行口座が無効です。', '対象口座の設定を確認してください。');
    const paymentId = input.targetKind === 'payment' ? await existingPayment(ctx, input, statement, account.ledgerAccountId) : await createPayment(ctx, input, statement, account.ledgerAccountId);
    return bankWrite(ctx, BankReconciliation, async (inner) => reconciliationView(await repo(inner, BankReconciliation).create({ requestId: input.requestId, requestHash, statementId: statement.id, paymentId, createdPayment: input.targetKind === 'invoice', state: 'active', reason: input.reason })));
  });
}
export function undoReconciliation(ctx: Context, input: z.infer<typeof bankUndoInput>) {
  return bankLock(ctx, async () => {
    const row = await repo(ctx, BankReconciliation).lock(input.reconciliationId);
    if (row.state === 'reversed') {
      if (row.reversedOn !== input.correctionDate || row.reversalReason !== input.reason) throw new Conflict('別の条件で取消済みです。', '保存済み履歴を確認してください。');
      return reconciliationView(row);
    }
    checkVersion(row.version, input.expectedVersion);
    const statement = await repo(ctx, BankStatement).get(row.statementId);
    if (input.correctionDate < statement.bookedOn || input.correctionDate > todayLocal(ctx.now())) throw new StateError('取消日が不正です。', '明細日以降、本日以前の日付を指定してください。');
    return bankWrite(ctx, BankReconciliation, async (inner) => {
      if (row.createdPayment) await cancelDocument(inner, Payment, row.paymentId, { correctionDate: input.correctionDate });
      return reconciliationView(await repo(inner, BankReconciliation).update(row.id, { state: 'reversed', reversedOn: input.correctionDate, reversalReason: input.reason }, { expectedVersion: row.version }));
    });
  });
}
