import { assertReadableFields, can, column, label, PermissionDenied, registry, type Context, type Domain, type TableColumn } from '@daifuku/kernel';

export interface AnalyticsDataset {
  id: string;
  title: { ja: string; en: string };
  description: { ja: string; en: string };
  grain: { ja: string; en: string };
  dateField: string;
  dimensions: TableColumn[];
  measures: TableColumn[];
  defaultRows: string[];
  defaultColumns: string[];
  defaultMeasure: string;
  defaultState: string;
  states: { value: string; label: { ja: string; en: string } }[];
}

export interface SourceDefinition {
  id: string;
  title: string;
  english: string;
  description: string;
  grain: string;
  dateField: string;
  dimensions: string[];
  measures: string[];
  defaultRows: string[];
  defaultMeasure: string;
  defaultState: string;
  states: { value: string; ja: string; where?: Domain }[];
  derived?: Record<string, { source: string; ja: string; en: string; divisor?: string; signedBy?: string }>;
}

const all = { value: 'all', ja: 'すべての状態' };
const documents = [
  { value: 'submitted', ja: '確定済み', where: { docstatus: 1 } },
  { value: 'draft', ja: '下書き', where: { docstatus: 0 } },
  { value: 'cancelled', ja: '取消済み', where: { docstatus: 2 } }, all,
];
const statuses = (...values: [string, string][]) => [...values.map(([value, ja]) => ({ value, ja, where: { status: value } })), all];

