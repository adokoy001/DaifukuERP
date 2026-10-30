// Company-aware helpers shared by the hooks and actions: reads through the caller's Repository only (ADR-0007).
import {
  Decimal,
  DOCSTATUS,
  getCompany,
  repo,
  type Context,
  type EntityDef,
  type Infer,
  type LocalDate,
} from '@daifuku/kernel';
import { resolveCreditRatio } from '@daifuku/mod-purchase';
import { loadTaxRates, loadTaxSettings, taxScaleForCurrency, type TaxCategory } from '@daifuku/mod-tax';
import type { WorkforceExpense } from '@daifuku/mod-workforce';
import { KIND_PAYMENT_METHOD, type ExpenseSettlementKind, type InvoiceKind } from '../contract.ts';
import { ExpenseSettlement, ExpenseSettlementLine } from '../entities/index.ts';
import { computeSettlementTax, type SettlementTax, type TaxLineInput, type TaxSettings } from './tax.ts';

export type SettlementRow = Infer<typeof ExpenseSettlement>;
export type SettlementLineRow = Infer<typeof ExpenseSettlementLine>;
export type ExpenseRow = Infer<typeof WorkforceExpense>;
export interface ValidationIssue {
  path: string;
  message: string;
}

export async function loadLines(ctx: Context, settlementId: string): Promise<SettlementLineRow[]> {
  return (
    await repo(ctx, ExpenseSettlementLine).list({
      where: { settlementId },
      orderBy: [{ field: 'seq', dir: 'asc' }],
      limit: 500,
    })
  ).items;
}

export async function taxSettingsFor(ctx: Context): Promise<TaxSettings> {
  const [rates, settings, company] = [await loadTaxRates(ctx), await loadTaxSettings(ctx), await getCompany(ctx)];
  return {
    rates,
    rounding: { mode: settings.rounding.mode, scale: taxScaleForCurrency(company.currency) },
    // D20/D21: the purchase override point gives the 経過措置 ratio for a supplier without a qualified invoice.
    transitionalRatio: (date: LocalDate) => resolveCreditRatio({ supplierTaxStatus: 'exempt', date }),
  };
}

export function taxInput(line: SettlementLineRow, fallbackDate: LocalDate): TaxLineInput {
  return {
    seq: line.seq,
    expenseId: line.expenseId,
    expenseDate: (line.expenseDate ?? fallbackDate) as LocalDate,
    accountId: line.accountId,
    taxCategory: line.taxCategory as TaxCategory,
    amount: line.amount,
    invoiceKind: (line.invoiceKind ?? null) as InvoiceKind | null,
  };
}

export async function computeFor(ctx: Context, lines: readonly SettlementLineRow[], date: LocalDate) {
  const settings = await taxSettingsFor(ctx);
  return {
    settings,
    tax: computeSettlementTax(
      lines.map((l) => taxInput(l, date)),
      settings,
    ),
  };
}

/** The server-owned fields of a line for its computed tax; only the changed ones (none when up to date). */
export function lineTaxPatch(line: SettlementLineRow, tax: SettlementTax['lines'][number]): Record<string, unknown> {
  const next: Record<string, Decimal | null> = {
    taxRate: tax.taxRate,
    taxableAmount: tax.taxableAmount,
    taxAmount: tax.taxAmount,
    deductibleTax: tax.deductibleTax,
    nonDeductibleTax: tax.nonDeductibleTax,
    creditRatio: tax.creditRatio,
  };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    const current = (line as unknown as Record<string, unknown>)[key] as Decimal | null | undefined;
    const same = value === null ? current === null || current === undefined : !!current && value.eq(current);
    if (!same) patch[key] = value;
  }
  return patch;
}

/**
 * AC-4 conditions of one line against its settlement (also re-run at submit, AC-6): the expense exists and is readable,
 * same employee and site, approved, and paid with the method the kind settles.
 */
export function expenseIssues(
  head: { employeeId: string; siteId: string; kind: ExpenseSettlementKind },
  expense: ExpenseRow | null,
  path: string,
): ValidationIssue[] {
  if (!expense) return [{ path, message: 'expense does not exist or is not visible to you' }];
  const issues: ValidationIssue[] = [];
  if (expense.employeeId !== head.employeeId)
    issues.push({ path, message: "expense belongs to another employee than the settlement's" });
  if (expense.siteId !== head.siteId) issues.push({ path, message: 'expense belongs to another site (one per site)' });
  if (expense.status !== 'approved') issues.push({ path, message: `expense is ${expense.status}, not approved` });
  if (expense.paymentMethod !== KIND_PAYMENT_METHOD[head.kind])
    issues.push({
      path,
      message: `expense was paid ${expense.paymentMethod}; a ${head.kind} settlement takes ${KIND_PAYMENT_METHOD[head.kind]}`,
    });
  return issues;
}

/** The id of a draft or submitted settlement (other than `excludeId`) that already contains the expense, or null. */
export async function liveSettlementOf(
  ctx: Context,
  expenseId: string,
  excludeId: string | null,
): Promise<string | null> {
  const lines = await repo(ctx, ExpenseSettlementLine).list({ where: { expenseId }, limit: 500 });
  const ids = [...new Set(lines.items.map((l) => l.settlementId))].filter((id) => id !== excludeId);
  if (ids.length === 0) return null;
  const live = await repo(ctx, ExpenseSettlement).list({
    where: { id: { $in: ids }, docstatus: { $in: [DOCSTATUS.draft, DOCSTATUS.submitted] } },
    limit: 1,
  });
  return live.items[0]?.id ?? null;
}

/** Rows of `entity` with these ids that the caller can read, in chunks of the 500-row list limit. */
export async function byIds<E extends EntityDef>(ctx: Context, entity: E, ids: readonly string[]): Promise<Infer<E>[]> {
  const out: Infer<E>[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    out.push(...(await repo(ctx, entity).list({ where: { id: { $in: chunk } }, limit: 500 })).items);
  }
  return out;
}

/** Every line of every settlement (any status) that names one of `expenseIds`, paged past the 500-row list limit. */
async function linesOf(ctx: Context, expenseIds: readonly string[]): Promise<SettlementLineRow[]> {
  const lines: SettlementLineRow[] = [];
  for (let i = 0; i < expenseIds.length; i += 500) {
    const chunk = expenseIds.slice(i, i + 500);
    for (let offset = 0; ; offset += 500) {
      const page = await repo(ctx, ExpenseSettlementLine).list({
        where: { expenseId: { $in: chunk } },
        orderBy: [{ field: 'id', dir: 'asc' }],
        limit: 500,
        offset,
      });
      lines.push(...page.items);
      if (!page.items.length || offset + page.items.length >= page.total) break;
    }
  }
  return lines;
}

/** expense id -> docstatus of the draft/submitted settlement that holds it. */
export async function heldBy(ctx: Context, expenseIds: readonly string[]): Promise<Map<string, number>> {
  const lines = await linesOf(ctx, expenseIds);
  const settlements = await byIds(
    ctx,
    ExpenseSettlement,
    lines.map((l) => l.settlementId),
  );
  const live = new Map(
    settlements.filter((s) => s.docstatus !== DOCSTATUS.cancelled).map((s) => [s.id, s.docstatus] as const),
  );
  const out = new Map<string, number>();
  for (const line of lines) {
    const status = live.get(line.settlementId);
    if (status !== undefined) out.set(line.expenseId, status);
  }
  return out;
}

export function zeroIfMissing(value: unknown): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === 'string' && Decimal.isDecimalString(value)) return Decimal.from(value);
  return Decimal.zero();
}
