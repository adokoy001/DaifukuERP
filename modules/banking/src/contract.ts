// Browser-safe action contract: no kernel, database or Node imports.
import { z } from 'zod';
export const BANK_MAX_ROWS = 500;
export const bankId = z.uuid();
export const bankVersion = z.number().int().positive();
export const bankMoney = z.string().regex(/^[1-9][0-9]{0,9}$/);
export const bankDate = z.iso.date();
export const bankDirection = z.enum(['receive', 'pay']);
export const bankAccountType = z.enum(['ordinary', 'current']);
export const bankIdentity = z
  .object({
    bankCode: z.string().regex(/^[0-9]{4}$/),
    branchCode: z.string().regex(/^[0-9]{3}$/),
    accountType: bankAccountType,
    accountNumber: z.string().regex(/^[0-9]{1,7}$/),
    holderKana: z.string().trim().min(1).max(30),
  })
  .strict();
const edit = { id: bankId.optional(), expectedVersion: bankVersion.optional() };
export const bankAccountInput = bankIdentity.extend({
  ...edit,
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(100),
  ledgerAccountId: bankId,
  requesterCode: z.string().regex(/^[0-9]{10}$/),
  active: z.boolean(),
});
export const bankPayeeInput = bankIdentity.extend({ ...edit, partnerId: bankId, active: z.boolean() });
export const bankImportInput = z.object({ bankAccountId: bankId, csv: z.string().min(1).max(500_000) }).strict();
export const bankImportCommitInput = bankImportInput.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const bankStatementSource = z
  .object({
    externalId: z.string().min(1).max(100),
    bookedOn: bankDate,
    direction: bankDirection,
    amount: bankMoney,
    description: z.string().max(500),
  })
  .strict();
export const bankImportPreview = z.object({
  bankAccountId: bankId,
  previewHash: z.string(),
  rowCount: z.number().int(),
  newCount: z.number().int(),
  duplicateCount: z.number().int(),
  receiveTotal: z.string(),
  payTotal: z.string(),
  rows: z.array(bankStatementSource.extend({ duplicate: z.boolean() })).max(BANK_MAX_ROWS),
});
export const bankImportResult = z.object({
  importId: bankId,
  imported: z.number().int(),
  duplicates: z.number().int(),
  previewHash: z.string(),
});
export const bankAccountView = bankAccountInput
  .omit({ expectedVersion: true, accountNumber: true })
  .extend({ id: bankId, version: bankVersion, accountNumberMasked: z.string() });
export const bankPayeeView = bankPayeeInput
  .omit({ expectedVersion: true, accountNumber: true })
  .extend({ id: bankId, version: bankVersion, accountNumberMasked: z.string(), partnerName: z.string() });
