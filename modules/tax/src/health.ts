// Setup health check of the tax module (docs/specs/setup-health.md AC-3): a standard-rate tax rate is valid today.
import { label, repo, todayLocal, type HealthCheckDef } from '@daifuku/kernel';
import { TaxRate } from './entities/tax-rate.ts';

export const standardRateHealthCheck: HealthCheckDef = {
  id: 'tax.standard_rate',
  label: label('標準税率の有効期間', 'Standard tax rate validity'),
  order: 20,
  run: async (ctx) => {
    const today = todayLocal(ctx.now());
    const rows = await repo(ctx, TaxRate).list({
      where: { category: 'standard', validFrom: { $lte: today } },
      limit: 100,
    });
    const valid = rows.items.find((row) => !row.validTo || row.validTo >= today);
    if (!valid)
      return {
        status: 'fail',
        detail: label(
          `今日（${today}）に有効な標準税率がありません。課税の請求書の税額を計算できません。`,
          `No standard tax rate is valid today (${today}). Taxable invoices cannot be calculated.`,
        ),
        href: '/e/tax_rate',
      };
    return {
      status: 'ok',
      detail: label(
        `${valid.label}（${valid.validFrom}〜${valid.validTo ?? ''}）が有効です。`,
        `${valid.label} (${valid.validFrom} to ${valid.validTo ?? 'open-ended'}) is valid.`,
      ),
      href: '/e/tax_rate',
    };
  },
};
