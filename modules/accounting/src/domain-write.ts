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

// docs/specs/opening-balances.md AC-3 (ADR-0030): the opening-balance path may submit an entry dated the opening date
// (the day before the first fiscal year starts), which no fiscal period contains. No field, no role: only the date rule.
const opening = defineWriteCapability({
  name: 'accounting.opening',
  entity: 'journal_entry',
  operations: ['opening-date'],
});
export const OPENING_OPERATION = 'opening-date';
export const withOpening = <T>(ctx: Context, work: (ctx: Context) => Promise<T>): Promise<T> =>
  withWriteCapability(ctx, opening, work);
