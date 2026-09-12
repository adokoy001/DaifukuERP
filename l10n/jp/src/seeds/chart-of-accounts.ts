// Chart of accounts for a small business / 個人事業 (spec AC-1), modelled on 青色申告決算書（一般用）and 中小企業の会計に関する
// 基本要領 (中小会計要領). Codes are fixed by the spec; `subtype` is the Japanese group name (docs/specs/accounting.md).
// Sources (確認 2026-09-10): 国税庁 青色申告決算書 https://www.nta.go.jp/taxes/shiraberu/shinkoku/yoshiki/02/pdf/016.pdf,
// 中小会計要領 https://www.chusho.meti.go.jp/zaimu/youryou/ — the expense accounts default to the tax category of their
// typical transactions: 課税仕入 (standard) unless the spec pins another (給料/減価償却/租税公課 = 不課税, 地代家賃 = 非課税).
import { repo, type Context } from '@daifuku/kernel';
import { Account, type AccountInsert, type AccountType, type TaxCategory, type TaxRole } from '@daifuku/mod-accounting';

export interface SeedAccount {
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  taxCategoryDefault?: TaxCategory;
  partnerRequired?: boolean;
  taxRole?: TaxRole;
}

const asset = (code: string, name: string, subtype: string, extra: Partial<SeedAccount> = {}): SeedAccount => ({ code, name, type: 'asset', subtype, ...extra });
const liability = (code: string, name: string, subtype: string, extra: Partial<SeedAccount> = {}): SeedAccount => ({ code, name, type: 'liability', subtype, ...extra });
const equity = (code: string, name: string, subtype: string): SeedAccount => ({ code, name, type: 'equity', subtype });
const revenue = (code: string, name: string, subtype: string, extra: Partial<SeedAccount> = {}): SeedAccount => ({ code, name, type: 'revenue', subtype, ...extra });
const expense = (code: string, name: string, subtype: string, taxCategoryDefault: TaxCategory): SeedAccount => ({ code, name, type: 'expense', subtype, taxCategoryDefault });

const SGA = '販売費及び一般管理費';

export const JP_CHART_OF_ACCOUNTS: readonly SeedAccount[] = [
  asset('1000', '現金', '現金預金'),
  asset('1100', '普通預金', '現金預金'),
  asset('1300', '売掛金', '売掛金', { partnerRequired: true }),
  asset('1400', '商品', '棚卸資産'),
  asset('1500', '仮払消費税', '仮払消費税', { taxRole: 'input_tax' }),
  asset('1900', '前払金', 'その他流動資産'),
  liability('2100', '買掛金', '買掛金', { partnerRequired: true }),
  liability('2150', '未払金', '未払金'),
  liability('2200', '仮受消費税', '仮受消費税', { taxRole: 'output_tax' }),
  liability('2300', '未払消費税', '未払消費税'),
  liability('2400', '前受金', 'その他流動負債'),
  liability('2500', '預り金', '預り金'),
  equity('3000', '元入金', '元入金'),
  equity('3100', '事業主貸', '事業主勘定'),
  equity('3200', '事業主借', '事業主勘定'),
  revenue('4000', '売上高', '売上', { taxCategoryDefault: 'standard' }),
  revenue('4100', '雑収入', '営業外収益'),
  expense('5000', '仕入高', '仕入', 'standard'),
  expense('6100', '給料手当', SGA, 'out_of_scope'),
  expense('6200', '地代家賃', SGA, 'non_taxable'),
  expense('6300', '通信費', SGA, 'standard'),
  expense('6400', '消耗品費', SGA, 'standard'),
  expense('6500', '旅費交通費', SGA, 'standard'),
  expense('6600', '支払手数料', SGA, 'standard'),
  expense('6700', '減価償却費', SGA, 'out_of_scope'),
  expense('6800', '租税公課', SGA, 'out_of_scope'),
  expense('6900', '雑費', SGA, 'standard'),
  expense('6950', '水道光熱費', SGA, 'standard'),
  expense('6960', '広告宣伝費', SGA, 'standard'),
  expense('6970', '接待交際費', SGA, 'standard'),
  expense('6980', '外注費', SGA, 'standard'),
];

function toInsert(a: SeedAccount): AccountInsert {
  return {
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    partnerRequired: a.partnerRequired ?? false,
    ...(a.taxCategoryDefault === undefined ? {} : { taxCategoryDefault: a.taxCategoryDefault }),
    ...(a.taxRole === undefined ? {} : { taxRole: a.taxRole }),
  };
}

/** Idempotent per company: codes that already exist are left untouched (no overwrite, no audit churn). Returns the number created. */
export async function seedChartOfAccounts(ctx: Context, chart: readonly SeedAccount[] = JP_CHART_OF_ACCOUNTS): Promise<number> {
  const r = repo(ctx, Account);
  const codes = chart.map((a) => a.code);
  const existing = await r.list({ where: { code: { $in: codes } }, limit: codes.length });
  const present = new Set(existing.items.map((a) => a.code));
  let created = 0;
  for (const a of chart) {
    if (present.has(a.code)) continue;
    await r.create(toInsert(a));
    created += 1;
  }
  return created;
}
