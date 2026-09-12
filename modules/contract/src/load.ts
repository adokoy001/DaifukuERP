// Reads shared by contract.generate_invoices and contract.schedule: the contracts in scope for a period, their lines,
// partner names, invoice snapshots and the company's currency scale — all through the repository port, in the
// caller's context (a role that cannot read an entity gets PERMISSION_DENIED, nothing is bypassed).
import { currencyScale, DOCSTATUS, getCompany, repo, type Context, type Decimal, type Domain, type Infer } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { SalesInvoice } from '@daifuku/mod-sales';
import { ContractLine } from './entities/contract-line.ts';
import { Contract } from './entities/contract.ts';
import { allPages, inChunks } from './ledger.ts';
import { periodStart, type Period } from './services/periods.ts';
import type { ContractTerms, TermLine } from './services/plan.ts';

export type ContractRow = Infer<typeof Contract>;
export type ContractLineRow = Infer<typeof ContractLine>;

const PAGE = 500;

export function termsOf(c: ContractRow): ContractTerms {
  return {
    status: c.status,
    startDate: c.startDate,
    endDate: c.endDate,
    intervalMonths: c.intervalMonths,
    billingDay: c.billingDay,
    billingTiming: c.billingTiming,
    prorationRule: c.prorationRule,
    roundingMode: c.roundingMode,
  };
}

/**
 * Submitted contracts that can bill `period`: active ones, and ended ones whose endDate is on or after the period start
 * (the months up to endDate stay billable after contract.end). With `contractId`, that one contract whatever its state
 * (the due check then reports `not_active`); NOT_FOUND when it does not exist or is not visible.
 */
export async function loadCandidates(ctx: Context, period: Period, contractId?: string): Promise<ContractRow[]> {
  const r = repo(ctx, Contract);
  if (contractId !== undefined) return [await r.get(contractId)];
  const where: Domain = { docstatus: DOCSTATUS.submitted, $or: [{ status: 'active' }, { status: 'ended', endDate: { $gte: periodStart(period) } }] };
  return allPages((offset) => r.list({ where, orderBy: [{ field: 'number', dir: 'asc' }], limit: PAGE, offset }));
}

export function termLineOf(l: ContractLineRow): TermLine {
  return { ext: l.ext, seq: l.seq, productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxCategory: l.taxCategory };
}

/** Lines of each contract in seq order. */
export async function linesByContract(ctx: Context, contractIds: readonly string[]): Promise<Map<string, TermLine[]>> {
  const r = repo(ctx, ContractLine);
  const orderBy = [{ field: 'contractId', dir: 'asc' as const }, { field: 'seq', dir: 'asc' as const }];
  const rows = await inChunks(contractIds, (chunk) => allPages((offset) => r.list({ where: { contractId: { $in: chunk } }, orderBy, limit: PAGE, offset })));
  const out = new Map<string, TermLine[]>();
  for (const l of rows) {
    const list = out.get(l.contractId);
    if (list) list.push(termLineOf(l));
    else out.set(l.contractId, [termLineOf(l)]);
  }
  return out;
}

export async function partnerNames(ctx: Context, ids: readonly string[]): Promise<Map<string, string>> {
  const r = repo(ctx, Partner);
  const rows = await inChunks(ids, async (chunk) => (await r.list({ where: { id: { $in: chunk } }, limit: chunk.length })).items);
  return new Map(rows.map((p) => [p.id, p.name]));
}

export interface InvoiceSnapshot {
  id: string;
  number: string | null;
  docstatus: number;
  total: Decimal;
}

export async function invoicesById(ctx: Context, ids: readonly string[]): Promise<Map<string, InvoiceSnapshot>> {
  const r = repo(ctx, SalesInvoice);
  const rows = await inChunks(ids, async (chunk) => (await r.list({ where: { id: { $in: chunk } }, limit: chunk.length })).items);
  return new Map(rows.map((i) => [i.id, { id: i.id, number: i.number, docstatus: i.docstatus, total: i.total }]));
}

/** Decimal places of the company currency (JPY 0) — the scale prorated unit prices are rounded to. */
export async function companyScale(ctx: Context): Promise<number> {
  return currencyScale((await getCompany(ctx)).currency);
}
