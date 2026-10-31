// Shared browser/backend wire contract of the expense module (docs/specs/expense-settlement.md). Pure zod: the web app
// imports `@daifuku/mod-expense/contract` without the server code. Amounts and dates are strings on the wire.
import { z } from 'zod';

/** Kind of a settlement (D3): what the employee's expenses were paid with. */
export const EXPENSE_SETTLEMENT_KINDS = ['reimbursement', 'corporate_card', 'advance'] as const;
export type ExpenseSettlementKind = (typeof EXPENSE_SETTLEMENT_KINDS)[number];

/** Payment method of a workforce expense (copied from the workforce contract so this file stays dependency-free). */
export const EXPENSE_PAYMENT_METHOD_VALUES = ['personal', 'corporate_card', 'advance'] as const;
export type ExpensePaymentMethodValue = (typeof EXPENSE_PAYMENT_METHOD_VALUES)[number];

/** D3: a settlement of a kind contains only expenses paid with the matching method. */
export const KIND_PAYMENT_METHOD: Readonly<Record<ExpenseSettlementKind, ExpensePaymentMethodValue>> = {
  reimbursement: 'personal',
  corporate_card: 'corporate_card',
  advance: 'advance',
};
export const PAYMENT_METHOD_KIND: Readonly<Record<ExpensePaymentMethodValue, ExpenseSettlementKind>> = {
  personal: 'reimbursement',
  corporate_card: 'corporate_card',
  advance: 'advance',
};

/** D21: the document kept for a taxable line, which decides its input-tax credit ratio. */
export const INVOICE_KINDS = ['qualified', 'not_qualified', 'books_only', 'small_amount', 'none'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/** D21: why a books-only line needs no invoice (docs/domain/japan-tax.md#books-only, 【未確認】). */
export const BOOKS_ONLY_REASONS = [
  'public_transport',
  'business_travel',
  'vending_machine',
  'collected_ticket',
] as const;
export type BooksOnlyReason = (typeof BOOKS_ONLY_REASONS)[number];

export const ADVANCE_STATUSES = ['open', 'settled', 'cancelled'] as const;
export type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];

/** `PermissionDenied.details.op` suffixes this module uses (D26). */
export const REQUIRES_PAYROLL_SUFFIX = ':requires-workforce_payroll';
export const SELF_SETTLEMENT_SUFFIX = ':self-settlement';

const id = z.uuid();
const date = z.iso.date();
const money = z.string();

/** Most expenses one `expense.draft_settlement` call takes (AC-3); the screen sends a larger group's oldest ones. */
export const MAX_DRAFT_EXPENSES = 200;

export const draftSettlementInput = z
  .object({
    employeeId: id,
    kind: z.enum(EXPENSE_SETTLEMENT_KINDS),
    /** One line per expense (AC-3): an id listed twice is refused. */
    expenseIds: z
      .array(id)
      .min(1)
      .max(MAX_DRAFT_EXPENSES)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate expense id' })
      .optional(),
    advanceId: id.optional(),
    partnerId: id.optional(),
    date: date.optional(),
  })
  .strict();
export type DraftSettlementInput = z.infer<typeof draftSettlementInput>;
export const draftSettlementOutput = z.object({ id, version: z.number().int() });
export type DraftSettlementOutput = z.infer<typeof draftSettlementOutput>;

export const settlementCandidatesInput = z.object({}).strict();
export const candidateGroup = z.object({
  employeeId: id,
  employeeCode: z.string(),
  employeeName: z.string(),
  siteId: id,
  siteName: z.string(),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHOD_VALUES),
  kind: z.enum(EXPENSE_SETTLEMENT_KINDS),
  /** Approved expenses in no non-cancelled settlement. */
  count: z.number().int(),
  total: money,
  oldestDate: date.nullable(),
  expenseIds: z.array(id),
  /** Approved expenses of the group already in a draft settlement. */
  inDraftCount: z.number().int(),
  /** The employee is the caller: someone else settles these (AC-15 self-settlement). */
  self: z.boolean(),
});
export type CandidateGroup = z.infer<typeof candidateGroup>;
export const openAdvance = z.object({
  id,
  number: z.string().nullable(),
  employeeId: id,
  employeeName: z.string(),
  siteId: id,
  date,
  amount: money,
  purpose: z.string(),
  /** The advance was paid to the caller: someone else clears it (AC-15 self-settlement). */
  self: z.boolean(),
});
export type OpenAdvance = z.infer<typeof openAdvance>;
export const settlementCandidatesOutput = z.object({
  groups: z.array(candidateGroup),
  advances: z.array(openAdvance),
  truncated: z.boolean(),
});
export type SettlementCandidates = z.infer<typeof settlementCandidatesOutput>;
