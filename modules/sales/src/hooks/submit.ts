// sales_invoice submit hooks (spec AC-3). before_submit: ≥1 line, total > 0, totals re-derived, accounts resolved
// from `sales.accounts` by account.code, the journal entry posted through accounting.postFromSource in the same
// transaction, and the header fields (totals, status=open, balance=total, journalEntryId) set on the row the kernel
// writes together with docstatus/number. after_submit: the entry's description gets the invoice number, which does
// not exist before numbering (the entry is already linked by sourceEntity/sourceId).
import {
  Decimal,
  getSetting,
  registry,
  defineWriteCapability,
  withWriteCapability,
  repo,
  StateError,
  ValidationError,
  type Context,
  type HookArgs,
  type LocalDate,
} from '@daifuku/kernel';
import { Account, JournalEntry, postFromSource, assertJpySettlement, postingDimensions } from '@daifuku/mod-accounting';
import { Partner } from '@daifuku/mod-partner';
import { buildLiveInvoiceRenderData } from '../actions/render-invoice-html.ts';
import { SalesInvoice } from '../entities/sales-invoice.ts';
import { recalculateInvoice } from '../recalculate.ts';
import { journalLinesFor, type PostingAccounts } from '../services/posting.ts';
import { SALES_ACCOUNTS_DEFAULT, SALES_ACCOUNTS_KEY, salesAccountsSchema, type SalesAccounts } from '../settings.ts';

const snapshotWrite = defineWriteCapability({
  name: 'sales.issue-snapshot',
  entity: 'sales_invoice',
  fields: ['issuedSnapshot'],
  operations: ['update'],
});

export const ACCOUNTS_HINT = 'seed the chart of accounts (l10n/jp) or set sales.accounts';

/** Account ids for the codes in `sales.accounts`; INVALID_STATE naming the missing codes (AC-3). */
export async function resolvePostingAccounts(ctx: Context): Promise<PostingAccounts> {
  const codes = await getSetting(ctx, SALES_ACCOUNTS_KEY, salesAccountsSchema, SALES_ACCOUNTS_DEFAULT);
  const wanted = [...new Set(Object.values(codes))];
  const found = await repo(ctx, Account).list({ where: { code: { $in: wanted } }, limit: wanted.length });
  const byCode = new Map(found.items.map((a) => [a.code, a.id]));
  const missing = (Object.entries(codes) as [keyof SalesAccounts, string][]).filter(([, code]) => !byCode.has(code));
  if (missing.length > 0) {
    throw new StateError(
      `account code(s) ${missing.map(([k, c]) => `${c} (${k})`).join(', ')} do not exist`,
      ACCOUNTS_HINT,
      { setting: SALES_ACCOUNTS_KEY, missing: Object.fromEntries(missing) },
    );
  }
  const id = (k: keyof SalesAccounts) => byCode.get(codes[k]) ?? '';
  return { receivable: id('receivable'), revenue: id('revenue'), taxPayable: id('taxPayable') };
}

function description(partnerName: string, number: string | null): string {
  return number ? `売上請求書 ${number} ${partnerName}` : `売上請求書 ${partnerName}`;
}

async function beforeSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const id = row.id as string;
  const partnerId = row.partnerId;
  if (typeof partnerId !== 'string')
    throw new ValidationError(
      `sales_invoice ${id} has no partner`,
      [{ path: 'partnerId', message: 'required' }],
      'Set partnerId, then submit.',
    );
  const { totals, lines } = await recalculateInvoice(ctx, {
    id,
    date: row.date as LocalDate,
    priceIncludesTax: row.priceIncludesTax === true,
  });
  if (lines.length === 0)
    throw new ValidationError(
      `sales_invoice ${id} has no lines`,
      [{ path: 'lines', message: 'at least 1 line is required' }],
      'Add at least one line, then submit.',
    );
  if (!totals.total.gt(0)) {
    throw new ValidationError(
      `sales_invoice ${id} total ${totals.total.toString()} must be greater than 0`,
      [{ path: 'total', message: 'must be > 0' }],
      'An invoice must bill a positive amount; credit notes are out of scope (cancel + amend instead).',
    );
  }
  await assertJpySettlement(ctx, totals.total);
  const accounts = await resolvePostingAccounts(ctx);
  const partner = await repo(ctx, Partner).get(partnerId);
  const journalLines = journalLinesFor(
    {
      partnerId,
      priceIncludesTax: row.priceIncludesTax === true,
      lines: lines.map((l) => ({
        seq: l.seq,
        description: l.description,
        amount: l.amount,
        taxCategory: l.taxCategory,
        ext: postingDimensions('sales_invoice_line', 'journal_line', l.ext),
      })),
      taxSummary: totals.taxSummary,
      total: totals.total,
    },
    accounts,
  );
  const entry = await postFromSource(ctx, {
    sourceEntity: SalesInvoice.name,
    sourceId: id,
    date: row.date as LocalDate,
    description: description(partner.name, null),
    ext: row.ext as Record<string, unknown>,
    lines: journalLines.map((l) => ({
      ...l,
      ext: { ...postingDimensions(SalesInvoice.name, 'journal_line', row.ext as Record<string, unknown>), ...l.ext },
    })),
  });
  Object.assign(row, {
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    taxSummary: totals.taxSummary,
    paidAmount: Decimal.zero(),
    balance: totals.total,
    status: 'open',
    controlAccountId: accounts.receivable,
    settlementHistory: true,
    journalEntryId: entry.id,
  });
}

async function afterSubmit(ctx: Context, { row }: HookArgs): Promise<void> {
  const invoice = await repo(ctx, SalesInvoice).get(row.id as string);
  const issuedSnapshot = await buildLiveInvoiceRenderData(ctx, invoice);
  await withWriteCapability(ctx, snapshotWrite, (internal) =>
    repo(internal, SalesInvoice).update(invoice.id, { issuedSnapshot }),
  );
  if (typeof row.journalEntryId !== 'string' || typeof row.number !== 'string' || typeof row.partnerId !== 'string')
    return;
  const partner = await repo(ctx, Partner).get(row.partnerId);
  await repo(ctx, JournalEntry).update(row.journalEntryId, { description: description(partner.name, row.number) });
}

export function registerSubmitHooks(): void {
  registry.registerHook(SalesInvoice.name, 'before_submit', beforeSubmit);
  registry.registerHook(SalesInvoice.name, 'after_submit', afterSubmit);
}
