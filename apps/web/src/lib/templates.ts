import type { Label } from '../api/types.ts';
import type { IconName } from '../components/icon.tsx';

interface TemplateStory {
  icon: IconName;
  tone: string;
  headline: Label;
  description: Label;
  steps: Label[];
  boundary?: Label;
}
const text = (ja: string, en: string): Label => ({ ja, en });
const STORIES: Record<string, TemplateStory> = {
  wholesale: {
    icon: 'box',
    tone: 'cyan',
    headline: text('注文と納品の証跡から、請求へ。', 'Invoice confirmed wholesale deliveries.'),
    description: text(
      '注文番号・納品先・ロット参照を記録し、納品個数で請求します。会社の設定に応じて請求確定時に在庫を出庫します。',
      'Record purchase orders, destination, lot references and delivered units. Invoice posting can issue inventory.',
    ),
    steps: [
      text('受注・入庫', 'Order & receipt'),
      text('納品確認', 'Delivery proof'),
      text('請求・出庫', 'Invoice & issue'),
    ],
    boundary: text(
      '一案件一品目・一回納品の初版。分納・ロット在庫追跡・返品管理は対象外です。',
      'One item and one delivery per job; no split deliveries, lot-stock tracking or returns workflow.',
    ),
  },
  manufacturing: {
    icon: 'settings',
    tone: 'violet',
    headline: text('加工ロットと検査結果を、検収請求へ。', 'Bill accepted contract processing.'),
    description: text(
      '図面の版と加工ロットを管理。合格数と不合格数を受注数に照合し、合格した加工数量で料金を請求します。',
      'Track drawing revision, lot, accepted units and rejected units before billing processing fees.',
    ),
    steps: [
      text('加工受付', 'Accept batch'),
      text('数量・検査', 'Inspect units'),
      text('加工料請求', 'Bill processing'),
    ],
    boundary: text(
      '受託加工料の管理です。BOM・工程計画・製造原価・製品入庫は含みません。',
      'Processing fees only; no BOM, production planning, manufacturing costing or output stock receipt.',
    ),
  },
  construction: {
    icon: 'building',
    tone: 'coral',
    headline: text('現場の一工区を、検収まで確実に。', 'Accept completed construction work packages.'),
    description: text(
      '現場・工区・契約参照を記録。完了率100%と検収記録を確認し、合意した一式料金を請求します。',
      'Confirm the site, work package, contract, full completion and acceptance before billing.',
    ),
    steps: [
      text('工区・契約', 'Work package'),
      text('完了・検収', 'Completion'),
      text('完成分請求', 'Bill accepted work'),
    ],
    boundary: text(
      '独立工区の完成後請求です。出来高会計・工事原価・安全書類の管理は対象外です。',
      'Completed work only; no percentage-completion accounting, project costing or safety filings.',
    ),
  },
  logistics: {
    icon: 'box',
    tone: 'green',
    headline: text('引き受けた荷物を、受領確認まで。', 'Connect accepted cargo to delivery confirmation.'),
    description: text(
      '発着地・申告重量・引受個口を記録し、全個口の配達と受領証跡を確認して運賃を請求します。',
      'Record origin, destination, declared weight and package counts, then bill confirmed delivery.',
    ),
    steps: [
      text('配送受付', 'Accept cargo'),
      text('個口照合', 'Confirm packages'),
      text('運賃請求', 'Invoice freight'),
    ],
    boundary: text(
      '一般貨物の一配送単位です。配車最適化・運行法定帳票・運賃自動見積は対象外です。',
      'One general-cargo shipment; no route optimization, statutory transport records or automated tariffs.',
    ),
  },
  hospitality: {
    icon: 'home',
    tone: 'violet',
    headline: text('滞在した泊数を確認し、宿泊精算へ。', 'Settle a completed stay by verified nights.'),
    description: text(
      '到着日・出発日・客室参照を記録し、日差と泊数を照合。退館確認後に宿泊料金を請求します。',
      'Reconcile arrival and departure dates with nights, then invoice after checkout confirmation.',
    ),
    steps: [text('滞在受付', 'Stay details'), text('退館確認', 'Checkout'), text('泊数精算', 'Settle nights')],
    boundary: text(
      '滞在実績の初版です。空室・重複予約・旅館業の法定宿泊者名簿は管理しません。',
      'Stay fulfillment only; no availability, double-booking control or statutory guest register.',
    ),
  },
  clinic: {
    icon: 'people',
    tone: 'cyan',
    headline: text('法人健診の事務を、契約と人数で整理。', 'Manage corporate checkup administration.'),
    description: text(
      '法人契約・実施会場・事務確認を記録し、実施を確認した人数に応じて契約料金を請求します。税区分は取引ごとに確認します。',
      'Track the corporate agreement, venue and confirmed participant count for contract billing.',
    ),
    steps: [
      text('法人契約', 'Corporate agreement'),
      text('人数確認', 'Confirm participants'),
      text('事務請求', 'Contract billing'),
    ],
    boundary: text(
      '診断・検査結果・患者記録・レセプト・保険診療請求は扱いません。',
      'No diagnosis, test results, patient records, medical claims or insurance billing.',
    ),
  },
  care_service: {
    icon: 'people',
    tone: 'green',
    headline: text('保険外の支援を、同意と提供実績で確認。', 'Record private-pay support with consent.'),
    description: text(
      '家事・買物・付き添いの契約参照と提供確認を記録。15分単位の実績時間で請求します。',
      'Record private-pay housework, shopping or companionship and bill confirmed quarter-hour units.',
    ),
    steps: [text('契約・同意', 'Consent'), text('支援・確認', 'Support delivery'), text('時間請求', 'Bill hours')],
    boundary: text(
      '保険外生活支援の一般運営です。介護保険請求・ケアプラン・医療記録は対象外です。',
      'Private-pay administration only; no care insurance claims, care plans or medical records.',
    ),
  },
  education: {
    icon: 'document',
    tone: 'coral',
    headline: text('講座の受付人数を、出席と請求につなぐ。', 'Connect course bookings, attendance and billing.'),
    description: text(
      '講座・会場・定員を登録。定員内の受講受付と出席記録を照合し、実参加人数で請求します。',
      'Validate course capacity and attendance before billing confirmed participants.',
    ),
    steps: [text('講座・定員', 'Course capacity'), text('出席確認', 'Attendance'), text('受講料請求', 'Bill tuition')],
    boundary: text(
      '団体向け講座の実施単位です。成績・学籍・月謝の継続請求は対象外です。',
      'A delivered group course; no grading, student registration or recurring tuition billing.',
    ),
  },
  professional_service: {
    icon: 'document',
    tone: 'violet',
    headline: text('成果物と受入工数を、検収の根拠に。', 'Invoice accepted deliverables and hours.'),
    description: text(
      'プロジェクト・成果物・受入基準を記録。顧客の検収参照と15分単位の受入工数を確認して請求します。',
      'Record deliverables and customer acceptance, then bill accepted hours in quarter-hour units.',
    ),
    steps: [
      text('案件・成果物', 'Deliverable'),
      text('工数・検収', 'Accepted hours'),
      text('受託料請求', 'Bill services'),
    ],
    boundary: text(
      '検収した受託作業の請求です。工数原価・プロジェクト損益・給与計算とは連動しません。',
      'Accepted services only; no time costing, project profitability or payroll integration.',
    ),
  },
  beauty_salon: {
    icon: 'spark',
    tone: 'coral',
    headline: text('施術メニューと担当を、完了の記録に。', 'Connect treatments, stylists and completion.'),
    description: text(
      'メニュー・担当参照・施術確認を記録し、一式の完了後にサービス料金を請求・消込します。',
      'Record the treatment, stylist and service confirmation before billing and collecting.',
    ),
    steps: [
      text('メニュー受付', 'Accept treatment'),
      text('施術確認', 'Confirm completion'),
      text('請求・会計', 'Bill & collect'),
    ],
    boundary: text(
      '一回の施術単位です。予約枠競合・顧客カルテ・回数券残高は管理しません。',
      'One treatment; no booking conflicts, client care records or prepaid session balances.',
    ),
  },

  appliance_store: {
    icon: 'appliance',
    tone: 'violet',
    headline: text('街のでんき屋さんを、もっと頼れる存在に。', 'Support every appliance, from sale to service.'),
    description: text(
      '家電の販売から設置・修理まで。顧客の機器と受付記録をつなぎ、作業と請求を管理します。',
      'Connect customer equipment, installation, repairs and billing.',
    ),
    steps: [
      text('顧客・機器', 'Customers & devices'),
      text('設置・修理', 'Install & repair'),
      text('請求・入金', 'Bill & collect'),
    ],
  },
  farm: {
    icon: 'leaf',
    tone: 'green',
    headline: text('畑の一日を、収穫と売上につなぐ。', 'Connect field work to harvest and sales.'),
    description: text(
      '圃場・作期ごとの作業と資材投入を記録。収穫を在庫へつなぎ、生産の歩みを見渡せます。',
      'Track fields, growing seasons, materials and harvests in inventory.',
    ),
    steps: [
      text('圃場・作期', 'Fields & seasons'),
      text('作業・収穫', 'Work & harvest'),
      text('在庫・販売', 'Stock & sales'),
    ],
  },
  restaurant_chain: {
    icon: 'dining',
    tone: 'coral',
    headline: text('どの店舗も、おいしい経営へ。', 'Bring every location to the same table.'),
    description: text(
      '複数店舗の売上と厨房在庫をひとつに。日次締めからレシピに応じた材料消費・廃棄を記録します。',
      'Connect location sales, recipes, ingredient consumption and waste.',
    ),
    steps: [
      text('店舗・レシピ', 'Stores & recipes'),
      text('日次締め', 'Daily closing'),
      text('店舗別集計', 'Store reports'),
    ],
  },
  retail: {
    icon: 'wallet',
    tone: 'cyan',
    headline: text('毎日のレジ締めを、確かな記録に。', 'Turn daily register totals into reliable records.'),
    description: text(
      '店頭売上・入金・在庫を連動させ、日次売上と月次締めを管理します。',
      'Connect register sales, collections, inventory and month closes.',
    ),
    steps: [
      text('品目・仕入', 'Products & purchasing'),
      text('レジ締め', 'Register closing'),
      text('月次締め', 'Month close'),
    ],
  },
  real_estate: {
    icon: 'building',
    tone: 'violet',
    headline: text('物件と暮らしを、ひとつの台帳に。', 'Keep properties and tenancies connected.'),
    description: text(
      '物件・部屋・賃貸借契約と敷金を管理し、家賃請求や滞納状況を確認します。',
      'Manage properties, leases, deposits, rent invoices and arrears.',
    ),
    steps: [
      text('物件・入居', 'Property & tenancy'),
      text('家賃・敷金', 'Rent & deposits'),
      text('レントロール', 'Rent roll'),
    ],
  },
};
export function templateStory(name: string): TemplateStory {
  return (
    STORIES[name] ?? {
      icon: 'spark',
      tone: 'cyan',
      headline: text('自分の業務に合わせて、育てる。', 'Make the workspace your own.'),
      description: text(
        '追加項目や専用メニューを使う拡張テンプレートです。',
        'An extension template with additional fields and menus.',
      ),
      steps: [],
    }
  );
}
export const templateOrder = [
  'appliance_store',
  'farm',
  'restaurant_chain',
  'retail',
  'real_estate',
  'wholesale',
  'manufacturing',
  'construction',
  'logistics',
  'hospitality',
  'clinic',
  'care_service',
  'education',
  'professional_service',
  'beauty_salon',
  'example',
];
