// navigation-assist AC-6: route -> manual chapter for the "help for this screen" link in the screen trail.
// Chapters are file names under docs/manual/ (help.test.ts checks that each file and section heading exists).
// The link base is VITE_MANUAL_URL, by default the public repository's docs/manual/. Pure.

export const DEFAULT_MANUAL_URL = 'https://github.com/adokoy001/DaifukuERP/blob/main/docs/manual/';

export interface HelpTopic {
  /** File name under docs/manual/, e.g. `04-masters.md`. */
  chapter: string;
  /** A level-2 heading of that chapter, written exactly as its GitHub anchor (headings without punctuation). */
  section?: string;
}

const topic = (chapter: string, section?: string): HelpTopic => (section ? { chapter, section } : { chapter });
const NAVIGATION = topic('appendix-n-navigation.md');
const ANALYTICS = topic('appendix-m-analytics.md');
const WORKFORCE = topic('appendix-f-workforce.md');
const FISCAL = topic('appendix-i-fiscal-and-work-systems.md');
const ENTERPRISE = topic('appendix-h-enterprise-operations.md');
const COMMERCE = topic('appendix-l-commerce-bank-filing.md');
const CASH_FORECAST = topic('appendix-l-commerce-bank-filing.md', '資金繰り表');
const INDUSTRY = topic('appendix-d-industry-templates.md');
const DEVICES = topic('appendix-j-store-devices.md');
const MONTHLY = '06-monthly.md';
const EXPENSES = topic('expense-settlement.md');
const FIXED_ASSETS = topic('appendix-o-fixed-assets.md');

/** Dedicated screens (navigation-data.ts) and the fixed generic routes. */
const SCREENS: Readonly<Record<string, HelpTopic>> = {
  '/workspaces': NAVIGATION,
  '/analytics': ANALYTICS,
  '/reports': ANALYTICS,
  '/settings': topic('03-setup.md', '設定画面'),
  '/templates': INDUSTRY,
  '/admin/users': topic('08-admin.md'),
  '/admin/companies': topic('08-admin.md', '会社の追加と編集'),
  '/admin/tokens': topic('08-admin.md', 'api-キーの発行と失効'),
  '/admin/health': topic('08-admin.md', '導入チェック'),
  // docs/specs/setup-wizard.md AC-28: the wizard is the main path of the setup chapter.
  '/setup': topic('03-setup.md', 'セットアップウィザード'),
  '/admin/permissions': topic('08-admin.md', '権限マトリクス'),
  '/admin/audit': topic('08-admin.md', '監査ログの検索'),
  '/admin/event-deliveries': topic('08-admin.md', 'イベント配送と Webhook'),
  '/operations': topic('appendix-e-operations-control.md'),
  '/operations/devices': DEVICES,
  '/me': WORKFORCE,
  '/workforce': WORKFORCE,
  '/workforce/shifts': WORKFORCE,
  '/workforce/payroll': FISCAL,
  '/workforce/systems': FISCAL,
  '/commerce/pos': ENTERPRISE,
  '/commerce/group': ENTERPRISE,
  '/commerce/franchise': ENTERPRISE,
  '/commerce/trade': COMMERCE,
  '/finance/banking': COMMERCE,
  '/finance/cash-forecast': CASH_FORECAST,
  '/finance/filing': COMMERCE,
  // Screens of the same round (docs/specs/inbox.md, close-guide.md), mapped to the chapters those specs update.
  '/inbox': NAVIGATION,
  '/finance/close': topic(MONTHLY),
  // docs/specs/opening-balances.md AC-31: the setup chapter explains the opening balance import.
  '/finance/opening': topic('03-setup.md', '期首残高の取込'),
  // docs/specs/recurring-journals.md AC-24
  '/finance/recurring': topic(MONTHLY, '定期仕訳を生成する'),
  // docs/specs/evidence-search.md AC-12
  '/finance/evidence': topic('02-basics.md', '証憑の検索'),
  // expense-settlement (docs/specs/expense-settlement.md D19)
  '/finance/expenses': EXPENSES,
  // docs/specs/fixed-assets.md AC-33
  '/finance/depreciation': FIXED_ASSETS,
};
/** Reports explained in the monthly chapter; every other table report uses the report-screen appendix. */
const REPORTS: Readonly<Record<string, HelpTopic>> = {
  'accounting.trial_balance': topic(MONTHLY, '試算表'),
  'accounting.general_ledger': topic(MONTHLY, '総勘定元帳'),
  'accounting.tax_period_summary': topic(MONTHLY, '消費税集計表'),
  'sales.ar_aging': topic(MONTHLY),
  'purchase.ap_aging': topic(MONTHLY),
  'inventory.valuation': topic(MONTHLY, '在庫評価'),
  'banking.cash_forecast': CASH_FORECAST,
  'banking.cash_schedule': CASH_FORECAST,
  'fixed_assets.depreciation_schedule': topic('appendix-o-fixed-assets.md', '減価償却明細表'),
  'fixed_assets.property_tax_summary': topic('appendix-o-fixed-assets.md', '償却資産申告の集計'),
};
/** Generic action forms with a manual section; other `/a/...` forms have no link. */
const ACTIONS: Readonly<Record<string, HelpTopic>> = {
  'accounting.close_period': topic(MONTHLY, '期間の締め'),
  'accounting.reopen_period': topic(MONTHLY, '期間の締め'),
};
/** Entity list/new/detail screens, first match wins; any other entity uses the screen basics chapter. */
const ENTITIES: readonly (readonly [RegExp, HelpTopic])[] = [
  [/^partner$/, topic('04-masters.md', '取引先')],
  [/^(?:product|uom)$/, topic('04-masters.md', '品目と単位')],
  [/^warehouse$/, topic('04-masters.md', '倉庫')],
  [/^account$/, topic('03-setup.md', '勘定科目')],
  [/^tax_rate$/, topic('03-setup.md', '税率')],
  [/^fiscal_(?:year|period)$/, topic('03-setup.md', '会計年度と会計期間')],
  [/^sales_invoice$/, topic('05-daily.md', '売上請求書を作る')],
  [/^(?:purchase_invoice|payment)$/, topic('05-daily.md')],
  [/^journal_entry$/, topic('05-daily.md', '仕訳を入力する')],
  [/^recurring_journal(?:_run)?$/, topic('05-daily.md', '定期仕訳を登録する')],
  [/^(?:stock_entry|stock_count)$/, topic('05-daily.md', '在庫の入出庫と棚卸')],
  [/^workforce_/, WORKFORCE],
  [/^(?:retail|real_estate)_/, topic('07-templates.md')],
  [/^(?:trade|bank|filing)_/, COMMERCE],
  [/^(?:restaurant_chain|appliance_store|farm)_/, INDUSTRY],
  [/^(?:franchise|group_accounting|pos_integration)_/, ENTERPRISE],
  [/^edge_/, DEVICES],
  [/^expense_(?:settlement|advance)$/, EXPENSES],
  [/^(?:fixed_asset|fixed_asset_disposal|depreciation_run|depreciation_run_line)$/, FIXED_ASSETS],
];
const BASICS = topic('02-basics.md');

