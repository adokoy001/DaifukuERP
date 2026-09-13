import {
  Conflict,
  DOCSTATUS,
  Decimal,
  StateError,
  contentHash,
  contentHashBytes,
  repo,
  type Context,
  type Infer,
} from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import type { z } from 'zod';
import {
  bankTransferSnapshot,
  type bankTransferInput,
  type bankTransferExportInput,
  type bankTransferCancelInput,
  type BankTransferSnapshot,
} from './contract.ts';
import { BankAccount, BankPayee, BankTransfer, BankTransferReservation } from './entities.ts';
import { assertBankContext, bankLock, bankWrite, checkRequest, checkVersion } from './internal.ts';
import { identity, transferView } from './views.ts';
import { exportBankFile } from './zengin.ts';
type TransferInput = z.infer<typeof bankTransferInput>;
async function makeSnapshot(ctx: Context, input: TransferInput): Promise<BankTransferSnapshot> {
  const account = await repo(ctx, BankAccount).lock(input.bankAccountId);
  checkVersion(account.version, input.accountVersion);
  if (!account.active) throw new StateError('銀行口座が無効です。', '有効な口座を選択してください。');
  if (new Set(input.items.map((row) => row.invoiceId)).size !== input.items.length)
    throw new Conflict('同じ請求書が複数指定されています。', '支払内訳を確認してください。');
  const lines: BankTransferSnapshot['lines'] = [];
  for (const item of [...input.items].sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))) {
    const invoice = await repo(ctx, PurchaseInvoice).lock(item.invoiceId);
    const payee = await repo(ctx, BankPayee).get(item.payeeId);
    checkVersion(invoice.version, item.expectedVersion);
    checkVersion(payee.version, item.payeeVersion);
    if (
      invoice.docstatus !== DOCSTATUS.submitted ||
      invoice.status !== 'open' ||
      !invoice.balance.eq(item.expectedBalance) ||
      invoice.balance.lte(0) ||
      input.transferDate < invoice.date ||
      !payee.active ||
      payee.partnerId !== invoice.partnerId
    )
      throw new Conflict('請求残高または振込先が変更されています。', '最新の支払内訳を確認してください。');
    const partner = await repo(ctx, Partner).get(invoice.partnerId);
    if (!partner.isActive || !partner.isSupplier)
      throw new StateError('振込先取引先が無効です。', '仕入先の設定を確認してください。');
    lines.push({
      invoiceId: invoice.id,
      invoiceVersion: invoice.version,
      number: invoice.number,
      partnerId: invoice.partnerId,
      partnerName: partner.name,
      payeeId: payee.id,
      payeeVersion: payee.version,
      amount: invoice.balance.toString(),
      payee: identity(payee),
    });
  }
  return bankTransferSnapshot.parse({
    account: {
      ...identity(account),
      name: account.name,
      ledgerAccountId: account.ledgerAccountId,
      requesterCode: account.requesterCode,
    },
    lines,
  });
}
export function prepareTransfer(ctx: Context, input: TransferInput) {
  return bankLock(ctx, async () => {
    const requestHash = contentHash(JSON.stringify(input));
    const prior = (await repo(ctx, BankTransfer).list({ where: { requestId: input.requestId }, limit: 1 })).items[0];
    if (prior) {
      checkRequest(prior.requestHash, requestHash);
      return { ...transferView(prior), snapshot: bankTransferSnapshot.parse(prior.snapshot) };
    }
    const snapshot = await makeSnapshot(ctx, input);
    if (
      await repo(ctx, BankTransferReservation).count({
        invoiceId: { $in: input.items.map((item) => item.invoiceId) },
        active: true,
      })
    )
      throw new Conflict(
        '支払ファイルに登録済みの請求書があります。',
        '既存ファイルと銀行側の依頼状況を確認してください。',
      );
    const total = snapshot.lines.reduce((sum, row) => sum.plus(row.amount), Decimal.zero());
    if (total.gt('999999999999'))
      throw new StateError('合計金額が上限を超えています。', '支払ファイルを分割してください。');
    const batch = await bankWrite(ctx, BankTransfer, (inner) =>
      repo(inner, BankTransfer).create({
        requestId: input.requestId,
        requestHash,
        bankAccountId: input.bankAccountId,
        accountVersion: input.accountVersion,
        transferDate: input.transferDate,
        state: 'prepared',
        itemCount: snapshot.lines.length,
        total,
        snapshot,
      }),
    );
    await bankWrite(ctx, BankTransferReservation, async (inner) => {
      for (const item of snapshot.lines)
        await repo(inner, BankTransferReservation).create({
          batchId: batch.id,
          invoiceId: item.invoiceId,
          active: true,
        });
    });
    return { ...transferView(batch), snapshot };
  });
}
export async function transferDetail(ctx: Context, batchId: string) {
  assertBankContext(ctx);
  const batch = await repo(ctx, BankTransfer).get(batchId);
  return { ...transferView(batch), snapshot: bankTransferSnapshot.parse(batch.snapshot) };
}
async function validateFirstExport(ctx: Context, batch: Infer<typeof BankTransfer>) {
  const saved = bankTransferSnapshot.parse(batch.snapshot);
  const current = await makeSnapshot(ctx, {
    requestId: batch.requestId,
    bankAccountId: batch.bankAccountId,
    accountVersion: batch.accountVersion,
    transferDate: batch.transferDate,
    items: saved.lines.map((line) => ({
      invoiceId: line.invoiceId,
      expectedVersion: line.invoiceVersion,
      expectedBalance: line.amount,
      payeeId: line.payeeId,
      payeeVersion: line.payeeVersion,
    })),
  });
  checkRequest(contentHash(JSON.stringify(saved)), contentHash(JSON.stringify(current)));
  return saved;
}
export function exportTransfer(ctx: Context, input: z.infer<typeof bankTransferExportInput>) {
  return bankLock(ctx, async () => {
    let batch = await repo(ctx, BankTransfer).lock(input.batchId);
    if (batch.state === 'cancelled')
      throw new StateError('取消済みファイルは出力できません。', '履歴を確認してください。');
    if (batch.state === 'exported') {
      if (batch.format !== input.format || batch.lineEnding !== input.lineEnding || !batch.exportBytes)
        throw new Conflict('保存済みファイルと出力条件が異なります。', '初回と同じ出力形式を指定してください。');
    } else {
      checkVersion(batch.version, input.expectedVersion);
      const snapshot = await validateFirstExport(ctx, batch);
      const file = exportBankFile(snapshot, batch.transferDate, input.format, input.lineEnding);
      batch = await bankWrite(ctx, BankTransfer, (inner) =>
        repo(inner, BankTransfer).update(
          batch.id,
          {
            state: 'exported',
            format: input.format,
            lineEnding: input.lineEnding,
            exportBytes: file.bytes,
            contentHash: contentHashBytes(Uint8Array.from(file.bytes)),
          },
          { expectedVersion: batch.version },
        ),
      );
    }
    return {
      batch: transferView(batch),
      filename: `bank-transfer-${batch.id}.${batch.format === 'zengin120' ? 'txt' : 'csv'}`,
      contentType: batch.format === 'zengin120' ? 'application/octet-stream' : 'text/csv; charset=utf-8',
      encoding: batch.format === 'zengin120' ? ('shift_jis' as const) : ('utf-8' as const),
      bytes: batch.exportBytes ?? [],
      sentToBank: false as const,
    };
  });
}
export function cancelTransfer(ctx: Context, input: z.infer<typeof bankTransferCancelInput>) {
  return bankLock(ctx, async () => {
    const batch = await repo(ctx, BankTransfer).lock(input.batchId);
    if (batch.state === 'cancelled') {
      if (batch.cancelReason !== input.reason)
        throw new Conflict('別の理由で取消済みです。', '履歴を確認してください。');
      return transferView(batch);
    }
    checkVersion(batch.version, input.expectedVersion);
    const reservations = await repo(ctx, BankTransferReservation).list({
      where: { batchId: batch.id, active: true },
      limit: 500,
    });
    await bankWrite(ctx, BankTransferReservation, async (inner) => {
      for (const row of reservations.items)
        await repo(inner, BankTransferReservation).update(row.id, { active: false });
    });
    return bankWrite(ctx, BankTransfer, async (inner) =>
      transferView(
        await repo(inner, BankTransfer).update(
          batch.id,
          { state: 'cancelled', cancelReason: input.reason },
          { expectedVersion: batch.version },
        ),
      ),
    );
  });
}