/** Deliberate source/field allowlist. No arbitrary entities, SQL, joins, snapshots or free-text personnel evidence. */
export const SOURCES: readonly SourceDefinition[] = [
  { id: 'sales_invoice', title: '売上請求', english: 'Sales invoices', description: '請求日別の請求書合計。残高・入金済額は取得時点の状態で、過去時点の売掛残高ではありません。', grain: '請求書1件', dateField: 'date', dimensions: ['date', 'partnerId', 'status', 'currency'], measures: ['subtotal', 'taxTotal', 'total', 'paidAmount', 'balance'], defaultRows: ['partnerId'], defaultMeasure: 'subtotal', defaultState: 'submitted', states: documents },
  { id: 'purchase_invoice', title: '仕入請求', english: 'Purchase invoices', description: '受領請求書の日付別合計。残高・支払済額は取得時点の値です。', grain: '仕入請求書1件', dateField: 'date', dimensions: ['date', 'partnerId', 'status', 'supplierTaxStatus', 'currency'], measures: ['subtotal', 'taxTotal', 'total', 'paidAmount', 'balance'], defaultRows: ['partnerId'], defaultMeasure: 'subtotal', defaultState: 'submitted', states: documents },
  { id: 'stock_ledger', title: '在庫移動原価', english: 'Inventory movement cost', description: '期間中の原価増減を取消行も含めて集計します。期末在庫残高ではありません。異単位の数量を合算しないため数量は指標に含めません。', grain: '品目・倉庫の在庫移動1行', dateField: 'date', dimensions: ['date', 'warehouseId', 'productId', 'sourceEntity', 'reversal'], measures: ['costDelta'], defaultRows: ['warehouseId', 'productId'], defaultMeasure: 'costDelta', defaultState: 'all', states: [all] },
  { id: 'workforce_attendance', title: '日次勤怠', english: 'Daily attendance', description: '勤務日別の実働・深夜時間（分）。法定時間外の判定や給与計算とは異なります。', grain: '従業員・勤務日1件', dateField: 'workDate', dimensions: ['workDate', 'siteId', 'employeeId', 'status', 'dayKind'], measures: ['workedMinutes', 'nightMinutes'], derived: { workedMinutes: { source: 'workedMs', ja: '実働時間（分）', en: 'Worked minutes', divisor: '60000' }, nightMinutes: { source: 'nightMs', ja: '深夜時間（分）', en: 'Night minutes', divisor: '60000' } }, defaultRows: ['siteId', 'employeeId'], defaultMeasure: 'workedMinutes', defaultState: 'approved', states: statuses(['approved', '承認済み'], ['submitted', '承認待ち'], ['closed', '退勤済み'], ['working', '勤務中'], ['break', '休憩中'], ['returned', '差戻し']) },
  { id: 'workforce_leave_request', title: '有給休暇申請', english: 'Paid leave requests', description: '取得日別の申請日数。付与残高や取得率ではありません。', grain: '休暇申請1件', dateField: 'leaveDate', dimensions: ['leaveDate', 'siteId', 'employeeId', 'status', 'portion'], measures: ['days'], defaultRows: ['siteId', 'employeeId'], defaultMeasure: 'days', defaultState: 'approved', states: statuses(['approved', '承認済み'], ['pending', '承認待ち'], ['rejected', '却下'], ['cancelled', '取消済み']) },
  { id: 'workforce_expense', title: '従業員経費', english: 'Employee expenses', description: '使用日別の経費申請額。既定では承認済みと精算済みを含めます。', grain: '経費申請1件', dateField: 'expenseDate', dimensions: ['expenseDate', 'siteId', 'employeeId', 'category', 'status'], measures: ['amount'], defaultRows: ['siteId', 'category'], defaultMeasure: 'amount', defaultState: 'approved', states: [{ value: 'approved', ja: '承認済み・精算済み', where: { status: { $in: ['approved', 'settled'] } } }, ...statuses(['settled', '精算済み'], ['submitted', '承認待ち'], ['draft', '下書き'], ['returned', '差戻し'], ['cancelled', '取消済み'])] },
  { id: 'workforce_payroll', title: '給与計算', english: 'Payroll', description: '給与対象期間の終了日別に集計します。表示範囲は給与明細の閲覧権限に従います。', grain: '従業員・給与期間の明細1件', dateField: 'periodEnd', dimensions: ['periodEnd', 'siteId', 'employeeId', 'period', 'docstatus'], measures: ['basePay', 'premiumPay', 'grossPay', 'deductionTotal', 'netPay', 'paidLeaveDays'], defaultRows: ['siteId', 'employeeId'], defaultMeasure: 'grossPay', defaultState: 'submitted', states: documents },
  { id: 'restaurant_chain_closing', title: '店舗日次締め', english: 'Store daily closings', description: '営業日別の店舗実績。売上請求と重複するため別の対象として集計します。売上と材料原価は総勘定元帳の利益とは異なります。', grain: '店舗・営業日の締め1件', dateField: 'date', dimensions: ['date', 'storeId', 'dayStatus', 'reviewStatus', 'docstatus'], measures: ['subtotal', 'taxTotal', 'total', 'cashAmount', 'cardAmount', 'qrAmount', 'consumptionCost', 'wasteCost'], defaultRows: ['storeId'], defaultMeasure: 'subtotal', defaultState: 'submitted', states: documents },
  { id: 'bank_statement', title: '銀行入出金明細', english: 'Bank statement transactions', description: '銀行記帳日別の入出金。入出金差額は入金を正・出金を負とします。絶対値の合計は取引量です。口座残高や資金繰り予測ではありません。', grain: '銀行取引明細1行', dateField: 'bookedOn', dimensions: ['bookedOn', 'bankAccountId', 'direction'], measures: ['signedAmount', 'amount'], derived: { signedAmount: { source: 'amount', ja: '入出金差額（入金＋・出金−）', en: 'Net cash movement (in + / out −)', signedBy: 'direction' } }, defaultRows: ['bankAccountId', 'direction'], defaultMeasure: 'signedAmount', defaultState: 'all', states: [all] },
];