const RECORD_PATH =
  /^\/e\/([a-z][a-z0-9_]*)(?:\/(?:new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/i;
const ACTION_PATH = /^\/(r|a)\/([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)$/;

/** The manual chapter for a pathname, or undefined when the screen has no chapter (then no link is shown). */
export function helpTopicFor(pathname: string): HelpTopic | undefined {
  const screen = Object.hasOwn(SCREENS, pathname) ? SCREENS[pathname] : undefined;
  if (screen) return screen;
  if (/^\/workspaces\/[a-z]+$/.test(pathname)) return NAVIGATION;
  const entity = RECORD_PATH.exec(pathname)?.[1];
  if (entity) return ENTITIES.find(([pattern]) => pattern.test(entity))?.[1] ?? BASICS;
  const action = ACTION_PATH.exec(pathname);
  const name = action?.[2];
  if (!name) return undefined;
  if (action[1] === 'r') return (Object.hasOwn(REPORTS, name) ? REPORTS[name] : undefined) ?? ANALYTICS;
  if (Object.hasOwn(ACTIONS, name)) return ACTIONS[name];
  return /^(?:retail|real_estate)\./.test(name) ? topic('07-templates.md') : undefined;
}

/**
 * The manual base from VITE_MANUAL_URL: an absolute http(s) URL without query or fragment, ending in `/`.
 * Anything else (unset, relative, javascript:, with a query) falls back to the public repository.
 */
export function manualBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_MANUAL_URL;
  try {
    const url = new URL(raw.trim());
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return DEFAULT_MANUAL_URL;
    return url.href.endsWith('/') ? url.href : `${url.href}/`;
  } catch {
    return DEFAULT_MANUAL_URL;
  }
}

export function helpUrl(help: HelpTopic, base: string = DEFAULT_MANUAL_URL): string {
  return `${base}${help.chapter}${help.section ? `#${encodeURIComponent(help.section)}` : ''}`;
}
