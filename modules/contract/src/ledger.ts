// The contract_billing ledger (spec AC-4), read through the repository port in the caller's context.
// `withBillingWrite` marks the one code path allowed to write ledger rows (contract.generate_invoices);
// hooks/billing.ts refuses every other write, so a generic `contract_billing.create` cannot mark a period as billed.
// The mark is per Context (one transaction) and read-only to the outside, like the kernel's isSavingLines.
import {
  repo,
  defineWriteCapability,
  withWriteCapability,
  hasWriteCapability,
  type Context,
  type Infer,
  type ListResult,
} from '@daifuku/kernel';
import { ContractBilling } from './entities/contract-billing.ts';
import type { Period } from './services/periods.ts';

export type ContractBillingRow = Infer<typeof ContractBilling>;

const PAGE = 500;
const ID_CHUNK = 200;

const billingWrite = defineWriteCapability({
  name: 'contract.billing',
  entity: 'contract_billing',
  fields: ['contractId', 'period', 'invoiceId'],
  operations: ['create', 'update', 'delete'],
});
export const withBillingWrite = <T>(ctx: Context, fn: (ctx: Context) => Promise<T>): Promise<T> =>
  withWriteCapability(ctx, billingWrite, fn);
export const isBillingWrite = (ctx: Context): boolean => hasWriteCapability(ctx, 'contract_billing', 'create');

/** Every page of a list query (repo.list caps a page at 500). */
export async function allPages<T>(page: (offset: number) => Promise<ListResult<T>>): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const res = await page(offset);
    out.push(...res.items);
    offset += res.items.length;
    if (res.items.length === 0 || offset >= res.total) return out;
  }
}

/** Runs `fn` over `ids` in chunks of 200 (keeps `$in` lists short). */
export async function inChunks<T>(ids: readonly string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) out.push(...(await fn(unique.slice(i, i + ID_CHUNK))));
  return out;
}

export async function billingsOf(ctx: Context, contractId: string): Promise<ContractBillingRow[]> {
  const r = repo(ctx, ContractBilling);
  return allPages((offset) =>
    r.list({ where: { contractId }, orderBy: [{ field: 'period', dir: 'asc' }], limit: PAGE, offset }),
  );
}

/** The billing records of `period` for the given contracts, by contract id. */
export async function billingsForPeriod(
  ctx: Context,
  contractIds: readonly string[],
  period: Period,
): Promise<Map<string, ContractBillingRow>> {
  const r = repo(ctx, ContractBilling);
  const rows = await inChunks(contractIds, (chunk) =>
    allPages((offset) => r.list({ where: { period, contractId: { $in: chunk } }, limit: PAGE, offset })),
  );
  return new Map(rows.map((b) => [b.contractId, b]));
}
