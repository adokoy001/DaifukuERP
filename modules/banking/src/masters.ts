import { StateError, repo, type Context } from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import type { z } from 'zod';
import type { bankAccountInput, bankPayeeInput } from './contract.ts';
import { BankAccount, BankPayee } from './entities.ts';
import { bankLock, bankWrite, checkVersion } from './internal.ts';
import { accountView, payeeView } from './views.ts';
import { assertBankCharacters } from './zengin.ts';
export async function saveAccount(ctx: Context, input: z.infer<typeof bankAccountInput>) {
  return bankLock(ctx, async () => {
    assertBankCharacters(input.holderKana);
    const account = await repo(ctx, Account).get(input.ledgerAccountId);
    if (!account.isActive || account.type !== 'asset')
      throw new StateError('有効な資産科目が必要です。', '預金に対応する勘定科目を指定してください。');
    const { id, expectedVersion, ...values } = input;
    values.accountNumber = values.accountNumber.padStart(7, '0');
    const matching = await repo(ctx, BankAccount).list({
      where: { bankCode: values.bankCode, branchCode: values.branchCode, accountType: values.accountType },
      limit: 500,
    });
    if (
      matching.total > 500 ||
      matching.items.some((row) => row.id !== id && row.accountNumber.padStart(7, '0') === values.accountNumber)
    )
      throw new StateError('同じ銀行口座が登録済みです。', '既存の口座コードを使用してください。');
    if (id) {
      const old = await repo(ctx, BankAccount).lock(id);
      checkVersion(old.version, expectedVersion);
      if (old.code !== values.code)
        throw new StateError('口座コードは変更できません。', '新しい口座を登録してください。');
    } else if (expectedVersion !== undefined)
      throw new StateError('口座 ID が必要です。', '更新対象を指定してください。');
    const { code: _code, ...patch } = values;
    const row = await bankWrite(ctx, BankAccount, (inner) =>
      id
        ? repo(inner, BankAccount).update(id, patch, { expectedVersion: expectedVersion ?? 0 })
        : repo(inner, BankAccount).create(values),
    );
    return accountView(row);
  });
}
export async function savePayee(ctx: Context, input: z.infer<typeof bankPayeeInput>) {
  return bankLock(ctx, async () => {
    assertBankCharacters(input.holderKana);
    const partner = await repo(ctx, Partner).get(input.partnerId);
    if (!partner.isSupplier || !partner.isActive)
      throw new StateError('有効な仕入先が必要です。', '取引先の仕入先・有効設定を確認してください。');
    const { id, expectedVersion, ...values } = input;
    values.accountNumber = values.accountNumber.padStart(7, '0');
    if (id) {
      const old = await repo(ctx, BankPayee).lock(id);
      checkVersion(old.version, expectedVersion);
      if (old.partnerId !== input.partnerId)
        throw new StateError('振込先の取引先は変更できません。', '別の振込先を登録してください。');
    } else if (expectedVersion !== undefined)
      throw new StateError('振込先 ID が必要です。', '更新対象を指定してください。');
    const row = await bankWrite(ctx, BankPayee, (inner) =>
      id
        ? repo(inner, BankPayee).update(id, values, { expectedVersion: expectedVersion ?? 0 })
        : repo(inner, BankPayee).create(values),
    );
    return payeeView(row, partner.name);
  });
}
