import { Decimal, ValidationError, registry } from '@daifuku/kernel';
import { FILING_PROFILE_OVERRIDE, accountingProfileData, payrollProfileData, type AccountingProfile, type CountryFilingProfile, type FilingIssue, type FilingPrepared, type FilingSource, type FilingStatement } from '@daifuku/mod-tax-filing';
import { FILING_REFERENCE_ARTIFACTS, HOT010_CATEGORIES, HOT010_FROM, HOT010_SOURCES, HOT010_VERSION, PAYROLL_PREPARATION_SOURCES } from './data.ts';
import { csvCell, encodeOfficial, encodePreparation, officialAmount, officialText } from './encoding.ts';
import { statements } from './statements.ts';
const issue = (code: string, message: string, reference: string | null = null): FilingIssue => ({ code, message, reference, severity: 'error' });
const ACCOUNTING_NOTICE = '一般商工業・単体法人の財務諸表取込用CSVです。法人税申告書・資本変動計算書・注記等は含まず、電子申告の送信・受付・納税は行っていません。帳簿税額差額は法定納付税額ではありません。';
const PAYROLL_NOTICE = 'Daifuku独自の給与申告準備資料です。公式375/eLTAX取込CSV・源泉徴収票の正式帳票ではありません。未確定・不足資料を確認し、公式ソフトで別途作成・提出してください。個人番号を含みません。';
function validateProfile(profile: AccountingProfile) {
 officialText(profile.legalName, 'legalName', 50);
 if (new Set(profile.mappings.map((m) => m.accountId)).size !== profile.mappings.length) throw new ValidationError('同じ科目を複数の分類へ割り当てられません', [{ path: 'mappings', message: '科目ごとに一つの分類を選択してください。' }]);
 for (const m of profile.mappings) { if (!HOT010_CATEGORIES.some((c) => c.key === m.category)) throw new ValidationError('未対応の財務諸表分類です', [{ path: 'category', message: m.category }]); officialText(m.displayName, 'displayName', 100); }
}
function validateRows(statement: FilingStatement): void {
 let level = 1; const codes = new Set<string>();
 for (const row of statement.rows) { officialText(row.label, 'label', 100); if (row.level < 2 || row.level > level + 1 || row.level > 9999 || codes.has(row.code) || !/^[0-9A-Z]{9}(?:-[1-9][0-9]*)?$/.test(row.code) || row.code.length > 20) throw new ValidationError('財務諸表の階層・科目コードが不正です', [{ path: 'statements', message: row.code }]);
  if (row.rowType === 'T' ? row.amount !== null : row.amount === null) throw new ValidationError('財務諸表の金額欄が不正です', [{ path: 'amount', message: row.code }]);
  if (row.amount !== null) officialAmount(row.amount); level = row.level; codes.add(row.code);
 }
}
function prepareAccounting(source: FilingSource): FilingPrepared {
 const profile = accountingProfileData.parse(source.profile), issues = [...source.issues]; validateProfile(profile);
 if (source.currency !== 'JPY' || source.country !== 'JP') issues.push(issue('country_currency', '日本・円建ての単体法人帳簿のみ対応します。'));
 for (const b of source.balances) { const mapping = profile.mappings.find((m) => m.accountId === b.accountId), category = HOT010_CATEGORIES.find((c) => c.key === mapping?.category);
  if (!mapping) issues.push(issue('mapping_missing', `${b.name} の財務諸表分類が未設定です。`, b.accountId));
  else if (!category?.accountTypes.includes(b.type)) issues.push(issue('mapping_type', `${b.name} の借貸区分と財務諸表分類が一致しません。`, b.accountId));
 }
 const built = statements(source, profile);
 if (!Decimal.from(built.totals.balanceDifference).eq(0)) issues.push(issue('statement_balance', '貸借対照表の資産と負債・純資産が一致しません。'));
 try { for (const statement of built.statements) validateRows(statement); } catch (e) { if (!(e instanceof ValidationError)) throw e; issues.push(issue('format_invalid', e.message)); }
 return { statements: built.statements, payrollRows: [], issues, totals: { ...source.totals, ...built.totals }, officialImport: true, notice: ACCOUNTING_NOTICE };
}
function exportAccounting(source: FilingSource, prepared: FilingPrepared) {
 const profile = accountingProfileData.parse(source.profile); validateProfile(profile);
 return prepared.statements.map((statement) => { validateRows(statement); const header = [['A', statement.kind, '', '', ''], ['B', profile.legalName, '', '', ''], ['C1', source.from, '', '', ''], ['C2', source.to, '', '', ''], [statement.kind === 'BS' ? '貸借対照表' : '損益計算書', '', '', '', '']];
  const records = [...header, ...statement.rows.map((r) => [r.label, r.amount ?? '', r.rowType, String(r.level), r.code])];
  return { filename: `HOT010_${HOT010_VERSION}_${statement.kind}_10.csv`, mediaType: 'text/csv', encoding: 'shift_jis' as const, contentBase64: encodeOfficial(records.map((r) => r.join(',')).join('\r\n') + '\r\n') };
 });
}
function exportPayroll(source: FilingSource, prepared: FilingPrepared) {
 const profile = payrollProfileData.parse(source.profile), sharedIssues = prepared.issues.filter((i) => i.reference === null);
 const header = ['資料区分', '年分', '支払者名', '支払者所在地', '支払者連絡先', '社員コード', '氏名', '氏名カナ', '住所', '生年月日', '自治体コード', '社内課税給与', '社内社会保険', '社内源泉税', '前職課税給与', '年調年税額', '給与所得控除後', '所得控除合計', '還付', '追加徴収', '未払給与確認', '未徴収税額確認', '未解決事項'];
 const records = prepared.payrollRows.map((r) => ['申告準備資料（公式取込不可）', source.from.slice(0, 4), profile.legalName, profile.payerAddress ?? '未確認', profile.payerPhone ?? '未確認', r.employeeCode, r.employeeName, r.facts?.nameKana ?? '', r.facts?.address ?? '', r.facts?.birthDate ?? '', r.facts?.municipalityCode ?? '', r.taxablePay ?? '未算定', r.socialPremium ?? '未算定', r.withheldTax ?? '未算定', r.previousEmployerPay ?? '未算定', r.annualTax ?? '未算定', r.salaryIncome ?? '未算定', r.deductionTotal ?? '未算定', r.refund ?? '未算定', r.additionalTax ?? '未算定', r.facts?.unpaidSalaryAmount ?? '未確認', r.facts?.uncollectedTaxAmount ?? '未確認', [...sharedIssues, ...r.issues].map((i) => i.message).join('／')]);
 return [{ filename: `daifuku_payroll_preparation_${source.from.slice(0, 4)}.csv`, mediaType: 'text/csv', encoding: 'utf-8' as const, contentBase64: encodePreparation([header, ...records].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n') }];
}
export const JAPAN_FILING_PROFILES: readonly CountryFilingProfile[] = [
 { kind: 'accounting', referenceArtifacts: FILING_REFERENCE_ARTIFACTS.slice(0, 3), option: { code: 'jp-hot010-general-v3', name: '日本・一般商工業の財務諸表', version: HOT010_VERSION + '/jp-2026-09-13.1', from: HOT010_FROM, to: null, taxYears: [], categories: HOT010_CATEGORIES.map(({ key, label, accountTypes }) => ({ key, label, accountTypes })), sources: HOT010_SOURCES }, validateProfile, prepare: prepareAccounting, export: exportAccounting },
 { kind: 'payroll', referenceArtifacts: FILING_REFERENCE_ARTIFACTS.slice(3), option: { code: 'jp-payroll-preparation-2026', name: '日本・2026年給与申告準備資料', version: 'daifuku-2026.1', from: '2026-01-01', to: '2026-12-31', taxYears: [2026], categories: [], sources: PAYROLL_PREPARATION_SOURCES }, prepare: (source) => ({ statements: [], payrollRows: source.payrollRows, issues: [...source.issues, ...(source.country !== 'JP' || source.currency !== 'JPY' ? [issue('country_currency', '日本・円建ての給与のみ対応します。')] : [])], totals: source.totals, officialImport: false, notice: PAYROLL_NOTICE }), export: exportPayroll },
];
export function registerJapanFilingProfiles() { registry.registerOverride(FILING_PROFILE_OVERRIDE, () => JAPAN_FILING_PROFILES); }
