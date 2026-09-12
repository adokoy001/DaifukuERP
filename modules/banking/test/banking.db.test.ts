import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, auditTrail, bootstrapTenant, companies, contentHashBytes, newId, repo, runAction, setSetting } from '@daifuku/kernel';
import { JournalEntry } from '@daifuku/mod-accounting';
import { PAYMENT_ACCOUNTS_KEY, Payment, paymentAccountsSchema } from '@daifuku/mod-payment';
import { SalesInvoice } from '@daifuku/mod-sales';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import { z } from 'zod';
import { BankAccount, BankImport, BankReconciliation, BankStatement, BankTransfer } from '../src/index.ts';
import { bankAccountView, bankBoardOutput, bankCandidatesOutput, bankImportPreview, bankImportResult, bankPayeeView, bankReconciliationView, bankTransferDetail, bankTransferExportOutput, bankTransferView } from '../src/contract.ts';
import { bankingFixture, CSV_HEADER, required, type BankFixture } from './fixture.ts';
let f: BankFixture;
beforeAll(async () => { f = await bankingFixture(); });
afterAll(async () => { await f?.db.close(); });
describe('banking immutable import and finance boundary', () => {
  it('previews without mutation and imports once under concurrent retries; stable IDs conflict on changed content', async () => {
    const csv = `${CSV_HEADER}\na,2026-09-02,receive,1000,入金\nb,2026-09-02,pay,400,支払`;
    const preview = await f.action('preview_import', { bankAccountId: f.account.id, csv }, bankImportPreview, f.accounting);
    expect(preview).toMatchObject({ rowCount: 2, newCount: 2, duplicateCount: 0, receiveTotal: '1000', payTotal: '400' });
    expect(await f.run((ctx) => repo(ctx, BankStatement).count())).toBe(0);
    const command = { bankAccountId: f.account.id, csv, previewHash: preview.previewHash };
    const results = await Promise.all([f.action('import_statement_csv', command, bankImportResult, f.accounting), f.action('import_statement_csv', command, bankImportResult, f.accounting)]);
    expect(results[0]).toEqual(results[1]); expect(await f.run((ctx) => repo(ctx, BankImport).count())).toBe(1);
    expect((await f.action('preview_import', { bankAccountId: f.account.id, csv }, bankImportPreview)).duplicateCount).toBe(2);
    await expect(f.action('preview_import', { bankAccountId: f.account.id, csv: csv.replace('1000', '1001') }, bankImportPreview)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.action('import_statement_csv', { ...command, previewHash: '0'.repeat(64) }, bankImportResult)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await f.run((ctx) => repo(ctx, BankStatement).count())).toBe(2);
  });
  it('denies general roles, site/store contexts, relay and cross company/tenant; hides full account from generic output', async () => {
    for (const params of [{ roles: ['viewer'] }, { roles: ['sales'] }, { roles: ['accounting'], accessScope: 'sites' as const, siteIds: [newId()] }, { roles: ['admin'], accessScope: 'stores' as const, storeIds: [newId()] }, { roles: ['accounting'], actor: { type: 'relay' as const, id: newId() } }]) {
      await expect(f.action('board', {}, bankBoardOutput, params)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(f.run((ctx) => repo(ctx, BankStatement).list(), params)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }
    const otherCompanyId = newId();
    await f.db.owner.drizzle.insert(companies).values({ id: otherCompanyId, tenantId: f.db.tenantId, code: 'OTHER', name: '別会社' });
    const other = await bootstrapTenant(f.db.owner, { tenantName: 'Other bank tenant', companyCode: 'OT', companyName: '別テナント', adminEmail: 'other-bank@example.com', adminName: 'Other', adminPassword: 'test-password' });
    for (const params of [{ companyId: otherCompanyId }, { tenantId: other.tenantId, companyId: other.companyId }]) {
      await expect(f.action('preview_import', { bankAccountId: f.account.id, csv: `${CSV_HEADER}\nx,2026-09-01,pay,1,x` }, bankImportPreview, params)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    const output = await f.run((ctx) => runAction(ctx, 'bank_account.get', { id: f.account.id }), f.accounting);
    expect(output).not.toHaveProperty('accountNumber'); expect(output).not.toHaveProperty('requesterCode');
    const board = await f.action('board', {}, bankBoardOutput, f.accounting); expect(board.accounts[0]?.accountNumberMasked).toBe('****543');
    expect(JSON.stringify(board)).not.toContain('9876543');
    const audit = await f.run((ctx) => auditTrail(ctx, BankAccount.name, f.account.id));
    expect(audit.length).toBeGreaterThan(0); expect(JSON.stringify(audit)).not.toContain('9876543'); expect(JSON.stringify(audit)).not.toContain('0123456789');
  });
  it('refuses generic writes/deletes and changes to used account identity', async () => {
    const statement = required((await f.run((ctx) => repo(ctx, BankStatement).list({ limit: 1 }))).items[0]);
    await expect(f.run((ctx) => runAction(ctx, 'bank_statement.update', { id: statement.id, patch: { description: '変更' } }))).rejects.toThrow();
    await expect(f.run((ctx) => repo(ctx, BankStatement).delete(statement.id))).rejects.toThrow();
    await expect(f.action('save_account', { ...f.accountInput, id: f.account.id, expectedVersion: f.account.version, accountNumber: '1234567' }, bankAccountView)).rejects.toThrow('使用済み');
    expect((await f.run((ctx) => repo(ctx, BankAccount).get(f.account.id))).accountNumber).toBe('9876543');
    await expect(f.action('save_account', { ...f.accountInput, code: 'ALIAS' }, bankAccountView)).rejects.toThrow('登録済み');
  });
});
describe('failure and concurrent request recovery', () => {
  it('rolls back draft, allocations, invoice balance and link when posting fails after settlement has begun', async () => {
    const invoice = await f.invoice('receive', '321');
    const imported = await f.importRows('posting-failure,2026-09-05,receive,321,決算設定不備');
    const input = { requestId: newId(), statementId: required(imported.statements[0]).id, targetKind: 'invoice', targetId: invoice.id, targetVersion: invoice.version, expectedBalance: '321', reason: '確認済み' };
    const before = await f.run(async (ctx) => ({ payments: await repo(ctx, Payment).count(), journal: await repo(ctx, JournalEntry).count() }));
    const settings = { cash: '1000', bank: '1100', receivable: '1300', payable: '2100', advanceReceived: '2400', advancePaid: '1900' };
    await f.run((ctx) => setSetting(ctx, PAYMENT_ACCOUNTS_KEY, paymentAccountsSchema, { ...settings, advanceReceived: 'missing' }));
    try { await expect(f.action('reconcile', input, bankReconciliationView)).rejects.toMatchObject({ code: 'INVALID_STATE' }); }
    finally { await f.run((ctx) => setSetting(ctx, PAYMENT_ACCOUNTS_KEY, paymentAccountsSchema, settings)); }
    expect((await f.run((ctx) => repo(ctx, SalesInvoice).get(invoice.id))).balance.toString()).toBe('321');
    expect(await f.run(async (ctx) => ({ payments: await repo(ctx, Payment).count(), journal: await repo(ctx, JournalEntry).count() }))).toEqual(before);
    expect(await f.run((ctx) => repo(ctx, BankReconciliation).count({ statementId: input.statementId }))).toBe(0);
    expect((await f.action('reconcile', input, bankReconciliationView)).state).toBe('active');
  });
  it('serializes different confirmation IDs; replaying an old undo never undoes a later confirmed match', async () => {
    const invoice = await f.invoice('pay', '543');
    const imported = await f.importRows('pay-race,2026-09-05,pay,543,確認支払');
    const input = { requestId: newId(), statementId: required(imported.statements[0]).id, targetKind: 'invoice', targetId: invoice.id, targetVersion: invoice.version, expectedBalance: '543', reason: '確認済み' };
    const results = await Promise.allSettled([f.action('reconcile', input, bankReconciliationView), f.action('reconcile', { ...input, requestId: newId() }, bankReconciliationView)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const success = results.find((result) => result.status === 'fulfilled'); if (success?.status !== 'fulfilled') throw new Error('Expected successful reconciliation');
    const rejected = results.find((result) => result.status === 'rejected'); if (rejected?.status !== 'rejected') throw new Error('Expected conflict'); expect(rejected.reason).toMatchObject({ code: 'CONFLICT' });
    expect((await f.run((ctx) => repo(ctx, PurchaseInvoice).get(invoice.id))).balance.toString()).toBe('0');
    const undo = { reconciliationId: success.value.id, expectedVersion: success.value.version, correctionDate: '2026-09-06', reason: '照合再確認' };
    await f.action('undo_reconciliation', undo, bankReconciliationView);
    const restored = await f.run((ctx) => repo(ctx, PurchaseInvoice).get(invoice.id));
    await expect(f.action('reconcile', { ...input, requestId: newId(), targetVersion: restored.version }, bankReconciliationView)).rejects.toMatchObject({ code: 'VALIDATION' });
    const newRequestId = newId();
    const newer = await f.action('reconcile', { ...input, requestId: newRequestId, targetVersion: restored.version, paymentDate: '2026-09-06' }, bankReconciliationView);
    await f.action('undo_reconciliation', undo, bankReconciliationView);
    expect((await f.run((ctx) => repo(ctx, BankReconciliation).get(newer.id))).state).toBe('active');
    expect((await f.run((ctx) => repo(ctx, PurchaseInvoice).get(invoice.id))).balance.toString()).toBe('0');
    expect((await f.run((ctx) => repo(ctx, Payment).get(newer.paymentId))).date).toBe('2026-09-06');
    expect((await f.run((ctx) => repo(ctx, BankStatement).get(input.statementId))).bookedOn).toBe('2026-09-05');
    await expect(f.action('reconcile', { ...input, requestId: newRequestId, reason: 'changed' }, bankReconciliationView)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('keeps sensitive bank numbers and whole CSV out of physically stored audit records', async () => {
    const rows = await f.db.owner.drizzle.select({ entity: auditLog.entity, before: auditLog.before, after: auditLog.after }).from(auditLog);
    const banking = rows.filter((row) => row.entity.startsWith('bank_'));
    expect(banking.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(banking);
    expect(serialized).not.toContain('9876543'); expect(serialized).not.toContain('0123456789'); expect(serialized).not.toContain(CSV_HEADER); expect(serialized).not.toContain('exportBytes');
  });
  it('serializes confirmation against generic payment cancellation without active links to cancelled payments', async () => {
    const payment = await f.run(async (ctx) => { const draft = await runAction(ctx, 'payment.create', { direction: 'receive', partnerId: f.partner.id, date: '2026-09-03', amount: '777', method: 'bank_transfer', accountId: f.ledgerId }) as { id: string }; await runAction(ctx, 'payment.submit', { id: draft.id }); return repo(ctx, Payment).get(draft.id); });
    const imported = await f.importRows('cancel-race,2026-09-03,receive,777,既存取消競合');
    const input = { requestId: newId(), statementId: required(imported.statements[0]).id, targetKind: 'payment', targetId: payment.id, targetVersion: payment.version, expectedBalance: '777', reason: '確認' };
    const results = await Promise.allSettled([f.action('reconcile', input, bankReconciliationView), f.run((ctx) => runAction(ctx, 'payment.cancel', { id: payment.id }))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const current = await f.run((ctx) => repo(ctx, Payment).get(payment.id));
    const active = await f.run((ctx) => repo(ctx, BankReconciliation).count({ paymentId: payment.id, state: 'active' }));
    expect(active).toBe(current.docstatus === 1 ? 1 : 0);
  });
});
describe('explicit reconciliation and reversal', () => {
  it('creates exactly one submitted payment and journal on concurrent confirmation; reverses source-owned payment atomically', async () => {
    const invoice = await f.invoice('receive', '5000');
    const imported = await f.importRows(`receipt,2026-09-05,receive,2000,カ)テスト`);
    const statement = required(imported.statements[0]);
    const candidates = await f.action('candidates', { statementId: statement.id }, bankCandidatesOutput);
    expect(candidates.candidates.find((row) => row.targetId === invoice.id)).toMatchObject({ targetKind: 'invoice', balance: '5000' });
    const input = { requestId: newId(), statementId: statement.id, targetKind: 'invoice', targetId: invoice.id, targetVersion: invoice.version, expectedBalance: '5000', reason: '銀行明細と請求書を確認' };
    const [one, two] = await Promise.all([f.action('reconcile', input, bankReconciliationView, f.accounting), f.action('reconcile', input, bankReconciliationView, f.accounting)]);
    expect(one).toEqual(two); expect(one.createdPayment).toBe(true);
    expect((await f.run((ctx) => repo(ctx, SalesInvoice).get(invoice.id))).balance.toString()).toBe('3000');
    expect(await f.run((ctx) => repo(ctx, JournalEntry).count({ sourceEntity: 'payment', sourceId: one.paymentId }))).toBe(1);
    await expect(f.run((ctx) => runAction(ctx, 'payment.cancel', { id: one.paymentId }))).rejects.toThrow('銀行照合');
    await expect(f.action('reconcile', { ...input, requestId: newId() }, bankReconciliationView)).rejects.toMatchObject({ code: 'CONFLICT' });
    const undo = { reconciliationId: one.id, expectedVersion: one.version, correctionDate: '2026-09-06', reason: '二重入力資料と判明' };
    const reversed = await f.action('undo_reconciliation', undo, bankReconciliationView, f.accounting);
    expect(reversed.state).toBe('reversed'); expect(await f.action('undo_reconciliation', undo, bankReconciliationView)).toEqual(reversed);
    expect((await f.run((ctx) => repo(ctx, SalesInvoice).get(invoice.id))).balance.toString()).toBe('5000');
    expect((await f.run((ctx) => repo(ctx, Payment).get(one.paymentId))).docstatus).toBe(2);
    expect((await f.action('reconcile', input, bankReconciliationView)).state).toBe('reversed');
  });
  it('links existing payment with no new journal; unlink leaves its original ledger intact', async () => {
    const payment = await f.run(async (ctx) => { const draft = await runAction(ctx, 'payment.create', { direction: 'receive', partnerId: f.partner.id, date: '2026-09-03', amount: '1500', method: 'bank_transfer', accountId: f.ledgerId }) as { id: string }; await runAction(ctx, 'payment.submit', { id: draft.id }); return repo(ctx, Payment).get(draft.id); });
    const imported = await f.importRows('existing,2026-09-03,receive,1500,既存伝票');
    const before = await f.run((ctx) => repo(ctx, JournalEntry).count());
    const input = { requestId: newId(), statementId: required(imported.statements[0]).id, targetKind: 'payment', targetId: payment.id, targetVersion: payment.version, expectedBalance: '1500', reason: '既存入金を確認' };
    const matched = await f.action('reconcile', input, bankReconciliationView);
    expect(matched.createdPayment).toBe(false); expect(await f.run((ctx) => repo(ctx, JournalEntry).count())).toBe(before);
    await f.action('undo_reconciliation', { reconciliationId: matched.id, expectedVersion: matched.version, correctionDate: '2026-09-03', reason: '関連誤り' }, bankReconciliationView);
    expect((await f.run((ctx) => repo(ctx, Payment).get(payment.id))).docstatus).toBe(1); expect(await f.run((ctx) => repo(ctx, JournalEntry).count())).toBe(before);
  });
  it('rejects stale target/balance and overpayment without leaving drafts, ledger or links', async () => {
    const invoice = await f.invoice('receive', '100'); const imported = await f.importRows('oversize,2026-09-03,receive,101,過大');
    const input = { requestId: newId(), statementId: required(imported.statements[0]).id, targetKind: 'invoice', targetId: invoice.id, targetVersion: invoice.version, expectedBalance: '100', reason: '確認' };
    const before = await f.run((ctx) => repo(ctx, Payment).count());
    await expect(f.action('reconcile', { ...input, targetVersion: invoice.version + 1 }, bankReconciliationView)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.action('reconcile', { ...input, expectedBalance: '99' }, bankReconciliationView)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.action('reconcile', input, bankReconciliationView)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await f.run((ctx) => repo(ctx, Payment).count())).toBe(before); expect(await f.run((ctx) => repo(ctx, BankReconciliation).count({ statementId: input.statementId }))).toBe(0);
  });
});
describe('transfer preparation is never bank submission', () => {
  it('freezes reviewed account/invoice snapshot and rejects stale export; cancellation frees reservations', async () => {
    const invoice = await f.invoice('pay', '700');
    const input = { requestId: newId(), bankAccountId: f.account.id, accountVersion: f.account.version, transferDate: '2026-09-15', items: [{ invoiceId: invoice.id, expectedVersion: invoice.version, expectedBalance: '700', payeeId: f.payee.id, payeeVersion: f.payee.version }] };
    const batch = await f.action('prepare_transfer', input, bankTransferDetail);
    expect(await f.action('prepare_transfer', input, bankTransferDetail)).toEqual(batch);
    await expect(f.action('prepare_transfer', { ...input, requestId: newId() }, bankTransferDetail)).rejects.toMatchObject({ code: 'CONFLICT' });
    const payee = await f.action('save_payee', { ...f.payeeInput, id: f.payee.id, expectedVersion: f.payee.version, accountNumber: '1234567' }, bankPayeeView);
    await expect(f.action('export_transfer', { batchId: batch.id, expectedVersion: batch.version, format: 'zengin120', lineEnding: 'none' }, bankTransferExportOutput)).rejects.toMatchObject({ code: 'CONFLICT' });
    const cancelled = await f.action('cancel_transfer', { batchId: batch.id, expectedVersion: batch.version, reason: '未送信、振込先を修正' }, bankTransferView);
    expect(cancelled.state).toBe('cancelled');
    f.payee = payee; f.payeeInput.accountNumber = '1234567';
    const next = await f.action('prepare_transfer', { ...input, requestId: newId(), items: [{ ...required(input.items[0]), payeeVersion: payee.version }] }, bankTransferDetail);
    expect(next.id).not.toBe(batch.id);
  });
  it('exports deterministic bytes and retry result without payments or ledger, preserving full data outside generic outputs', async () => {
    const invoice = await f.invoice('pay', '987');
    const batch = await f.action('prepare_transfer', { requestId: newId(), bankAccountId: f.account.id, accountVersion: f.account.version, transferDate: '2026-09-20', items: [{ invoiceId: invoice.id, expectedVersion: invoice.version, expectedBalance: '987', payeeId: f.payee.id, payeeVersion: f.payee.version }] }, bankTransferDetail, f.accounting);
    const before = await f.run(async (ctx) => ({ payments: await repo(ctx, Payment).count(), journals: await repo(ctx, JournalEntry).count() }));
    const input = { batchId: batch.id, expectedVersion: batch.version, format: 'zengin120', lineEnding: 'crlf' };
    const file = await f.action('export_transfer', input, bankTransferExportOutput, f.accounting);
    expect(file.sentToBank).toBe(false); expect(file.bytes).toHaveLength(488); expect(file.batch.contentHash).toBe(contentHashBytes(Uint8Array.from(file.bytes)));
    expect(await f.action('export_transfer', input, bankTransferExportOutput)).toEqual(file);
    expect(await f.run(async (ctx) => ({ payments: await repo(ctx, Payment).count(), journals: await repo(ctx, JournalEntry).count() }))).toEqual(before);
    const generic = await f.run((ctx) => runAction(ctx, 'bank_transfer.get', { id: batch.id })); expect(generic).not.toHaveProperty('snapshot'); expect(generic).not.toHaveProperty('exportBytes');
    const audit = await f.run((ctx) => auditTrail(ctx, BankTransfer.name, batch.id));
    expect(JSON.stringify(audit)).not.toContain('exportBytes'); expect(JSON.stringify(audit)).not.toContain('1234567');
    const storedAudit = await f.db.owner.drizzle.select({ entity: auditLog.entity, before: auditLog.before, after: auditLog.after }).from(auditLog);
    const exportedAudit = JSON.stringify(storedAudit.filter((row) => row.entity === BankTransfer.name));
    expect(exportedAudit).not.toContain('exportBytes'); expect(exportedAudit).not.toContain('1234567'); expect(exportedAudit).not.toContain('9876543');
    await expect(f.action('transfer_detail', { batchId: batch.id }, bankTransferDetail, { roles: ['viewer'] })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(f.run((ctx) => repo(ctx, BankTransfer).update(batch.id, { state: 'cancelled' }))).rejects.toThrow();
    expect(await f.action('board', {}, bankBoardOutput)).toHaveProperty('statements');
    await expect(f.action('export_transfer', { ...input, format: 'canonical_csv' }, bankTransferExportOutput)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('requires explicit format validation and role at action boundaries', async () => {
    await expect(f.action('save_account', { ...f.accountInput, code: 'BAD', holderKana: '漢字' }, z.unknown())).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(f.action('board', {}, bankBoardOutput, { companyId: null })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
