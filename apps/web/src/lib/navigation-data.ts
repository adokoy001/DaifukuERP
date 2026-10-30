import type { Label } from '../api/types.ts';
import type { NavigationKind, WorkspaceDefinition, WorkspaceId } from './navigation-types.ts';

export const WORKSPACES: readonly WorkspaceDefinition[] = [
  {
    id: 'sales',
    label: { ja: '販売・仕入', en: 'Sales and purchasing' },
    description: {
      ja: '取引先、見積、受発注、請求と契約を管理します。',
      en: 'Manage customers, suppliers, quotations, orders, invoices and contracts.',
    },
  },
  {
    id: 'inventory',
    label: { ja: '在庫・商品', en: 'Inventory and products' },
    description: {
      ja: '商品、倉庫、入出庫と棚卸を確認します。',
      en: 'Find products, warehouses, stock movements and stock counts.',
    },
  },
  {
    id: 'workforce',
    label: { ja: '人事・労務', en: 'People and work' },
    description: {
      ja: '従業員、勤怠、シフト、給与と勤務制度を扱います。',
      en: 'Work with employees, attendance, shifts, payroll and working-time systems.',
    },
  },
  {
    id: 'finance',
    label: { ja: '会計・資金', en: 'Accounting and finance' },
    description: {
      ja: '会計、資金、銀行、連結、FC精算と申告準備を進めます。',
      en: 'Handle accounting, cash, banking, consolidation, franchise settlement and filing preparation.',
    },
  },
  {
    id: 'operations',
    label: { ja: '店舗・連携', en: 'Operations and integrations' },
    description: {
      ja: '店舗・現場の業務、業界別の記録と外部連携を管理します。',
      en: 'Manage store and field operations, industry records and external integrations.',
    },
  },
  {
    id: 'reports',
    label: { ja: '分析・レポート', en: 'Analytics and reports' },
    description: {
      ja: '帳票とピボット分析で実績を確認します。',
      en: 'Explore business results through reports and pivot analysis.',
    },
  },
  {
    id: 'admin',
    label: { ja: '設定・管理', en: 'Settings and administration' },
    description: {
      ja: '業界テンプレート、会社設定と利用者の管理を行います。',
      en: 'Find industry templates, company settings and user administration.',
    },
  },
  {
    id: 'other',
    label: { ja: 'その他', en: 'Other workspaces' },
    description: {
      ja: 'やること（受信箱）と、追加された業務・まだ分類していない画面を探します。',
      en: 'Find the to-do inbox, additional modules and screens awaiting classification.',
    },
  },
];

/** Module ownership stays unchanged. Unknown future modules retain a visible fallback. */
const MODULE_WORKSPACES: Readonly<Record<string, WorkspaceId>> = {
  partner: 'sales',
  sales: 'sales',
  purchase: 'sales',
  contract: 'sales',
  trade: 'sales',
  wholesale: 'sales',
  real_estate: 'sales',
  professional_service: 'sales',
  product: 'inventory',
  inventory: 'inventory',
  workforce: 'workforce',
  workforce_evidence: 'workforce',
  expense: 'finance',
  accounting: 'finance',
  payment: 'finance',
  banking: 'finance',
  tax: 'finance',
  tax_filing: 'finance',
  group_accounting: 'finance',
  franchise: 'finance',
  attachment: 'finance',
  l10n_jp: 'finance',
  edge: 'operations',
  pos_integration: 'operations',
  industry_operations: 'operations',
  retail: 'operations',
  appliance_store: 'operations',
  farm: 'operations',
  restaurant_chain: 'operations',
  manufacturing: 'operations',
  construction: 'operations',
  logistics: 'operations',
  hospitality: 'operations',
  clinic: 'operations',
  care_service: 'operations',
  education: 'operations',
  beauty_salon: 'operations',
  example: 'admin',
};
export function workspaceForModule(module: string | undefined): WorkspaceId {
  return module && Object.hasOwn(MODULE_WORKSPACES, module) ? (MODULE_WORKSPACES[module] ?? 'other') : 'other';
}

