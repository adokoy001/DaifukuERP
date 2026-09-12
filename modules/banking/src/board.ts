import { repo, type Context } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import type { z } from 'zod';
import type { bankBoardInput } from './contract.ts';
import { BankAccount, BankPayee, BankReconciliation, BankStatement, BankTransfer } from './entities.ts';
import { assertBankContext } from './internal.ts';
import { accountView, payeeView, reconciliationView, statementView, transferView } from './views.ts';
export async function bankBoard(ctx: Context, input: z.infer<typeof bankBoardInput>) {
  assertBankContext(ctx);
  if (input.bankAccountId) await repo(ctx, BankAccount).get(input.bankAccountId);
  const where = input.bankAccountId ? { bankAccountId: input.bankAccountId } : {};
  const accounts = await repo(ctx, BankAccount).list({ limit: 500, orderBy: [{ field: 'code' }] });
  const payees = await repo(ctx, BankPayee).list({ limit: 500 });
  const statements = await repo(ctx, BankStatement).list({ where, limit: 100, offset: input.offset, orderBy: [{ field: 'bookedOn', dir: 'desc' }, { field: 'id' }] });
  const reconciliations = await repo(ctx, BankReconciliation).list({ where: { statementId: { $in: statements.items.map((row) => row.id) } }, limit: 500 });
  const active = await repo(ctx, BankReconciliation).list({ where: { statementId: { $in: statements.items.map((row) => row.id) }, state: 'active' }, limit: 100 });
  const transfers = await repo(ctx, BankTransfer).list({ where, limit: 100 });
  const partners = await repo(ctx, Partner).list({ where: { id: { $in: payees.items.map((row) => row.partnerId) } }, limit: 500 });
  const names = new Map(partners.items.map((row) => [row.id, row.name]));
  const matches = new Map(active.items.map((row) => [row.statementId, row]));
  return { accounts: accounts.items.map(accountView), payees: payees.items.map((row) => payeeView(row, names.get(row.partnerId) ?? '')), statements: statements.items.map((row) => statementView(row, matches.get(row.id))), reconciliations: reconciliations.items.map(reconciliationView), transfers: transfers.items.map(transferView), truncated: { accounts: accounts.total > accounts.items.length, payees: payees.total > payees.items.length, statements: statements.total > input.offset + statements.items.length, reconciliations: reconciliations.total > reconciliations.items.length, transfers: transfers.total > transfers.items.length }, statementTotal: statements.total, offset: input.offset };
}
