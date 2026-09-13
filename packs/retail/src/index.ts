// @daifuku/pack-retail public API (docs/specs/pack-retail.md). Importing it registers the modules it depends on and then the
// pack: ext on product/partner, retail_closing (+ lines), retail_month_close, retail.daily_sales / retail.close_month,
// hooks, labels, menus. Apps load it after modules and l10n (ADR-0015); applying it to a company is pack.apply.
import type { Infer } from '@daifuku/kernel';
import type { RetailClosingLine } from './entities/retail-closing-line.ts';
import type { RetailClosing } from './entities/retail-closing.ts';
import type { RetailMonthClose } from './entities/retail-month-close.ts';

export { RetailPack } from './pack.ts';
export { RetailClosing } from './entities/retail-closing.ts';
export { RetailClosingLine } from './entities/retail-closing-line.ts';
export { RetailMonthClose, PERIOD_RE } from './entities/retail-month-close.ts';

export {
  dailySalesAction,
  dailySales,
  dailySalesInput,
  dailySalesColumns,
  type DailySalesInput,
} from './actions/daily-sales.ts';
export {
  closeMonthAction,
  closeMonth,
  closeMonthInput,
  closeMonthOutput,
  MONTH_CLOSE_WRITE_HINT,
  ORDER_HINT,
} from './actions/close-month.ts';
export {
  closingTotals,
  lineAmount,
  tenderCheck,
  tenderHint,
  ratePercentKey,
  type ClosingTaxLine,
  type TenderCheck,
} from './services/closing-totals.ts';
export {
  monthCloseLines,
  periodRange,
  previousClose,
  laterCloses,
  MEMO as MONTH_CLOSE_MEMO,
  type MonthCloseAmounts,
  type PeriodRange,
} from './services/month-close.ts';
export {
  aggregateDaily,
  taxColumnsOf,
  type ClosingForReport,
  type DailyAggregate,
  type TaxColumn,
} from './services/daily-sales.ts';
export { FROZEN_HINT } from './hooks/lines.ts';
export { WALK_IN_HINT, WAREHOUSE_HINT } from './hooks/submit.ts';

export { seedRetail, RETAIL_ACCOUNTS, WALK_IN_CODE, RETAIL_KINDS, type RetailKind } from './seed.ts';
export { sampleRetail, SAMPLE_PRODUCTS, SAMPLE_SUPPLIER_CODE } from './sample.ts';
export {
  CLOSING_ACCOUNTS_KEY,
  CLOSING_ACCOUNTS_DEFAULT,
  CLOSING_ACCOUNTS_SETTING,
  closingAccountsSchema,
  RETAIL_SETTING_DEFAULTS,
  resolveClosingAccounts,
  type ClosingAccountCodes,
  type ClosingAccountIds,
} from './settings.ts';

export type RetailClosingRow = Infer<typeof RetailClosing>;
export type RetailClosingLineRow = Infer<typeof RetailClosingLine>;
export type RetailMonthCloseRow = Infer<typeof RetailMonthClose>;