const englishDetails: Record<string, [string, string]> = {
  sales_invoice: ['Invoice totals by invoice date. Paid amounts and balances are current values, not historical receivables balances.', 'One sales invoice'],
  purchase_invoice: ['Supplier invoice totals by invoice date. Paid amounts and balances reflect the retrieval time.', 'One purchase invoice'],
  stock_ledger: ['Cost movements including reversal entries. This is not closing inventory. Quantities with different units are not added.', 'One product and warehouse movement'],
  workforce_attendance: ['Worked and night minutes by work date, converted from milliseconds and rounded half up to six decimal places. This does not classify statutory overtime or calculate wages.', 'One employee and work date'],
  workforce_leave_request: ['Requested leave days by leave date, not remaining entitlement or a leave utilization rate.', 'One leave request'],
  workforce_expense: ['Expense claims by expense date. The default includes approved and settled claims.', 'One expense claim'],
  workforce_payroll: ['Payslips by payroll period end. Existing payslip access permissions determine the visible employees.', 'One employee payroll period'],
  restaurant_chain_closing: ['Store results by business date, separate from overlapping sales invoices. Sales and ingredient costs are not general-ledger profit.', 'One store daily closing'],
  bank_statement: ['Transactions by bank booking date. Net movement signs deposits positive and withdrawals negative; absolute amounts measure transaction volume, not account balance.', 'One bank transaction'],
};

function readable(ctx: Context, source: SourceDefinition, key: string): boolean {
  try { const derived = source.derived?.[key]; assertReadableFields(ctx, registry.entity(source.id), [derived?.source ?? key, ...(derived?.signedBy ? [derived.signedBy] : [])]); return true; }
  catch (error) { if (error instanceof PermissionDenied) return false; throw error; }
}

function describeColumn(source: SourceDefinition, key: string, measure = false): TableColumn {
  const definition = registry.entity(source.id).config.fields[key];
  const derived = source.derived?.[key];
  if (derived) return column(key, label(derived.ja, derived.en), 'decimal');
  if (source.id === 'bank_statement' && key === 'amount') return column(key, label('入出金額（絶対値）', 'Transaction amount (absolute)'), 'decimal');
  const fallback: Record<string, string> = { docstatus: '文書状態', periodEnd: '対象期間終了日', leaveDate: '休暇取得日', portion: '取得区分', days: '日数', status: '状態', paidLeaveDays: '有給日数', bookedOn: '銀行記帳日', bankAccountId: '銀行口座', direction: '入出金区分', amount: '金額' };
  const title = definition?.opts.label ?? label(fallback[key] ?? key, key);
  return column(key, title, measure ? 'decimal' : definition?.kind === 'date' ? 'date' : definition?.kind === 'bool' ? 'bool' : 'text');
}

export function analyticsCatalog(ctx: Context): AnalyticsDataset[] {
  if (!ctx.companyId) return [];
  return SOURCES.flatMap((source) => {
    if (!registry.hasEntity(source.id) || !can(ctx, registry.entity(source.id), 'read') || !readable(ctx, source, source.dateField)) return [];
    if (source.dimensions.includes('currency') && !readable(ctx, source, 'currency')) return [];
    // A hidden state cannot be used as an inference channel through filters or totals.
    if (source.states.some((state) => Object.keys(state.where ?? {}).some((key) => !readable(ctx, source, key)))) return [];
    const dimensions = source.dimensions.filter((key) => readable(ctx, source, key)).map((key) => describeColumn(source, key));
    const measures = source.measures.filter((key) => readable(ctx, source, key)).map((key) => describeColumn(source, key, true));
    const firstMeasure = measures[0];
    if (!firstMeasure) return [];
    const details = englishDetails[source.id];
    const description = source.description + (source.id === 'workforce_attendance' ? ' ミリ秒から分に換算し、小数6桁で四捨五入します。' : '');
    return [{ id: source.id, title: label(source.title, source.english), description: label(description, details?.[0] ?? source.english), grain: label(source.grain, details?.[1] ?? source.english), dateField: source.dateField, dimensions, measures, defaultRows: source.defaultRows.filter((key) => dimensions.some((col) => col.key === key)), defaultColumns: [source.dateField], defaultMeasure: measures.some((col) => col.key === source.defaultMeasure) ? source.defaultMeasure : firstMeasure.key, defaultState: source.defaultState, states: source.states.map((state) => ({ value: state.value, label: label(state.ja, state.value) })) }];
  });
}
