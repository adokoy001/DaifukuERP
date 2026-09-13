import { defineWriteCapability, withWriteCapability, type Context } from '@daifuku/kernel';

const posting = defineWriteCapability({
  name: 'accounting.posting',
  entity: 'journal_entry',
  fields: ['sourceEntity', 'sourceId', 'reversalOf'],
  operations: ['create', 'reverse-source'],
});
const stamp = defineWriteCapability({
  name: 'accounting.stamp',
  entity: 'journal_line',
  fields: ['entryDate', 'posted', 'accountType', 'accountTaxRole'],
  operations: ['update'],
});

/** Module-private capabilities keep audit and all ordinary caller permissions intact. */
export const withPosting = <T>(ctx: Context, work: (ctx: Context) => Promise<T>): Promise<T> =>
  withWriteCapability(ctx, posting, work);
export const withStamp = <T>(ctx: Context, work: (ctx: Context) => Promise<T>): Promise<T> =>
  withWriteCapability(ctx, stamp, work);
