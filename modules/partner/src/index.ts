// @daifuku/mod-partner public API. Importing this module registers the partner entity, action and hooks.
import type { Infer, InsertInput, UpdateInput } from '@daifuku/kernel';
import type { Partner } from './entities/partner.ts';

export { PartnerModule } from './module.ts';
export { Partner } from './entities/partner.ts';
export { computeDueDateAction } from './actions/compute-due-date.ts';
export { computeDueDate, resolveDueDate, closingDateOf, daysInMonth, END_OF_MONTH, type PaymentTerms, type DueDateResult } from './services/due-date.ts';
export { SEED_PARTNERS, seedPartners } from './seeds/partners.ts';

export type PartnerRow = Infer<typeof Partner>;
export type PartnerInsert = InsertInput<typeof Partner>;
export type PartnerUpdate = UpdateInput<typeof Partner>;
