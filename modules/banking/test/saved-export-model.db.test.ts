import fc from 'fast-check';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { repo, newId } from '@daifuku/kernel';
import { JournalEntry } from '@daifuku/mod-accounting';
import { Payment } from '@daifuku/mod-payment';
import { bankPayeeView, bankTransferDetail, bankTransferExportOutput, bankTransferView } from '../src/contract.ts';
import { bankingFixture, type BankFixture } from './fixture.ts';
let f: BankFixture;
beforeAll(async () => { f = await bankingFixture(); });
afterAll(async () => { await f.db.close(); });
const ledger = () => f.run(async (ctx) => ({ payments: await repo(ctx, Payment).count(), journals: await repo(ctx, JournalEntry).count() }));
it.each([{ format: 'canonical_csv', lineEnding: 'crlf' }, { format: 'zengin120', lineEnding: 'none' }, { format: 'zengin120', lineEnding: 'crlf' }] as const)('AC-3 / BANK-SAVED-01 $format $lineEnding freezes bytes across master edits and rejects cancelled downloads', async ({ format, lineEnding }) => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 9_999_999 }), fc.integer({ min: 0, max: 9_999_999 }), async (amount, accountNumber) => {
    const invoice = await f.invoice('pay', String(amount));
    const input = { requestId: newId(), bankAccountId: f.account.id, accountVersion: f.account.version, transferDate: '2026-09-20', items: [{ invoiceId: invoice.id, expectedVersion: invoice.version, expectedBalance: String(amount), payeeId: f.payee.id, payeeVersion: f.payee.version }] };
    const batch = await f.action('prepare_transfer', input, bankTransferDetail), baseline = await ledger();
    const request = { batchId: batch.id, expectedVersion: batch.version, format, lineEnding };
    const original = await f.action('export_transfer', request, bankTransferExportOutput);
    expect(original.sentToBank).toBe(false); expect(original.bytes.length).toBeGreaterThan(0);
    f.payee = await f.action('save_payee', { ...f.payeeInput, id: f.payee.id, expectedVersion: f.payee.version, accountNumber: String(accountNumber), holderKana: 'ﾍﾝｺｳｺﾞ' }, bankPayeeView);
    expect(await f.action('export_transfer', request, bankTransferExportOutput)).toEqual(original);
    expect((await f.action('transfer_detail', { batchId: batch.id }, bankTransferDetail)).snapshot).toEqual(batch.snapshot);
    // No new financial event occurs on either initial download or re-download.
    expect(await ledger()).toEqual(baseline);
    const cancelled = await f.action('cancel_transfer', { batchId: batch.id, expectedVersion: original.batch.version, reason: 'Generated unsent cancellation' }, bankTransferView);
    expect(cancelled.state).toBe('cancelled');
    await expect(f.action('export_transfer', { ...request, expectedVersion: cancelled.version }, bankTransferExportOutput)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await ledger()).toEqual(baseline);
  }), { seed: Number(process.env['PBT_SEED'] ?? 730305), numRuns: Number(process.env['PBT_RUNS'] ?? 4), ...(process.env['PBT_PATH'] ? { path: process.env['PBT_PATH'] } : {}) });
}, 180_000);
