// Draft recalculation (spec AC-5): the one place a draft settlement's computed fields are derived. Runs once per
// replace-all line save (header `after_lines_saved`) and once per direct line write (hooks/lines.ts), never while the
// kernel is still replacing the line set. Line tax depends on the other lines of the same receipt (D7), so every line
// is recomputed and only the changed ones are written, through the module capability (hooks skip internal writes).
import { DOCSTATUS, repo, type Context, type LocalDate } from '@daifuku/kernel';
import { ExpenseSettlement, ExpenseSettlementLine } from '../entities/index.ts';
import { internalWrite } from '../internal.ts';
import { computeFor, lineTaxPatch, loadLines } from '../services/load.ts';
import { taxSummaryJson } from '../services/tax.ts';

export async function recalculateSettlement(ctx: Context, id: string): Promise<void> {
  const head = await repo(ctx, ExpenseSettlement).find(id);
  if (!head || head.docstatus !== DOCSTATUS.draft) return;
  const lines = await loadLines(ctx, id);
  const { settings, tax } = await computeFor(ctx, lines, head.date as LocalDate);
  for (const [i, line] of lines.entries()) {
    const computed = tax.lines[i];
    const patch = computed ? lineTaxPatch(line, computed) : {};
    if (Object.keys(patch).length > 0)
      await internalWrite(ctx, ExpenseSettlementLine, (write) =>
        repo(write, ExpenseSettlementLine).update(line.id, patch),
      );
  }
  await internalWrite(ctx, ExpenseSettlement, (write) =>
    repo(write, ExpenseSettlement).update(id, {
      subtotal: tax.totals.subtotal,
      taxTotal: tax.totals.taxTotal,
      deductibleTax: tax.totals.deductibleTax,
      nonDeductibleTax: tax.totals.nonDeductibleTax,
      total: tax.totals.total,
      taxSummary: lines.length > 0 ? taxSummaryJson(tax, settings.rounding) : null,
    }),
  );
}
