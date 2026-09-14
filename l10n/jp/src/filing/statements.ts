import { Decimal } from '@daifuku/kernel';
import type { FilingStatement, AccountingProfile, FilingSource } from '@daifuku/mod-tax-filing';
import { HOT010_CATEGORIES } from './data.ts';
const D = Decimal.from;
type Row = FilingStatement['rows'][number];
const title = (label: string, code: string, level: number): Row => ({ label, code, level, amount: null, rowType: 'T' });
const amount = (label: string, code: string, level: number, value: Decimal): Row => ({
  label,
  code,
  level,
  amount: value.toString(),
  rowType: '1',
});
export function statements(source: FilingSource, profile: AccountingProfile) {
  const totals = new Map<string, Decimal>();
  const members = new Map<string, { label: string; amount: Decimal }[]>();
  for (const category of HOT010_CATEGORIES) {
    totals.set(category.key, D(0));
    members.set(category.key, []);
  }
  for (const balance of source.balances) {
    const mapping = profile.mappings.find((m) => m.accountId === balance.accountId);
    if (!mapping) continue;
    const value = D(balance.closing).times(['liability', 'equity', 'revenue'].includes(balance.type) ? -1 : 1);
    totals.set(mapping.category, (totals.get(mapping.category) ?? D(0)).plus(value));
    members.get(mapping.category)?.push({ label: mapping.displayName, amount: value });
  }
  const sum = (...keys: string[]) => keys.reduce((v, k) => v.plus(totals.get(k) ?? D(0)), D(0));
  const gross = sum('sales').minus(sum('cost_of_sales'));
  const operating = gross.minus(sum('operating_expenses'));
  const ordinary = operating.plus(sum('other_income')).minus(sum('other_expenses'));
  const preTax = ordinary.plus(sum('extraordinary_income')).minus(sum('extraordinary_expenses'));
  const profit = preTax.minus(sum('income_taxes'));
  members.get('retained_earnings')?.push({ label: '当期純損益（損益計算書より）', amount: profit });
  totals.set('retained_earnings', sum('retained_earnings').plus(profit));
  function group(key: string): Row[] {
    const cat = HOT010_CATEGORIES.find((c) => c.key === key);
    if (!cat) throw new Error('Unknown category');
    const total = amount(cat.label, cat.total, cat.title ? cat.level + 1 : cat.level, sum(key));
    const rows = (members.get(key) ?? []).map((m, index) =>
      amount(m.label, (cat.title ?? cat.total) + '-' + (index + 1), cat.level + 1, m.amount),
    );
    return cat.title ? [title(cat.label, cat.title, cat.level), ...rows, total] : [total, ...rows];
  }
  const assets = sum('current_assets', 'tangible_assets', 'intangible_assets', 'investments', 'deferred_assets');
  const fixed = sum('tangible_assets', 'intangible_assets', 'investments');
  const liabilities = sum('current_liabilities', 'fixed_liabilities');
  const stock = sum('capital', 'capital_surplus', 'retained_earnings', 'treasury_shares');
  const equity = stock.plus(sum('valuation', 'share_options'));
  const bs: Row[] = [
    title('資産の部', '10A000010', 2),
    ...group('current_assets'),
    title('固定資産', '10A200010', 3),
    ...group('tangible_assets'),
    ...group('intangible_assets'),
    ...group('investments'),
    amount('固定資産', '10A200020', 4, fixed),
    ...group('deferred_assets'),
    amount('資産', '10A000020', 3, assets),
    title('負債の部', '10B000010', 2),
    ...group('current_liabilities'),
    ...group('fixed_liabilities'),
    amount('負債', '10B000020', 3, liabilities),
    title('純資産の部', '10C000010', 2),
    title('株主資本', '10C100010', 3),
    ...group('capital'),
    ...group('capital_surplus'),
    ...group('retained_earnings'),
    ...group('treasury_shares'),
    amount('株主資本', '10C100040', 4, stock),
    ...group('valuation'),
    ...group('share_options'),
    amount('純資産', '10C000030', 3, equity),
    amount('負債純資産', '10C000040', 2, liabilities.plus(equity)),
  ];
  const pl: Row[] = [
    title('営業活動による収益', '10D100010', 2),
    ...group('sales'),
    title('営業活動による費用・売上原価', '10E100010', 2),
    ...group('cost_of_sales'),
    amount('売上総利益又は売上総損失（△）', '10F000010', 2, gross),
    ...group('operating_expenses'),
    amount('営業利益又は営業損失（△）', '10F000110', 2, operating),
    ...group('other_income'),
    ...group('other_expenses'),
    amount('経常利益又は経常損失（△）', '10F000130', 2, ordinary),
    ...group('extraordinary_income'),
    ...group('extraordinary_expenses'),
    amount('税引前当期純利益又は税引前当期純損失（△）', '10F000150', 2, preTax),
    ...group('income_taxes'),
    amount('当期純利益又は当期純損失（△）', '10F000160', 2, profit),
  ];
  return {
    statements: [
      { kind: 'BS' as const, rows: bs },
      { kind: 'PL' as const, rows: pl },
    ],
    totals: {
      assets: assets.toString(),
      liabilities: liabilities.toString(),
      equity: equity.toString(),
      netProfit: profit.toString(),
      balanceDifference: assets.minus(liabilities).minus(equity).toString(),
      preTaxProfit: preTax.toString(),
    },
  };
}
