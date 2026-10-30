// purchase.import_opening_payables (docs/specs/opening-balances.md AC-6, AC-15..AC-18, D-4..D-6): one opening bill per
// row — dated the opening date, one out-of-scope line whose account is the opening balance clearing account,
// `openingBalance = true` — created and submitted in the caller's context, so payments and AP aging keep working. The
// ordinary posting then gives Dr 期首残高仮勘定 / Cr 買掛金 on the opening path (hooks/submit.ts).
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
  openingInvoicesInput,
  OPENING_INPUT_BYTES,
  OPENING_ROLES,
  type OpeningInvoicesInput,
} from '@daifuku/mod-accounting';
import { PurchaseInvoice } from '../entities/purchase-invoice.ts';
import { PurchaseInvoiceLine } from '../entities/purchase-invoice-line.ts';
import { resolvePostingAccounts } from '../settings.ts';

/** Module-private: only this import may set `openingBalance` (serverOwned, immutable). */
const openingWrite = defineWriteCapability({
  name: 'purchase.opening',
  entity: PurchaseInvoice.name,
  fields: ['openingBalance'],
  operations: ['create'],
});

export const OPENING_BILL_DESCRIPTION = '期首残高';

function billNote(row: { originalDate: string | null; memo: string | null }): string {
  const date = row.originalDate ? ` 元請求日 ${row.originalDate}` : '';
  return `期首残高${date}${row.memo ? ` ${row.memo}` : ''}`;
}

export async function importOpeningPayables(ctx: Context, input: OpeningInvoicesInput) {
  return importOpeningInvoices(ctx, input, {
    action: 'purchase.import_opening_payables',
    invoice: PurchaseInvoice,
    needs: [
      [PurchaseInvoice, 'create'],
      [PurchaseInvoice, 'submit'],
      [PurchaseInvoiceLine, 'create'],
    ],
    checkPostingAccounts: resolvePostingAccounts,
    create: async (sp, row, year, clearing) => {
      const draft = await withWriteCapability(sp, openingWrite, (internal) =>
        repo(internal, PurchaseInvoice).create({
          partnerId: row.partner.id,
          date: year.openingDate,
          dueDate: row.dueDate,
          priceIncludesTax: false,
          supplierInvoiceNo: row.reference ? row.reference.slice(0, 50) : null,
          note: billNote(row),
          openingBalance: true,
        }),
      );
      await repo(sp, PurchaseInvoiceLine).create({
        invoiceId: draft.id,
        seq: 1,
        accountId: clearing.id,
        description: OPENING_BILL_DESCRIPTION,
        quantity: '1',
        unitPrice: row.amount,
        taxCategory: 'out_of_scope',
      });
      const submitted = await submitDocument(sp, PurchaseInvoice, draft.id);
      return { id: submitted.id, number: submitted.number };
    },
  });
}

export const importOpeningPayablesAction = defineAction({
  name: 'purchase.import_opening_payables',
  description: label(
    '期首の買掛金を仕入先別の期首請求書として取り込みます（行: partnerCode, amount, dueDate?, reference?, originalDate?, memo?。最大 200 行・2 MB）。1 行 = 期首残高日付・不課税 1 行（科目は期首残高仮勘定）の仕入請求書（支払・年齢表の対象）。期首残高仮勘定 / 買掛金に転記。mode: dry-run は確認だけ。全件か無か。仕入請求書を作れるロールも必要。',
    'Import opening payables as one opening bill per row (rows: partnerCode, amount, dueDate?, reference?, originalDate?, memo?; at most 200 rows / 2 MB): dated the opening date with one out-of-scope line on the clearing account, open for payments and aging; posts opening balance clearing / payable. mode dry-run checks only. All or nothing. Also needs a role that creates purchase invoices.',
  ),
  input: openingInvoicesInput,
  output: openingImportResult,
  permission: { roles: OPENING_ROLES },
  inputBytes: OPENING_INPUT_BYTES,
  handler: (ctx, input) => importOpeningPayables(ctx, input),
});
