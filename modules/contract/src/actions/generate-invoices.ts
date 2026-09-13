// contract.generate_invoices (spec AC-3/AC-4): one sales_invoice per contract whose period is due.
// For each contract in scope (loadCandidates) the pure planPeriod decides due / generated / not_due and the invoice
// lines (monthly unit price × period factor, rounded once per line with the contract's rounding mode to the currency
// scale — the "pre-round" choice of AC-3). A due contract gets, in the caller's context and transaction:
//   1. a draft sales_invoice through the sales repository + kernel saveLines (sales derives due date, tax, totals);
//   2. its contract_billing row (unique contract+period: a concurrent run for the same period fails here, before any
//      posting, and its whole transaction — invoice included — rolls back);
//   3. `sales_invoice.submit` through runAction when `submit` (default: setting contract.auto_submit), which posts;
//   4. a touch of the contract, whose before_update re-derives nextPeriod from the ledger.
// Already generated periods are reported in `skipped` with the existing invoice. The run is all-or-nothing: the kernel
// has no savepoint port, so one failing contract (e.g. a missing tax rate or account) fails the whole call.
import { defineAction, label, repo, runAction, saveLines, withLock, type Context } from '@daifuku/kernel';
import { SalesInvoice, SalesInvoiceLine, postingDimensions } from '@daifuku/mod-sales';
import { z } from 'zod';
import { ContractBilling } from '../entities/contract-billing.ts';
import { Contract } from '../entities/contract.ts';
import { billingsForPeriod, withBillingWrite } from '../ledger.ts';
import { companyScale, invoicesById, linesByContract, loadCandidates, termsOf, type ContractRow } from '../load.ts';
import { PERIOD_PATTERN, type Period } from '../services/periods.ts';
import { planPeriod, SKIP_REASONS, type DuePlan } from '../services/plan.ts';
import { formatFraction } from '../services/proration.ts';
import { loadAutoSubmit } from '../settings.ts';

export const INVOICE_GENERATED_EVENT = 'contract.invoice_generated';

export const periodInput = z.string().regex(PERIOD_PATTERN, 'must be YYYY-MM');

export const generateInvoicesInput = z.object({
  period: periodInput,
  contractId: z.uuid().optional(),
  submit: z.boolean().optional(),
});
export type GenerateInvoicesInput = z.output<typeof generateInvoicesInput>;

const createdItem = z.object({
  contractId: z.uuid(),
  invoiceId: z.uuid(),
  number: z.string().nullable(),
  total: z.string(),
});
const skippedItem = z.object({
  contractId: z.uuid(),
  reason: z.enum(SKIP_REASONS),
  /** already_generated: the invoice that bills the period. */
  invoiceId: z.uuid().optional(),
  number: z.string().nullable().optional(),
});

export const generateInvoicesOutput = z.object({ created: z.array(createdItem), skipped: z.array(skippedItem) });
export type GenerateInvoicesResult = z.output<typeof generateInvoicesOutput>;
type CreatedItem = z.output<typeof createdItem>;

/** Invoice note (AC-3): `契約 CTR-2026-000001 2026-09 分`. */
export function invoiceNote(contractNumber: string, period: Period): string {
  return `契約 ${contractNumber} ${period} 分`;
}

async function createInvoice(
  ctx: Context,
  contract: ContractRow,
  plan: DuePlan,
  period: Period,
  submit: boolean,
): Promise<CreatedItem> {
  const invoices = repo(ctx, SalesInvoice);
  const head = await invoices.create({
    partnerId: contract.partnerId,
    ext: postingDimensions(Contract.name, SalesInvoice.name, contract.ext),
    date: plan.billingDate,
    // contract prices are tax-exclusive (税抜), whatever the company's input default is
    priceIncludesTax: false,
    note: invoiceNote(contract.number ?? contract.id, period),
  });
  const lines = plan.lines.map((l) => ({
    productId: l.productId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    taxCategory: l.taxCategory,
    ext: postingDimensions('contract_line', SalesInvoiceLine.name, l.ext),
  }));
  await saveLines(ctx, SalesInvoice, head.id, { [SalesInvoiceLine.name]: lines });
  await withBillingWrite(ctx, (ctx) =>
    repo(ctx, ContractBilling).create({ contractId: contract.id, period, invoiceId: head.id }),
  );
  if (submit) await runAction(ctx, 'sales_invoice.submit', { id: head.id });
  await repo(ctx, Contract).update(contract.id, {});
  const invoice = await invoices.get(head.id);
  const item = {
    contractId: contract.id,
    invoiceId: invoice.id,
    number: invoice.number,
    total: invoice.total.toString(),
  };
  await ctx.emit(INVOICE_GENERATED_EVENT, {
    ...item,
    contractNumber: contract.number,
    period,
    factor: formatFraction(plan.factor),
    submitted: submit,
  });
  return item;
}

