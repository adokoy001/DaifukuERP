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
