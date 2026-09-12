import { defineWriteCapability, withWriteCapability, type Context } from '@daifuku/kernel';
const links = defineWriteCapability({
  name: 'restaurant_chain.closing-links', entity: 'restaurant_chain_closing',
  fields: ['salesInvoiceId', 'paymentId', 'consumptionEntryId', 'wasteEntryId', 'consumptionCost', 'wasteCost'],
  operations: ['update'],
});
export function withClosingLinks<T>(ctx: Context, work: (internal: Context) => Promise<T>): Promise<T> {
  return withWriteCapability(ctx, links, work);
}

const review = defineWriteCapability({ name: 'restaurant_chain.review', entity: 'restaurant_chain_closing', fields: ['reviewStatus', 'submittedAt', 'submittedBy', 'reviewedAt', 'reviewedBy', 'reviewNote'], operations: ['update'] });
export function withClosingReview<T>(ctx: Context, work: (internal: Context) => Promise<T>): Promise<T> { return withWriteCapability(ctx, review, work); }
