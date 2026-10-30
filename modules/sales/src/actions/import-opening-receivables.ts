// sales.import_opening_receivables (docs/specs/opening-balances.md AC-6, AC-15..AC-18, D-4..D-6): one opening invoice
// per row — dated the opening date, one out-of-scope line, `openingBalance = true` — created and submitted in the
// caller's context, so allocation (payment), aging and the inbox keep working on it. The submit hook posts
// Dr 売掛金 / Cr 期首残高仮勘定 on the opening path (hooks/submit.ts). The shared rules live in accounting.
import {
  defineAction,
  defineWriteCapability,
  label,
  repo,
  submitDocument,
  withWriteCapability,
  type Context,
} from '@daifuku/kernel';
import {
  importOpeningInvoices,
  openingImportResult,
  openingInvoiceNote,
  openingInvoicesInput,
  OPENING_INPUT_BYTES,
  OPENING_ROLES,
  type OpeningInvoicesInput,
} from '@daifuku/mod-accounting';
import { SalesInvoice } from '../entities/sales-invoice.ts';
import { SalesInvoiceLine } from '../entities/sales-invoice-line.ts';
import { resolvePostingAccounts } from '../hooks/submit.ts';

/** Module-private: only this import may set `openingBalance` (serverOwned, immutable). */
const openingWrite = defineWriteCapability({
  name: 'sales.opening',
  entity: SalesInvoice.name,
  fields: ['openingBalance'],
  operations: ['create'],
});

export const OPENING_LINE_DESCRIPTION = '期首残高';

export async function importOpeningReceivables(ctx: Context, input: OpeningInvoicesInput) {
  return importOpeningInvoices(ctx, input, {
    action: 'sales.import_opening_receivables',
    invoice: SalesInvoice,
    needs: [
      [SalesInvoice, 'create'],
      [SalesInvoice, 'submit'],
      [SalesInvoiceLine, 'create'],
    ],
    checkPostingAccounts: resolvePostingAccounts,
    create: async (sp, row, year) => {
      const draft = await withWriteCapability(sp, openingWrite, (internal) =>
        repo(internal, SalesInvoice).create({
          partnerId: row.partner.id,
          date: year.openingDate,
          dueDate: row.dueDate,
          priceIncludesTax: false,
          note: openingInvoiceNote(row),
          openingBalance: true,
        }),
      );
      await repo(sp, SalesInvoiceLine).create({
        invoiceId: draft.id,
        seq: 1,
        description: OPENING_LINE_DESCRIPTION,
        quantity: '1',
        unitPrice: row.amount,
        taxCategory: 'out_of_scope',
      });
      const submitted = await submitDocument(sp, SalesInvoice, draft.id);
      return { id: submitted.id, number: submitted.number };
    },
  });
}

export const importOpeningReceivablesAction = defineAction({
  name: 'sales.import_opening_receivables',
  description: label(
    '期首の売掛金を得意先別の期首請求書として取り込みます（行: partnerCode, amount, dueDate?, reference?, originalDate?, memo?。最大 200 行・2 MB）。1 行 = 期首残高日付・不課税 1 行の請求書（消込・年齢表の対象、発行はしない）。売掛金 / 期首残高仮勘定に転記。mode: dry-run は確認だけ。全件か無か。売上請求書を作れるロールも必要。',
    'Import opening receivables as one opening invoice per row (rows: partnerCode, amount, dueDate?, reference?, originalDate?, memo?; at most 200 rows / 2 MB): dated the opening date with one out-of-scope line, open for allocation and aging, never issued; posts receivable / opening balance clearing. mode dry-run checks only. All or nothing. Also needs a role that creates sales invoices.',
  ),
  input: openingInvoicesInput,
  output: openingImportResult,
  permission: { roles: OPENING_ROLES },
  inputBytes: OPENING_INPUT_BYTES,
  handler: (ctx, input) => importOpeningReceivables(ctx, input),
});
