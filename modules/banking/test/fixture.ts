import { newId, registerCrudActions, repo, runAction, type Context, type ContextParams } from '@daifuku/kernel';
import { freshDb } from '@daifuku/kernel/testing';
import { Account, openFiscalYear } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import { SalesInvoice } from '@daifuku/mod-sales';
import type { z } from 'zod';
import { BankingModule, BankStatement } from '../src/index.ts';
import { bankAccountView, bankImportPreview, bankImportResult, bankPayeeView } from '../src/contract.ts';
export const CSV_HEADER = 'externalId,bookedOn,direction,amount,description';
export const syntheticBank = { bankCode: '0009', branchCode: '001', accountType: 'ordinary' as const, accountNumber: '9876543', holderKana: 'ﾃｽﾄ' };
export async function bankingFixture() {
  if (BankingModule.name !== 'banking') throw new Error('Missing module');
  registerCrudActions();
  const db = await freshDb();
  const run = <T>(fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = {}) => db.run({ now: () => new Date('2026-09-13T03:00:00Z'), ...params }, fn);
  const action = async <S extends z.ZodType>(name: string, input: unknown, schema: S, params: Partial<ContextParams> = {}): Promise<z.infer<S>> => schema.parse(await run((ctx) => runAction(ctx, `banking.${name}`, input), params));
  const chart = new Map<string, string>();
  await run(async (ctx) => {
    await openFiscalYear(ctx, { startDate: '2026-01-01' });
    const defs = [ ['1000', 'asset'], ['1100', 'asset'], ['1300', 'asset'], ['2100', 'liability'], ['2400', 'liability'], ['1900', 'asset'], ['4000', 'revenue'], ['2200', 'liability'], ['5000', 'expense'], ['1500', 'asset'] ] as const;
    for (const [code, type] of defs) chart.set(code, (await repo(ctx, Account).create({ code, name: `テスト ${code}`, type, partnerRequired: code === '1300' || code === '2100' })).id);
  });
  const ledgerId = required(chart.get('1100'));
  const partner = await run((ctx) => repo(ctx, Partner).create({ name: 'カ)テスト', isCustomer: true, isSupplier: true }));
  const accountInput = { ...syntheticBank, code: 'MAIN', name: '合成試験口座', ledgerAccountId: ledgerId, requesterCode: '0123456789', active: true };
  const account = await action('save_account', accountInput, bankAccountView);
  const payeeInput = { ...syntheticBank, partnerId: partner.id, active: true };
  const payee = await action('save_payee', payeeInput, bankPayeeView);
  const importRows = async (body: string, bankAccountId = account.id) => {
    const csv = `${CSV_HEADER}\n${body}`;
    const preview = await action('preview_import', { bankAccountId, csv }, bankImportPreview);
    const imported = await action('import_statement_csv', { bankAccountId, csv, previewHash: preview.previewHash }, bankImportResult);
    const statements = await run((ctx) => repo(ctx, BankStatement).list({ where: { importId: imported.importId }, limit: 500 }));
    return { csv, preview, imported, statements: statements.items };
  };
  const invoice = async (direction: 'receive' | 'pay', amount: string) => run(async (ctx) => {
    const entity = direction === 'receive' ? SalesInvoice : PurchaseInvoice;
    const created = await runAction(ctx, `${entity.name}.create`, { partnerId: partner.id, date: '2026-09-01', lines: { [`${entity.name}_line`]: [{ ...(direction === 'pay' ? { accountId: chart.get('5000') } : {}), description: '合成試験', unitPrice: amount, taxCategory: 'exempt' }] } }) as { id: string };
    await runAction(ctx, `${entity.name}.submit`, { id: created.id });
    return repo(ctx, entity).get(created.id);
  });
  const accounting = { roles: ['accounting'], actor: { type: 'user' as const, id: newId() } };
  return { db, run, action, chart, ledgerId, partner, account, accountInput, payee, payeeInput, importRows, invoice, accounting };
}
export type BankFixture = Awaited<ReturnType<typeof bankingFixture>>;
export function required<T>(value: T | undefined | null): T { if (value === undefined || value === null) throw new Error('Expected fixture value'); return value; }