async function createLogged(
  ctx: Context,
  contract: ContractRow,
  plan: DuePlan,
  period: Period,
  submit: boolean,
): Promise<CreatedItem> {
  try {
    return await createInvoice(ctx, contract, plan, period, submit);
  } catch (err) {
    ctx.log.warn('contract invoice generation failed; the whole run is rolled back', {
      contractId: contract.id,
      contractNumber: contract.number,
      period,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function generateInvoices(ctx: Context, input: GenerateInvoicesInput): Promise<GenerateInvoicesResult> {
  await withLock(ctx, 'contract-billing-series', async () => undefined);
  const submit = input.submit ?? (await loadAutoSubmit(ctx));
  const candidates = await loadCandidates(ctx, input.period, input.contractId);
  const contracts: ContractRow[] = [];
  for (const candidate of candidates.sort((a, b) => a.id.localeCompare(b.id)))
    contracts.push(await repo(ctx, Contract).lock(candidate.id));
  const ids = contracts.map((c) => c.id);
  const billings = await billingsForPeriod(ctx, ids, input.period);
  const lines = await linesByContract(ctx, ids);
  const scale = await companyScale(ctx);
  const existing = await invoicesById(
    ctx,
    [...billings.values()].map((b) => b.invoiceId),
  );
  const result: GenerateInvoicesResult = { created: [], skipped: [] };
  for (const contract of contracts) {
    const billing = billings.get(contract.id);
    const plan = planPeriod({
      terms: termsOf(contract),
      lines: lines.get(contract.id) ?? [],
      period: input.period,
      alreadyGenerated: billing !== undefined,
      scale,
    });
    if (plan.status === 'due') {
      result.created.push(await createLogged(ctx, contract, plan, input.period, submit));
      continue;
    }
    const { reason } = plan;
    result.skipped.push(
      billing
        ? {
            contractId: contract.id,
            reason,
            invoiceId: billing.invoiceId,
            number: existing.get(billing.invoiceId)?.number ?? null,
          }
        : { contractId: contract.id, reason },
    );
  }
  return result;
}

export const generateInvoicesAction = defineAction({
  name: 'contract.generate_invoices',
  description: label(
    '対象月（period, YYYY-MM）の請求が来ている契約ごとに売上請求書を 1 枚作ります。単価は月額 × 日割り係数（開始月は開始日から、終了月は終了日まで、当月の実日数で按分）を契約の端数処理で円に丸めた額、請求日は billingDay（後払いは翌月）。同じ契約・対象月は 2 回作りません（skipped に既存の請求書）。submit=true（省略時は設定 contract.auto_submit）なら確定・転記まで行います。contractId で 1 契約に絞れます。',
    'Creates one sales invoice per contract whose period (YYYY-MM) is due. Unit prices are the monthly price × the proration factor (first month from startDate, last month to endDate, by the actual days of the month) rounded with the contract rounding mode; the invoice date is billingDay (next month for arrears). A contract/period is never billed twice (skipped lists the existing invoice). submit=true (default: setting contract.auto_submit) also submits and posts. contractId limits the run to one contract.',
  ),
  input: generateInvoicesInput,
  output: generateInvoicesOutput,
  permission: { entity: SalesInvoice.name, op: 'create' },
  handler: (ctx, input) => generateInvoices(ctx, input),
});
