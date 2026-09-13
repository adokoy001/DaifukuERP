import { z } from 'zod';
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/),
  id = z.uuid();
export const groupMapping = z
  .object({
    companyId: id,
    accountId: id,
    groupCode: z.string().trim().min(1).max(40),
    groupName: z.string().trim().min(1).max(100),
    groupType: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  })
  .strict();
export const adjustment = z
  .object({
    key: z.string().min(1).max(80),
    kind: z.enum(['elimination', 'adjustment']),
    description: z.string().trim().min(1).max(500),
    lines: z
      .array(z.object({ groupCode: z.string().min(1).max(40), debit: decimal, credit: decimal }).strict())
      .min(2)
      .max(100),
  })
  .strict();
export const sourceInput = z
  .object({ companyIds: z.array(id).min(1).max(20), from: z.iso.date(), to: z.iso.date() })
  .strict()
  .refine((i) => i.from <= i.to, 'The period must be ordered');
export const prepareInput = z
  .object({
    runId: id.optional(),
    expectedVersion: z.number().int().min(0),
    name: z.string().trim().min(1).max(100),
    companyIds: z.array(id).min(1).max(20),
    from: z.iso.date(),
    to: z.iso.date(),
    mapping: z.array(groupMapping).min(1).max(10000),
    adjustments: z.array(adjustment).max(200),
    reviewBasis: z.string().trim().min(1).max(2000),
  })
  .strict();
export const command = z.object({ id, version: z.number().int(), status: z.string() });
export const changeInput = z
  .object({ runId: id, expectedVersion: z.number().int().min(1), reason: z.string().trim().min(1).max(1000) })
  .strict();
export const sourceRow = z.object({
  accountId: id,
  code: z.string(),
  name: z.string(),
  type: z.string(),
  openingDebit: decimal,
  openingCredit: decimal,
  periodDebit: decimal,
  periodCredit: decimal,
  closingBalance: decimal,
});
export const companySource = z.object({
  companyId: id,
  code: z.string(),
  name: z.string(),
  currency: z.literal('JPY'),
  closed: z.boolean(),
  revision: z.string(),
  rows: z.array(sourceRow),
});
export const groupRow = z.object({
  code: z.string(),
  name: z.string(),
  type: z.string(),
  standalone: decimal,
  elimination: decimal,
  adjustment: decimal,
  consolidated: decimal,
  debit: decimal,
  credit: decimal,
});
export const groupResult = z.object({
  rows: z.array(groupRow),
  debit: decimal,
  credit: decimal,
  balanced: z.boolean(),
});
export const boardOutput = z.object({
  id,
  version: z.number().int(),
  name: z.string(),
  from: z.string(),
  to: z.string(),
  status: z.string(),
  sources: z.array(companySource),
  mapping: z.array(groupMapping),
  adjustments: z.array(adjustment),
  result: groupResult,
  reviewBasis: z.string(),
  confirmedAt: z.string().nullable(),
  reason: z.string().nullable(),
});
export type GroupMapping = z.infer<typeof groupMapping>;
export type GroupAdjustment = z.infer<typeof adjustment>;
export type CompanySource = z.infer<typeof companySource>;
export type GroupResult = z.infer<typeof groupResult>;
export type GroupBoard = z.infer<typeof boardOutput>;
