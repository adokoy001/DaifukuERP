import { DOCSTATUS, repo, type Context } from '@daifuku/kernel';
import { Payment } from '@daifuku/mod-payment';
import { Partner } from '@daifuku/mod-partner';
import { SalesInvoice } from '@daifuku/mod-sales';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import type { BankCandidate } from './contract.ts';
import { BankAccount, BankReconciliation, BankStatement } from './entities.ts';
import { assertBankContext } from './internal.ts';
import { statementView } from './views.ts';
export function candidateReasons(
  amountEqual: boolean,
  date: string,
  bookedOn: string,
  description: string,
  partnerName: string,
) {
  const reasons = [amountEqual ? '金額一致' : '請求残高内の一部入出金'];
  let score = amountEqual ? 60 : 20;
  const distance = Math.abs(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${bookedOn}T00:00:00Z`)) / 86_400_000;
  if (distance === 0) {
    score += 25;
    reasons.push('日付一致');
  } else if (distance <= 7) {
    score += 10;
    reasons.push('日付差7日以内');
  }
  const normalize = (text: string) => text.normalize('NFKC').replaceAll(/\s/gu, '').toUpperCase();
  if (partnerName.length >= 2 && normalize(description).includes(normalize(partnerName))) {
    score += 15;
    reasons.push('摘要に取引先名');
  }
  return { score, reasons };
}
export async function candidates(ctx: Context, statementId: string) {
  assertBankContext(ctx);
  const statement = await repo(ctx, BankStatement).get(statementId);
  const account = await repo(ctx, BankAccount).get(statement.bankAccountId);
  const active = (await repo(ctx, BankReconciliation).list({ where: { statementId, state: 'active' }, limit: 1 }))
    .items[0];
  if (active) return { statement: statementView(statement, active), candidates: [], truncated: false };
  const payments = await repo(ctx, Payment).list({
    where: {
      docstatus: DOCSTATUS.submitted,
      currency: 'JPY',
      method: 'bank_transfer',
      direction: statement.direction,
      amount: statement.amount.toString(),
      accountId: account.ledgerAccountId,
    },
    limit: 500,
  });
  const entity = statement.direction === 'receive' ? SalesInvoice : PurchaseInvoice;
  const invoices = await repo(ctx, entity).list({
    where: {
      docstatus: DOCSTATUS.submitted,
      status: 'open',
      balance: { $gte: statement.amount.toString() },
      date: { $lte: statement.bookedOn },
    },
    limit: 500,
  });
  const reconciled = await repo(ctx, BankReconciliation).list({
    where: { paymentId: { $in: payments.items.map((row) => row.id) }, state: 'active' },
    limit: 500,
  });
  const used = new Set(reconciled.items.map((row) => row.paymentId));
  const ids = [...new Set([...payments.items, ...invoices.items].map((row) => row.partnerId))];
  const names = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 500)
    for (const row of (
      await repo(ctx, Partner).list({ where: { id: { $in: ids.slice(offset, offset + 500) } }, limit: 500 })
    ).items)
      names.set(row.id, row.name);
  const options: BankCandidate[] = payments.items
    .filter((row) => !used.has(row.id))
    .map((row) => ({
      targetKind: 'payment',
      targetId: row.id,
      targetVersion: row.version,
      number: row.number,
      partnerId: row.partnerId,
      partnerName: names.get(row.partnerId) ?? '',
      date: row.date,
      amount: row.amount.toString(),
      balance: row.amount.toString(),
      ...candidateReasons(
        true,
        row.date,
        statement.bookedOn,
        statement.description ?? '',
        names.get(row.partnerId) ?? '',
      ),
    }));
  options.push(
    ...invoices.items.map((row): BankCandidate => ({
      targetKind: 'invoice',
      targetId: row.id,
      targetVersion: row.version,
      number: row.number,
      partnerId: row.partnerId,
      partnerName: names.get(row.partnerId) ?? '',
      date: row.date,
      amount: statement.amount.toString(),
      balance: row.balance.toString(),
      ...candidateReasons(
        row.balance.eq(statement.amount),
        row.date,
        statement.bookedOn,
        statement.description ?? '',
        names.get(row.partnerId) ?? '',
      ),
    })),
  );
  options.sort(
    (a, b) => b.score - a.score || a.targetKind.localeCompare(b.targetKind) || a.targetId.localeCompare(b.targetId),
  );
  return {
    statement: statementView(statement),
    candidates: options.slice(0, 100),
    truncated: options.length > 100 || payments.total > 500 || invoices.total > 500,
  };
}
