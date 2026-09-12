// HOT010 Ver.3.0, general industry. Codes transcribed from NTA's official 2019 BS/PL forms.
// Applicable to submissions from 2020-04-01; verified 2026-09-13. These are disclosure codes, not tax rates.
export const HOT010_VERSION = '3.0';
export const HOT010_FROM = '2020-04-01';
export const HOT010_SOURCES = ['https://www.e-tax.nta.go.jp/hojin/gimuka/csv_jyoho4.htm', 'https://www.e-tax.nta.go.jp/hojin/gimuka/csv_jyoho4_5_1.pdf', 'https://www.e-tax.nta.go.jp/hojin/gimuka/csv_jyoho3/1/HOT010_3.0_BS_10.xlsx', 'https://www.e-tax.nta.go.jp/hojin/gimuka/csv_jyoho3/2/HOT010_3.0_PL_10.xlsx'];
export interface FilingCategory { key: string; label: string; accountTypes: string[]; title: string | null; total: string; level: number; statement: 'BS' | 'PL' }
const group = (key: string, label: string, type: string, title: string | null, total: string, level: number, statement: 'BS' | 'PL' = 'BS'): FilingCategory => ({ key, label, accountTypes: [type], title, total, level, statement });
export const HOT010_CATEGORIES: readonly FilingCategory[] = [
 group('current_assets', '流動資産', 'asset', '10A100010', '10A101160', 3),
 group('tangible_assets', '有形固定資産', 'asset', '10A210010', '10A210950', 4),
 group('intangible_assets', '無形固定資産', 'asset', '10A220010', '10A220330', 4),
 group('investments', '投資その他の資産', 'asset', '10A230010', '10A230880', 4),
 group('deferred_assets', '繰延資産', 'asset', '10A300010', '10A300080', 3),
 group('current_liabilities', '流動負債', 'liability', '10B100010', '10B101070', 3),
 group('fixed_liabilities', '固定負債', 'liability', '10B200010', '10B200670', 3),
 group('capital', '資本金', 'equity', null, '10C110010', 4),
 group('capital_surplus', '資本剰余金', 'equity', '10C120010', '10C120040', 4),
 group('retained_earnings', '利益剰余金', 'equity', '10C130010', '10C130390', 4),
 group('treasury_shares', '自己株式', 'equity', null, '10C100020', 4),
 group('valuation', '評価・換算差額等', 'equity', '10C200010', '10C200070', 3),
 group('share_options', '新株予約権', 'equity', null, '10C300010', 3),
 group('sales', '売上高', 'revenue', '10D100020', '10D100030', 3, 'PL'),
 group('cost_of_sales', '売上原価', 'expense', '10E100020', '10E100030', 3, 'PL'),
 group('operating_expenses', '販売費及び一般管理費', 'expense', '10E200010', '10E201330', 2, 'PL'),
 group('other_income', '営業外収益', 'revenue', '10D200010', '10D200740', 2, 'PL'),
 group('other_expenses', '営業外費用', 'expense', '10E300010', '10E300910', 2, 'PL'),
 group('extraordinary_income', '特別利益', 'revenue', '10D300010', '10D300670', 2, 'PL'),
 group('extraordinary_expenses', '特別損失', 'expense', '10E400010', '10E401090', 2, 'PL'),
 group('income_taxes', '法人税等', 'expense', null, '10F100060', 2, 'PL'),
];
export const PAYROLL_PREPARATION_SOURCES = ['https://www.nta.go.jp/publication/pamph/hotei/tebiki2026/PDF/02.pdf', 'https://www.nta.go.jp/users/gensen/hotei/index/minashi.htm'];

// Exact official artifacts fetched on this verification date. SHA-256 detects source-file changes; it is not a signature.
export const FILING_REFERENCE_ARTIFACTS = [
 { url: HOT010_SOURCES[1] as string, sha256: 'c435332bd1e52da6f424beca16a4ce1ddf5a3b3ba8c8a5d373f82c2f4d71575f', verifiedOn: '2026-09-13', version: 'HOT010-3.0-record' },
 { url: HOT010_SOURCES[2] as string, sha256: '706805b94dfe50b4ef36ec31b4087487a1460d7837df040cc2441572974a3582', verifiedOn: '2026-09-13', version: 'HOT010-3.0-BS-10' },
 { url: HOT010_SOURCES[3] as string, sha256: '1041373f8fa5fad25265a55e902ecd7cbb1604b6a8e8e12924fb771e046a2929', verifiedOn: '2026-09-13', version: 'HOT010-3.0-PL-10' },
 { url: PAYROLL_PREPARATION_SOURCES[0] as string, sha256: '1128cae9c8b171df5c2fa3d12c0acb288540e9876f2d21fb6cf528ff11d2af62', verifiedOn: '2026-09-13', version: 'NTA-2026-payroll-guide' },
];
