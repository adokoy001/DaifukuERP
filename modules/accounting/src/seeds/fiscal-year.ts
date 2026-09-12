// Spec AC-11: no chart of accounts here (l10n/jp owns it). Seed only a Jan–Dec fiscal year for the current year
// when the company has none; a no-op otherwise (idempotent).
import { repo, todayLocal, type Context } from '@daifuku/kernel';
import { FiscalYear } from '../entities/fiscal-year.ts';
import { openFiscalYear } from '../actions/open-fiscal-year.ts';

export async function seedFiscalYear(ctx: Context): Promise<void> {
  if ((await repo(ctx, FiscalYear).count()) > 0) return;
  const year = todayLocal(ctx.now()).slice(0, 4);
  await openFiscalYear(ctx, { startDate: `${year}-01-01` });
}
