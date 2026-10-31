// Setup health check of the accounting module (docs/specs/setup-health.md AC-2): an open fiscal period contains today
// (the company's business date), and periods continue for the next FISCAL_PERIOD_HORIZON_DAYS days.
import { label, repo, todayLocal, type Context, type HealthCheckDef, type LocalDate } from '@daifuku/kernel';
import { FiscalPeriod } from './entities/fiscal-period.ts';

/** How far ahead periods must exist before the check warns (fixed in v1; spec open question). */
export const FISCAL_PERIOD_HORIZON_DAYS = 30;
const OPEN_FISCAL_YEAR = '/a/accounting.open_fiscal_year';

function addDays(date: LocalDate, days: number): LocalDate {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10) as LocalDate;
}

async function periodOn(ctx: Context, date: LocalDate) {
  const found = await repo(ctx, FiscalPeriod).list({
    where: { startDate: { $lte: date }, endDate: { $gte: date } },
    limit: 1,
  });
  return found.items[0];
}

export const fiscalPeriodHealthCheck: HealthCheckDef = {
  id: 'accounting.fiscal_period',
  label: label('今日を含む会計期間', 'Fiscal period for today'),
  order: 10,
  run: async (ctx) => {
    const today = todayLocal(ctx.now());
    const current = await periodOn(ctx, today);
    if (!current)
      return {
        status: 'fail',
        detail: label(
          `今日（${today}）を含む会計期間がありません。会計年度を作成するまで仕訳・請求書を確定できません。`,
          `No fiscal period contains today (${today}). Entries and invoices cannot be submitted until a fiscal year is opened.`,
        ),
        href: OPEN_FISCAL_YEAR,
      };
    if (current.isClosed)
      return {
        status: 'fail',
        detail: label(
          `今日を含む会計期間 ${current.code} は締め済みです。今日の日付の伝票を確定できません。`,
          `The fiscal period for today, ${current.code}, is closed. Documents dated today cannot be submitted.`,
        ),
        href: '/finance/close',
      };
    const horizon = addDays(today, FISCAL_PERIOD_HORIZON_DAYS);
    if (!(await periodOn(ctx, horizon)))
      return {
        status: 'warn',
        detail: label(
          `${current.endDate} より後の会計期間がありません（${FISCAL_PERIOD_HORIZON_DAYS} 日以内に尽きます）。翌年度を作成してください。`,
          `No fiscal period exists after ${current.endDate} (periods run out within ${FISCAL_PERIOD_HORIZON_DAYS} days). Open the next fiscal year.`,
        ),
        href: OPEN_FISCAL_YEAR,
      };
    return {
      status: 'ok',
      detail: label(
        `${current.code}（${current.startDate}〜${current.endDate}）が開いています。`,
        `${current.code} (${current.startDate} to ${current.endDate}) is open.`,
      ),
      href: '/e/fiscal_period',
    };
  },
};
