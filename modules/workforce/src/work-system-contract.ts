import { z } from 'zod';
const id = z.uuid();
const date = z.iso.date();
const version = z.number().int().min(1);
const reason = z.string().trim().min(1).max(1000);
export const workSystemDay = z
  .object({
    date,
    scheduledMinutes: z.number().int().min(0).max(960),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(0).max(1440),
    statutoryHoliday: z.boolean(),
  })
  .strict();
export const workSystemData = z
  .object({
    employeeId: id,
    startsOn: date,
    endsOn: date,
    mode: z.enum(['ordinary', 'monthly_variable', 'flex']),
    weeklyMinutes: z.literal(2400),
    standardDayMinutes: z.number().int().min(1).max(960),
    agreedTotalMinutes: z.number().int().min(0).max(40000),
    days: z.array(workSystemDay).min(28).max(92),
    agreementReference: reason,
    agreementConfirmed: z.literal(true),
    employeeChoiceConfirmed: z.boolean(),
    filingConfirmed: z.boolean(),
    basis: reason,
  })
  .strict();
export const saveWorkSystemInput = workSystemData
  .extend({ periodId: id.optional(), expectedVersion: z.number().int().min(0) })
  .strict();
export const confirmWorkSystemInput = z.object({ periodId: id, expectedVersion: version, reason }).strict();
export const cancelWorkSystemInput = confirmWorkSystemInput;
export const workSystemSummary = workSystemData.extend({
  id,
  status: z.enum(['draft', 'confirmed', 'cancelled']),
  confirmedAt: z.iso.datetime({ offset: true }).nullable(),
  version,
});
export const workSystemBoardInput = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();
export const workSystemBoardOutput = z.object({
  employees: z.array(z.object({ id, name: z.string(), code: z.string(), siteId: id })),
  periods: z.array(workSystemSummary),
});
export type WorkSystemInput = z.infer<typeof workSystemData>;
export type WorkSystemBoard = z.infer<typeof workSystemBoardOutput>;