export interface DedicatedNavigation {
  href: string;
  label: Label;
  description: Label;
  workspace: WorkspaceId;
  module?: string;
  kind?: NavigationKind;
  /** The same entry action used by the existing sidebar, not a substitute for server authorization. */
  action?: string;
  /** `admin`: the /meta roles include admin (setup-wizard AC-28, access-insight AC-21, event-delivery AC-25); the API
   * still decides (company-wide access). */
  condition?: 'reports' | 'settings' | 'tenant-admin' | 'inbox' | 'admin';
}
export const DEDICATED_NAVIGATION: readonly DedicatedNavigation[] = [
  {
    href: '/inbox',
    workspace: 'other',
    condition: 'inbox',
    label: { ja: 'やること（受信箱）', en: 'To-do inbox' },
    description: {
      ja: '承認・確認・照合を待つ仕事を業務ごとに集め、担当画面へ移動します。',
      en: 'Collect work awaiting your approval, review or matching, and open the screen for each item.',
    },
  },
  {
    href: '/me',
    workspace: 'workforce',
    module: 'workforce',
    action: 'workforce.my_portal',
    label: { ja: '自分の勤怠・申請', en: 'My workday' },
    description: {
      ja: '打刻、休暇・経費申請と自分の勤務を確認します。',
      en: 'Clock in, submit leave and expenses, and review your own work.',
    },
  },
  {
    href: '/workforce',
    workspace: 'workforce',
    module: 'workforce',
    action: 'workforce.management_portal',
    label: { ja: '従業員・勤怠管理', en: 'Workforce management' },
    description: { ja: '従業員と勤怠・申請を管理します。', en: 'Manage employees, attendance and requests.' },
  },
  {
    href: '/workforce/shifts',
    workspace: 'workforce',
    module: 'workforce',
    action: 'workforce.shift_board',
    label: { ja: 'シフト計画・推薦', en: 'Shift planning' },
    description: {
      ja: '勤務希望からシフトを計画・調整します。',
      en: 'Plan and adjust shifts using staff availability.',
    },
  },
  {
    href: '/workforce/payroll',
    workspace: 'workforce',
    module: 'workforce',
    action: 'workforce.fiscal_board',
    label: { ja: '給与・税保険・年末調整', en: 'Payroll, tax and year-end' },
    description: {
      ja: '給与計算と税・保険・年末調整の準備を進めます。',
      en: 'Prepare payroll, tax, insurance and year-end adjustments.',
    },
  },
  {
    href: '/workforce/systems',
    workspace: 'workforce',
    module: 'workforce',
    action: 'workforce.work_system_board',
    label: { ja: '変形・フレックス勤務制度', en: 'Working-time systems' },
    description: {
      ja: '勤務制度と適用期間を管理します。',
      en: 'Manage working-time systems and their effective periods.',
    },
  },
  {
    href: '/commerce/trade',
    workspace: 'sales',
    module: 'trade',
    action: 'trade.board',
    label: { ja: '商流・受発注', en: 'Trade and orders' },
    description: {
      ja: '見積から受発注、出荷・入荷、請求までを確認します。',
      en: 'Follow quotations, orders, fulfillment and invoicing.',
    },
  },
  {
    href: '/finance/banking',
    workspace: 'finance',
    module: 'banking',
    action: 'banking.board',
    label: { ja: '銀行連携・消込', en: 'Banking and matching' },
    description: {
      ja: '銀行明細の取込、照合と支払資料を扱います。',
      en: 'Import and match bank statements and prepare payment files.',
    },
  },
  {
    href: '/finance/cash-forecast',
    workspace: 'finance',
    module: 'banking',
    action: 'banking.cash_forecast',
    label: { ja: '資金繰り表', en: 'Cash forecast' },
    description: {
      ja: '記帳済みの入出金と請求・支払ファイル・契約・給与の予定から、日別の残高の推移と入出金予定を確かめます。',
      en: 'See the daily balance and the expected receipts and payments from invoices, transfer files, contracts and payroll.',
    },
  },
  {
    href: '/finance/close',
    workspace: 'finance',
    module: 'accounting',
    action: 'accounting.close_readiness',
    label: { ja: '月次締め', en: 'Month-end close' },
    description: {
      ja: '期間内の下書き・未照合を件数で確かめ、関連レポートを見てから会計期間を締めます。',
      en: 'Check drafts and unmatched items in a period, review the reports, then close it.',
    },
  },
  {
    href: '/finance/opening',
    workspace: 'finance',
    module: 'accounting',
    action: 'accounting.import_opening_balances',
    label: { ja: '期首残高の取込', en: 'Opening balances' },
    description: {
      ja: '利用開始時の開始仕訳・売掛金と買掛金・在庫の期首残高を CSV で事前確認して取り込みます。',
      en: 'Preview and import the opening journal, receivables and payables, and stock from CSV when you start.',
    },
  },
  {
    href: '/finance/recurring',
    workspace: 'finance',
    module: 'accounting',
    action: 'accounting.generate_recurring',
    label: { ja: '定期仕訳の生成', en: 'Generate recurring journals' },
    description: {
      ja: '家賃の未払計上や前払費用の振替など、定期仕訳の期日が来た回の仕訳を作ります（既定は下書き）。',
      en: 'Create the due entries of recurring journals (accrued rent, prepaid expense transfers), as drafts by default.',
    },
  },
  {
    href: '/finance/evidence',
    workspace: 'finance',
    module: 'attachment',
    action: 'attachment.evidence_search',
    label: { ja: '証憑の検索', en: 'Evidence search' },
    description: {
      ja: '取引年月日・取引金額・取引先で証憑を探し、リンク先の伝票と差替の履歴を確かめ、選んだ証憑をまとめてダウンロードします（電子帳簿保存法の検索要件）。',
      en: 'Find evidence by transaction date, amount and partner, check the linked document and the supersede history, and download selected evidence together.',
    },
  },
  {
    href: '/finance/expenses',
    workspace: 'finance',
    module: 'expense',
    action: 'expense.settlement_candidates',
    label: { ja: '経費精算', en: 'Expense settlement' },
    description: {
      ja: '承認済みの従業員経費から精算書を作り、仕訳と支払をまとめて記録します。',
      en: 'Create expense settlements from approved employee expenses; the entry and the payment are recorded together.',
    },
  },
  {
    href: '/finance/filing',
    workspace: 'finance',
    module: 'tax_filing',
    action: 'tax_filing.board',
    label: { ja: '申告準備', en: 'Filing preparation' },
    description: {
      ja: '申告に使う会計・給与資料をまとめます。',
      en: 'Prepare accounting and payroll evidence for filing.',
    },
  },
  {
    href: '/commerce/pos',
    workspace: 'operations',
    module: 'pos_integration',
    action: 'pos_integration.inbox',
    label: { ja: 'POS自動連携', en: 'POS integration' },
    description: {
      ja: 'POSからの受信データと連携状態を確認します。',
      en: 'Review POS source data and integration status.',
    },
  },
  {
    href: '/commerce/group',
    workspace: 'finance',
    module: 'group_accounting',
    action: 'group_accounting.companies',
    label: { ja: '連結会計', en: 'Consolidation' },
    description: {
      ja: '会社別の実績から連結精算表を作成します。',
      en: 'Prepare consolidation worksheets from company results.',
    },
  },
  {
    href: '/commerce/franchise',
    workspace: 'finance',
    module: 'franchise',
    action: 'franchise.board',
    label: { ja: 'FC精算', en: 'Franchise settlement' },
    description: {
      ja: '加盟店契約と月次精算を確認します。',
      en: 'Review franchise agreements and monthly settlements.',
    },
  },
  {
    href: '/operations/devices',
    workspace: 'operations',
    module: 'edge',
    action: 'edge.board',
    label: { ja: '店舗・機器連携', en: 'Store and device links' },
    description: {
      ja: '拠点のゲートウェイ、機器と処理履歴を確認します。',
      en: 'Review site gateways, devices and processing history.',
    },
  },
  {
    href: '/operations',
    workspace: 'operations',
    module: 'restaurant_chain',
    action: 'restaurant_chain.operations_snapshot',
    label: { ja: 'チェーン運営', en: 'Chain operations' },
    description: {
      ja: '店舗の営業予定、締めと入金状況を確認します。',
      en: 'Review store plans, daily closings and settlement progress.',
    },
  },
  {
    href: '/analytics',
    workspace: 'reports',
    label: { ja: 'ピボット分析', en: 'Pivot analytics' },
    description: {
      ja: '対象・階層・指標を切り替えて表とグラフを作ります。',
      en: 'Explore dimensions and measures in tables and charts.',
    },
  },
  {
    href: '/reports',
    workspace: 'reports',
    condition: 'reports',
    label: { ja: 'BI・レポート', en: 'BI and reports' },
    description: { ja: '帳票を探し、条件を指定して集計・出力します。', en: 'Find, run and export business reports.' },
  },
  {
    href: '/templates',
    workspace: 'admin',
    kind: 'setting',
    label: { ja: '業界テンプレート', en: 'Industry templates' },
    description: {
      ja: '利用中の業界別機能と導入できるテンプレートを確認します。',
      en: 'Explore active industry features and available templates.',
    },
  },
  {
    href: '/settings',
    workspace: 'admin',
    kind: 'setting',
    condition: 'settings',
    label: { ja: '会社設定', en: 'Company settings' },
    description: {
      ja: '現在の会社に適用する業務設定を変更します。',
      en: 'Edit business settings for the current company.',
    },
  },
  {
    href: '/setup',
    workspace: 'admin',
    kind: 'setting',
    condition: 'admin',
    label: { ja: 'セットアップ', en: 'Setup' },
    description: {
      ja: '会社情報・会計年度・勘定科目・税・発行者・在庫・テンプレート・利用者・勤怠給与を順に整え、完了を実データで確かめます。',
      en: 'Set up the company profile, fiscal year, chart of accounts, tax, invoice issuer, inventory, templates, users and work and pay step by step, checked against real data.',
    },
  },
  {
    href: '/admin/health',
    workspace: 'admin',
    kind: 'setting',
    condition: 'settings',
    label: { ja: '導入チェック', en: 'Setup check' },
    description: {
      ja: '会計期間・税率・発行者・在庫・運用の設定漏れを点検し、直す画面へ移動します。',
      en: 'Check fiscal periods, tax rates, invoice issuer, inventory and operations, and open the screen that fixes each.',
    },
  },
  {
    href: '/admin/event-deliveries',
    workspace: 'admin',
    kind: 'setting',
    condition: 'admin',
    label: { ja: 'イベント配送', en: 'Event deliveries' },
    description: {
      ja: 'Webhook の署名鍵を発行し、配送に失敗したイベントを確認して再送します。',
      en: 'Issue webhook signing secrets, review failed event deliveries and resend them.',
    },
  },
  {
    href: '/admin/users',
    workspace: 'admin',
    kind: 'setting',
    condition: 'tenant-admin',
    label: { ja: '利用者と権限', en: 'Users and access' },
    description: {
      ja: '利用者と会社・拠点への所属、権限を管理します。',
      en: 'Manage users, company and site memberships, and access.',
    },
  },
  {
    href: '/admin/permissions',
    workspace: 'admin',
    kind: 'setting',
    condition: 'admin',
    label: { ja: '権限マトリクス', en: 'Permission matrix' },
    description: {
      ja: 'ロールごとに、どのデータで何ができるかを一覧します。',
      en: 'See what each role may do with each kind of data.',
    },
  },
  {
    href: '/admin/audit',
    workspace: 'admin',
    kind: 'setting',
    condition: 'admin',
    label: { ja: '監査ログの検索', en: 'Audit search' },
    description: {
      ja: 'だれが・いつ・何を変更・CSV 出力したかを期間・利用者・対象・操作で探します。',
      en: 'Find who changed or exported what, and when, by period, user, subject and operation.',
    },
  },
  {
    href: '/admin/companies',
    workspace: 'admin',
    kind: 'setting',
    condition: 'tenant-admin',
    label: { ja: '会社の管理', en: 'Companies' },
    description: {
      ja: 'テナントに会社を追加し、会社名と国を変更します。',
      en: 'Add companies to the tenant and change their name and country.',
    },
  },
  {
    href: '/admin/tokens',
    workspace: 'admin',
    kind: 'setting',
    condition: 'tenant-admin',
    label: { ja: 'API キー', en: 'API keys' },
    description: {
      ja: '外部連携や AI エージェント用の鍵を、期限・会社・ロールを決めて発行・失効します。',
      en: 'Issue and revoke keys for integrations and AI agents with an expiry, a company and roles.',
    },
  },
  {
    href: '/account',
    workspace: 'admin',
    kind: 'setting',
    label: { ja: '自分のアカウント', en: 'My account' },
    description: {
      ja: '自分のログイン方法とアカウント情報を確認します。',
      en: 'Review your own sign-in methods and account details.',
    },
  },
];
