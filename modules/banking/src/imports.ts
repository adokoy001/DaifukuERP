import { Conflict, StateError, contentHash, repo, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import type { bankImportInput, bankImportCommitInput, BankSource } from './contract.ts';
import { parseStatementCsv, statementTotals } from './csv.ts';
import { BankAccount, BankImport, BankStatement } from './entities.ts';
import { bankLock, bankWrite, checkRequest } from './internal.ts';
const sourceHash = (source: BankSource) => contentHash(JSON.stringify(source));
const identityKey = (accountId: string, externalId: string) => contentHash(JSON.stringify([accountId, externalId]));
async function prepare(ctx: Context, input: z.infer<typeof bankImportInput>) {
  const account = await repo(ctx, BankAccount).get(input.bankAccountId);
  if (!account.active) throw new StateError('無効な銀行口座です。', '有効な口座を選んでください。');
  const rows = parseStatementCsv(input.csv);
  const keys = rows.map((row) => identityKey(account.id, row.externalId));
  const prior = await repo(ctx, BankStatement).list({ where: { identityKey: { $in: keys } }, limit: 500 });
  const found = new Map(prior.items.map((row) => [row.identityKey, row.contentHash]));
  const checked = rows.map((row) => {
    const previous = found.get(identityKey(account.id, row.externalId));
    if (previous && previous !== sourceHash(row))
      throw new Conflict('既存の明細と異なる内容が指定されました。', '同じ externalId の元の取引を確認してください。', {
        externalId: row.externalId,
      });
    return { ...row, duplicate: previous !== undefined };
  });
  return {
    bankAccountId: account.id,
    previewHash: contentHash(JSON.stringify([account.id, account.version, rows])),
    rowCount: rows.length,
    newCount: checked.filter((row) => !row.duplicate).length,
    duplicateCount: checked.filter((row) => row.duplicate).length,
    ...statementTotals(rows),
    rows: checked,
  };
}
export function previewImport(ctx: Context, input: z.infer<typeof bankImportInput>) {
  return bankLock(ctx, () => prepare(ctx, input));
}
export function importCsv(ctx: Context, input: z.infer<typeof bankImportCommitInput>) {
  return bankLock(ctx, async () => {
    const preview = await prepare(ctx, input);
    checkRequest(preview.previewHash, input.previewHash);
    const importKey = contentHash(JSON.stringify([input.bankAccountId, preview.previewHash]));
    const prior = (await repo(ctx, BankImport).list({ where: { importKey }, limit: 1 })).items[0];
    if (prior)
      return {
        importId: prior.id,
        imported: prior.imported,
        duplicates: prior.duplicates,
        previewHash: prior.contentHash,
      };
    const imported = await bankWrite(ctx, BankImport, (inner) =>
      repo(inner, BankImport).create({
        bankAccountId: input.bankAccountId,
        importKey,
        contentHash: preview.previewHash,
        rowCount: preview.rowCount,
        imported: preview.newCount,
        duplicates: preview.duplicateCount,
      }),
    );
    await bankWrite(ctx, BankStatement, async (inner) => {
      for (const { duplicate, ...row } of preview.rows)
        if (!duplicate)
          await repo(inner, BankStatement).create({
            ...row,
            bankAccountId: input.bankAccountId,
            importId: imported.id,
            identityKey: identityKey(input.bankAccountId, row.externalId),
            contentHash: sourceHash(row),
          });
    });
    return {
      importId: imported.id,
      imported: imported.imported,
      duplicates: imported.duplicates,
      previewHash: preview.previewHash,
    };
  });
}