export const bankStatementView = bankStatementSource.extend({
  id: bankId,
  version: bankVersion,
  bankAccountId: bankId,
  reconciliationId: bankId.nullable(),
  paymentId: bankId.nullable(),
  state: z.enum(['unmatched', 'reconciled']),
});
export const bankReconciliationView = z.object({
  id: bankId,
  version: bankVersion,
  statementId: bankId,
  paymentId: bankId,
  createdPayment: z.boolean(),
  state: z.enum(['active', 'reversed']),
  reason: z.string(),
  reversedOn: bankDate.nullable(),
  reversalReason: z.string().nullable(),
});
export const bankCandidatesInput = z.object({ statementId: bankId }).strict();
export const bankCandidate = z.object({
  targetKind: z.enum(['payment', 'invoice']),
  targetId: bankId,
  targetVersion: bankVersion,
  number: z.string().nullable(),
  partnerId: bankId,
  partnerName: z.string(),
  date: bankDate,
  amount: z.string(),
  balance: z.string(),
  score: z.number().int(),
  reasons: z.array(z.string()),
});
export const bankCandidatesOutput = z.object({
  statement: bankStatementView,
  candidates: z.array(bankCandidate).max(100),
  truncated: z.boolean(),
});
export const bankReconcileInput = z
  .object({
    requestId: bankId,
    statementId: bankId,
    targetKind: z.enum(['payment', 'invoice']),
    targetId: bankId,
    targetVersion: bankVersion,
    expectedBalance: z.string().regex(/^[0-9]+$/),
    paymentDate: bankDate.optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine((input) => input.targetKind === 'invoice' || input.paymentDate === undefined, {
    path: ['paymentDate'],
    message: '既存入出金の日付は変更できません。',
  });
export const bankUndoInput = z
  .object({
    reconciliationId: bankId,
    expectedVersion: bankVersion,
    correctionDate: bankDate,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const bankTransferItem = z
  .object({
    invoiceId: bankId,
    expectedVersion: bankVersion,
    expectedBalance: bankMoney,
    payeeId: bankId,
    payeeVersion: bankVersion,
  })
  .strict();
export const bankTransferInput = z
  .object({
    requestId: bankId,
    bankAccountId: bankId,
    accountVersion: bankVersion,
    transferDate: bankDate,
    items: z.array(bankTransferItem).min(1).max(BANK_MAX_ROWS),
  })
  .strict();
export const bankTransferFormat = z.enum(['canonical_csv', 'zengin120']);
export const bankTransferSnapshot = z.object({
  account: bankIdentity.extend({ name: z.string(), ledgerAccountId: bankId, requesterCode: z.string() }),
  lines: z
    .array(
      z.object({
        invoiceId: bankId,
        invoiceVersion: bankVersion,
        number: z.string().nullable(),
        partnerId: bankId,
        partnerName: z.string(),
        payeeId: bankId,
        payeeVersion: bankVersion,
        amount: bankMoney,
        payee: bankIdentity,
      }),
    )
    .max(BANK_MAX_ROWS),
});
export const bankTransferView = z.object({
  id: bankId,
  version: bankVersion,
  bankAccountId: bankId,
  transferDate: bankDate,
  state: z.enum(['prepared', 'exported', 'cancelled']),
  itemCount: z.number().int(),
  total: z.string(),
  format: bankTransferFormat.nullable(),
  lineEnding: z.enum(['none', 'crlf']).nullable(),
  cancelReason: z.string().nullable(),
  contentHash: z.string().nullable(),
});
export const bankTransferDetail = bankTransferView.extend({ snapshot: bankTransferSnapshot });
export const bankTransferExportInput = z
  .object({
    batchId: bankId,
    expectedVersion: bankVersion,
    format: bankTransferFormat,
    lineEnding: z.enum(['none', 'crlf']),
  })
  .strict();
export const bankTransferExportOutput = z.object({
  batch: bankTransferView,
  filename: z.string(),
  contentType: z.string(),
  encoding: z.enum(['utf-8', 'shift_jis']),
  bytes: z.array(z.number().int().min(0).max(255)).max(600_000),
  sentToBank: z.literal(false),
});
export const bankTransferCancelInput = z
  .object({ batchId: bankId, expectedVersion: bankVersion, reason: z.string().trim().min(1).max(500) })
  .strict();
export const bankBoardInput = z
  .object({ bankAccountId: bankId.optional(), offset: z.number().int().min(0).max(100_000).default(0) })
  .strict();
export const bankBoardOutput = z.object({
  accounts: z.array(bankAccountView),
  payees: z.array(bankPayeeView),
  statements: z.array(bankStatementView),
  reconciliations: z.array(bankReconciliationView),
  transfers: z.array(bankTransferView),
  truncated: z.object({
    accounts: z.boolean(),
    payees: z.boolean(),
    statements: z.boolean(),
    reconciliations: z.boolean(),
    transfers: z.boolean(),
  }),
  statementTotal: z.number().int(),
  offset: z.number().int(),
});
export type BankIdentity = z.infer<typeof bankIdentity>;
export type BankSource = z.infer<typeof bankStatementSource>;
export type BankBoard = z.infer<typeof bankBoardOutput>;
export type BankCandidate = z.infer<typeof bankCandidate>;
export type BankTransferSnapshot = z.infer<typeof bankTransferSnapshot>;

// Cash forecast (docs/specs/cash-forecast.md): the input and the result `meta` / rows shared by the server actions
// banking.cash_forecast / banking.cash_schedule and the web screen /finance/cash-forecast. Day arithmetic below is on
// calendar dates only (UTC day numbers of Y-M-D), never on money.
export const CASH_SOURCES = ['sales_invoice', 'contract', 'purchase_invoice', 'bank_transfer', 'payroll'] as const;
export type CashSource = (typeof CASH_SOURCES)[number];
export const cashSource = z.enum(CASH_SOURCES);
export const cashDirection = z.enum(['in', 'out']);
export type CashDirection = z.infer<typeof cashDirection>;
export const cashState = z.enum(['submitted', 'draft']);
export type CashState = z.infer<typeof cashState>;
export const CASH_NOTICES = ['payroll_posted_overlap'] as const;
export type CashNotice = (typeof CASH_NOTICES)[number];
/** Longest period, both ends included (AC-17). */
export const CASH_MAX_DAYS = 366;
/** `to` may be at most this many days after today (AC-17). */
export const CASH_MAX_AHEAD_DAYS = 730;
/** Direction of a scheduled source (D-4): receipts for invoices to customers and contracts, payments otherwise. */
export const CASH_SOURCE_DIRECTION: Readonly<Record<CashSource, CashDirection>> = {
  sales_invoice: 'in',
  contract: 'in',
  purchase_invoice: 'out',
  bank_transfer: 'out',
  payroll: 'out',
};
/** UTC day number of a valid `YYYY-MM-DD` (calendar arithmetic only). */
export function cashDayNumber(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
}
/** `date` shifted by `days` calendar days. */
export function cashAddDays(date: string, days: number): string {
  return new Date((cashDayNumber(date) + days) * 86_400_000).toISOString().slice(0, 10);
}
export const cashDate = z.iso.date();
export const cashForecastInput = z
  .object({
    from: cashDate,
    to: cashDate,
    includeDrafts: z.boolean().optional(),
    includeOverdue: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, issues) => {
    if (input.from > input.to)
      issues.addIssue({ code: 'custom', path: ['to'], message: '終了日は開始日以後にしてください。' });
    else if (cashDayNumber(input.to) - cashDayNumber(input.from) + 1 > CASH_MAX_DAYS)
      issues.addIssue({
        code: 'custom',
        path: ['to'],
        message: `期間は${CASH_MAX_DAYS}日以内にしてください。`,
      });
  });
export type CashForecastInput = z.infer<typeof cashForecastInput>;
const cashMoney = z.string();
const cashCount = z.number().int().min(0);
const cashFlowSummary = z.object({ count: cashCount, inflow: cashMoney, outflow: cashMoney });
const cashDraftSummary = {
  draftCount: cashCount.optional(),
  draftInflow: cashMoney.optional(),
  draftOutflow: cashMoney.optional(),
};
export const cashSourceStatus = z.object({
  source: cashSource,
  included: z.boolean(),
  reason: z.literal('permission').optional(),
});
export const cashOverdue = cashFlowSummary.extend(cashDraftSummary);
export const cashCountAmount = z.object({ count: cashCount, amount: cashMoney });
export const cashScheduleMeta = z.object({
  from: cashDate,
  to: cashDate,
  today: cashDate,
  includeDrafts: z.boolean(),
  includeOverdue: z.boolean(),
  sources: z.array(cashSourceStatus),
  overdue: cashOverdue,
  beforeFrom: cashFlowSummary.extend(cashDraftSummary),
  truncated: z.boolean(),
  rowCount: cashCount,
});
export const cashForecastMeta = cashScheduleMeta.omit({ rowCount: true }).extend({
  openingBalance: cashMoney,
  openingBasis: z.enum(['ledger', 'projected']),
  ledgerBalance: cashMoney,
  closingBalance: cashMoney,
  openingBalanceWithDrafts: cashMoney.optional(),
  closingBalanceWithDrafts: cashMoney.optional(),
  minBalance: z.object({ date: cashDate, balance: cashMoney }),
  cashAccounts: z.array(z.object({ accountId: z.string(), code: z.string(), name: z.string(), balance: cashMoney })),
  missingAccountCodes: z.array(z.string()),
  unscheduledPayroll: z.object({ count: cashCount, netPay: cashMoney }).optional(),
  contractBacklog: z.object({ count: cashCount, subtotal: cashMoney }).optional(),
  unallocated: z.object({ receive: cashCountAmount, pay: cashCountAmount }),
  uncountedPaymentAccounts: z.array(
    z.object({
      accountId: z.string(),
      code: z.string(),
      name: z.string(),
      count: cashCount,
      receive: cashMoney,
      pay: cashMoney,
    }),
  ),
  notices: z.array(z.enum(CASH_NOTICES)),
});
export type CashForecastMeta = z.infer<typeof cashForecastMeta>;
export type CashScheduleMeta = z.infer<typeof cashScheduleMeta>;
/** Day columns that belong to a scheduled source (left out of the result when the source is not included). */
export const CASH_SOURCE_COLUMN: Readonly<Record<CashSource, string>> = {
  sales_invoice: 'receivables',
  contract: 'contracts',
  purchase_invoice: 'payables',
  bank_transfer: 'transfers',
  payroll: 'payroll',
};
export const cashForecastRow = z.object({
  date: cashDate,
  postedIn: cashMoney,
  postedOut: cashMoney,
  receivables: cashMoney.optional(),
  contracts: cashMoney.optional(),
  payables: cashMoney.optional(),
  transfers: cashMoney.optional(),
  payroll: cashMoney.optional(),
  inflow: cashMoney,
  outflow: cashMoney,
  net: cashMoney,
  balance: cashMoney,
  draftInflow: cashMoney.optional(),
  draftOutflow: cashMoney.optional(),
  balanceWithDrafts: cashMoney.optional(),
});
export type CashForecastRow = z.infer<typeof cashForecastRow>;
export const cashScheduleRow = z.object({
  date: cashDate,
  dueDate: cashDate,
  direction: cashDirection,
  source: cashSource,
  state: cashState,
  overdue: z.boolean(),
  inBalance: z.boolean(),
  number: z.string().nullable(),
  period: z.string().nullable(),
  partnerName: z.string().nullable(),
  count: cashCount,
  amount: cashMoney,
  partnerId: z.string().nullable(),
  salesInvoiceId: z.string().nullable(),
  purchaseInvoiceId: z.string().nullable(),
  contractId: z.string().nullable(),
});
export type CashScheduleRow = z.infer<typeof cashScheduleRow>;
