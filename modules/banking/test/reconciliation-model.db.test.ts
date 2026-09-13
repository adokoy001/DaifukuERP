import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, repo, runAction, type Context } from '@daifuku/kernel';
import { JournalEntry, JournalLine } from '@daifuku/mod-accounting';
import { Payment } from '@daifuku/mod-payment';
import { SalesInvoice } from '@daifuku/mod-sales';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import type { z } from 'zod';
import { BankImport, BankStatement, BankReconciliation } from '../src/index.ts';
import {
  bankImportPreview,
  bankImportResult,
  type bankReconcileInput,
  bankReconciliationView,
  type bankUndoInput,
} from '../src/contract.ts';
import { bankingFixture, type BankFixture, required, CSV_HEADER } from './fixture.ts';
type Reconciliation = z.infer<typeof bankReconciliationView>;
type Match = z.infer<typeof bankReconcileInput>;
type Undo = z.infer<typeof bankUndoInput>;
type History = { row: Reconciliation; input: Match; undo?: Undo };
type Model = {
  balanceRejected: number;
  history: History[];
  active?: History;
  created: number;
  reversed: number;
  success: number;
  rejected: number;
  replayed: number;
};
type Op =
  'match' | 'undo' | 'oldMatch' | 'oldUndo' | 'duplicatePayment' | 'badBalance' | 'importRetry' | 'changedImport';
let f: BankFixture;
beforeAll(async () => {
  f = await bankingFixture();
});
afterAll(async () => {
  await f.db.close();
});
const parameters = {
  seed: Number(process.env['PBT_SEED'] ?? 730304),
  numRuns: Number(process.env['PBT_RUNS'] ?? 4),
  ...(process.env['PBT_PATH'] ? { path: process.env['PBT_PATH'] } : {}),
};
async function bankNet(ctx: Context) {
  let offset = 0,
    total = 0n;
  while (true) {
    const page = await repo(ctx, JournalLine).list({
      where: { accountId: f.ledgerId, posted: true },
      limit: 500,
      offset,
    });
    for (const line of page.items) total += BigInt(line.debit.toString()) - BigInt(line.credit.toString());
    offset += page.items.length;
    if (offset >= page.total) return total;
  }
}
async function effects(invoiceId: string, direction: 'receive' | 'pay', statementIds: string[]) {
  return f.run(async (ctx) => {
    const invoice = await repo(ctx, direction === 'receive' ? SalesInvoice : PurchaseInvoice).get(invoiceId);
    const links = await repo(ctx, BankReconciliation).list({
      where: { statementId: { $in: statementIds } },
      orderBy: [{ field: 'id', dir: 'asc' }],
      limit: 500,
    });
    return {
      paid: invoice.paidAmount.toString(),
      balance: invoice.balance.toString(),
      version: invoice.version,
      imports: await repo(ctx, BankImport).count(),
      statements: await repo(ctx, BankStatement).count(),
      payments: await repo(ctx, Payment).count(),
      journals: await repo(ctx, JournalEntry).count(),
      bankNet: await bankNet(ctx),
      links: links.items.map((v) => ({
        id: v.id,
        paymentId: v.paymentId,
        state: v.state,
        createdPayment: v.createdPayment,
      })),
    };
  });
}
async function traceFixture(direction: 'receive' | 'pay', existing: boolean, amount: number) {
  const invoice = await f.invoice(direction, String(amount * 3));
  let paymentId: string | undefined;
  if (existing)
    paymentId = await f.run(async (ctx) => {
      const draft = (await runAction(ctx, 'payment.create', {
        direction,
        date: '2026-09-12',
        partnerId: f.partner.id,
        amount: String(amount),
        accountId: f.ledgerId,
        method: 'bank_transfer',
        lines: {
          payment_allocation: [
            {
              invoiceEntity: direction === 'receive' ? 'sales_invoice' : 'purchase_invoice',
              invoiceId: invoice.id,
              amount: String(amount),
            },
          ],
        },
      })) as { id: string };
      await runAction(ctx, 'payment.submit', { id: draft.id });
      return draft.id;
    });
  const externalId = newId(),
    imported = await f.importRows(`${externalId},2026-09-02,${direction},${amount},generated`);
  const duplicate = await f.importRows(`${newId()},2026-09-02,${direction},${amount},same payment different statement`);
  const statementId = required(imported.statements[0]).id,
    otherStatementId = required(duplicate.statements[0]).id;
  const statementIds = [statementId, otherStatementId],
    baseline = await effects(invoice.id, direction, statementIds);
  return {
    invoiceId: invoice.id,
    direction,
    existing,
    amount,
    paymentId,
    imported,
    externalId,
    statementId,
    otherStatementId,
    statementIds,
    baseline,
  };
}
type Trace = Awaited<ReturnType<typeof traceFixture>>;
async function inputFor(t: Trace, other = false): Promise<Match> {
  const target = await f.run((ctx) =>
    t.paymentId
      ? repo(ctx, Payment).get(t.paymentId)
      : repo(ctx, t.direction === 'receive' ? SalesInvoice : PurchaseInvoice).get(t.invoiceId),
  );
  return {
    requestId: newId(),
    statementId: other ? t.otherStatementId : t.statementId,
    targetKind: t.existing ? 'payment' : 'invoice',
    targetId: target.id,
    targetVersion: target.version,
    expectedBalance: t.existing ? String(t.amount) : (await effects(t.invoiceId, t.direction, t.statementIds)).balance,
    reason: 'Generated reconciliation',
    ...(t.existing ? {} : { paymentDate: '2026-09-12' }),
  };
}
async function assertModel(m: Model, t: Trace) {
  const actual = await effects(t.invoiceId, t.direction, t.statementIds),
    paid = t.existing || m.active ? t.amount : 0;
  expect(actual.paid).toBe(String(paid));
  expect(actual.balance).toBe(String(t.amount * 3 - paid));
  expect(actual.payments - t.baseline.payments).toBe(m.created);
  expect(actual.journals - t.baseline.journals).toBe(m.created + m.reversed);
  const bankDelta = t.existing ? 0n : BigInt(m.active ? t.amount : 0) * (t.direction === 'receive' ? 1n : -1n);
  expect(actual.bankNet - t.baseline.bankNet).toBe(bankDelta);
  expect(actual.links.filter((v) => v.state === 'active').map((v) => v.id)).toEqual(m.active ? [m.active.row.id] : []);
  expect(actual.links).toHaveLength(m.history.length);
  for (const h of m.history) {
    expect(actual.links.find((v) => v.id === h.row.id)).toMatchObject({
      state: h === m.active ? 'active' : 'reversed',
      createdPayment: !t.existing,
    });
    const payment = await f.run((ctx) => repo(ctx, Payment).get(h.row.paymentId));
    expect(payment.docstatus).toBe(t.existing || h === m.active ? 1 : 2);
    expect(payment.amount.toString()).toBe(String(t.amount));
  }
}
async function match(m: Model, t: Trace, invalid: boolean, duplicate: boolean) {
  const input = await inputFor(t, duplicate);
  if (invalid) input.expectedBalance = String(t.amount * 9);
  // Only the existing-payment branch uses the second statement; it must never share an active payment.
  const allowed = !invalid && !m.active && !duplicate;
  if (!allowed) {
    const code = invalid && !m.active && t.existing ? 'INVALID_STATE' : 'CONFLICT';
    await expect(f.action('reconcile', input, bankReconciliationView)).rejects.toMatchObject({ code });
    if (invalid && !m.active) m.balanceRejected++;
    m.rejected++;
    return;
  }
  const row = await f.action('reconcile', input, bankReconciliationView),
    history = { row, input };
  m.history.push(history);
  m.active = history;
  if (!t.existing) m.created++;
  m.success++;
}
async function undo(m: Model, t: Trace, old: boolean) {
  const h = required(old ? m.history[0] : (m.active ?? m.history.at(-1)));
  const input = h.undo ?? {
    reconciliationId: h.row.id,
    expectedVersion: h.row.version,
    correctionDate: '2026-09-12',
    reason: 'Generated undo',
  };
  const result = await f.action('undo_reconciliation', input, bankReconciliationView);
  expect(result.id).toBe(h.row.id);
  expect(result.state).toBe('reversed');
  if (m.active === h) {
    delete m.active;
    if (!t.existing) m.reversed++;
  } else m.replayed++;
  h.undo = input;
  h.row = result;
  m.success++;
}
async function execute(m: Model, t: Trace, op: Op) {
  const before = await effects(t.invoiceId, t.direction, t.statementIds),
    rejected = m.rejected;
  if (op === 'match' || op === 'badBalance' || op === 'duplicatePayment')
    await match(m, t, op === 'badBalance', op === 'duplicatePayment');
  if (op === 'undo' || op === 'oldUndo') await undo(m, t, op === 'oldUndo');
  if (op === 'oldMatch') {
    const h = required(m.history[0]);
    const result = await f.action('reconcile', h.input, bankReconciliationView);
    expect(result.id).toBe(h.row.id);
    expect(result.state).toBe(h === m.active ? 'active' : 'reversed');
    m.replayed++;
  }
  if (op === 'importRetry') {
    const result = await f.action(
      'import_statement_csv',
      { bankAccountId: f.account.id, csv: t.imported.csv, previewHash: t.imported.preview.previewHash },
      bankImportResult,
    );
    expect(result).toEqual(t.imported.imported);
    m.replayed++;
  }
  if (op === 'changedImport') {
    const csv = `${CSV_HEADER}\n${t.externalId},2026-09-02,${t.direction},${t.amount + 1},changed`;
    await expect(
      f.action('preview_import', { bankAccountId: f.account.id, csv }, bankImportPreview),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    m.rejected++;
  }
  if (m.rejected > rejected) expect(await effects(t.invoiceId, t.direction, t.statementIds)).toEqual(before);
  await assertModel(m, t);
}
describe('AC-3 / BANK-RECON-01 generated bank histories', () => {
  it.each([
    { direction: 'receive', existing: false },
    { direction: 'pay', existing: false },
    { direction: 'receive', existing: true },
    { direction: 'pay', existing: true },
  ] as const)(
    '$direction / existing=$existing preserves ledger effects through rematch and old retries',
    async ({ direction, existing }) => {
      const choices: Op[] = ['match', 'undo', 'oldMatch', 'oldUndo', 'badBalance', 'importRetry', 'changedImport'];
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 999_999 }),
          fc.array(fc.constantFrom(...choices), { minLength: 3, maxLength: 8 }),
          async (amount, tail) => {
            const t = await traceFixture(direction, existing, amount),
              m: Model = {
                balanceRejected: 0,
                history: [],
                created: 0,
                reversed: 0,
                success: 0,
                rejected: 0,
                replayed: 0,
              };
            const prefix: Op[] = [
              'importRetry',
              'changedImport',
              'badBalance',
              'match',
              'match',
              ...(existing ? ['duplicatePayment' as const] : []),
              'oldMatch',
              'undo',
              'badBalance',
              'match',
              'oldUndo',
              'oldMatch',
              'badBalance',
            ];
            for (const step of [...prefix, ...tail]) await execute(m, t, step);
            expect(m.balanceRejected).toBeGreaterThanOrEqual(2);
            expect(m.success).toBeGreaterThanOrEqual(4);
            expect(m.rejected).toBeGreaterThanOrEqual(3);
            expect(m.replayed).toBeGreaterThanOrEqual(4);
          },
        ),
        parameters,
      );
    },
    180_000,
  );
});
