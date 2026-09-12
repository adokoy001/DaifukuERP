import { f, label, type PermissionConfig } from '@daifuku/kernel';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS } from '@daifuku/mod-tax';
export const directions = ['sales', 'purchase'] as const;
export const directionField = () => f.enum(directions, {
    label: label('方向', 'Direction'),
    labels: { sales: label('販売', 'Sales'), purchase: label('購買', 'Purchase') },
    required: true,
    immutable: true
});
export function permissions(lines = false): PermissionConfig {
    const ops = lines ? ['read', 'create', 'update', 'delete'] as const : ['read', 'create', 'update', 'submit', 'cancel', 'amend', 'delete'] as const;
    return { roles: {
            sales: [...ops],
            purchasing: [...ops],
            accounting: ['read'],
            viewer: ['read']
        }, rowRules: [{ roles: ['sales'], where: { direction: 'sales' } }, { roles: ['purchasing'], where: { direction: 'purchase' } }] };
}
export function headFields() {
    return {
        direction: directionField(),
        partnerId: f.ref('partner', { label: label('取引先', 'Partner'), required: true }),
        partnerName: f.text({ label: label('取引時名称', 'Partner snapshot'), serverOwned: true }),
        date: f.date({ label: label('文書日付', 'Date'), required: true, default: 'today' }),
        currency: f.enum(['JPY'], {
            label: label('通貨', 'Currency'),
            required: true,
            default: 'JPY',
            immutable: true
        }),
        note: f.text({ label: label('備考', 'Note'), maxLength: 2000, multiline: true }),
        cancelledDate: f.date({ label: label('取消有効日', 'Cancellation date'), serverOwned: true }),
    };
}
export function estimateFields() {
    return {
        subtotal: f.money({
            label: label('税抜見込額', 'Estimated subtotal'),
            required: true,
            default: '0',
            serverOwned: true
        }),
        taxTotal: f.money({
            label: label('見込税額', 'Estimated tax'),
            required: true,
            default: '0',
            serverOwned: true
        }),
        total: f.money({
            label: label('税込見込額', 'Estimated total'),
            required: true,
            default: '0',
            serverOwned: true
        }),
        taxSummary: f.json({ label: label('見込税内訳', 'Estimated tax snapshot'), serverOwned: true }),
    };
}
export function lineFields() {
    return {
        direction: f.enum(directions, { label: label('方向', 'Direction'), required: true, serverOwned: true }),
        seq: f.int({
            label: label('行番号', 'Sequence'),
            min: 1,
            required: true,
            default: 1
        }),
        productId: f.ref('product', { label: label('品目', 'Product'), required: true }),
        description: f.text({ label: label('品名', 'Description'), required: true, maxLength: 200 }),
        uomId: f.ref('uom', { label: label('単位', 'Unit'), serverOwned: true }),
        uomCode: f.text({ label: label('取引時単位', 'Unit snapshot'), serverOwned: true }),
        quantity: f.quantity({
            label: label('数量', 'Quantity'),
            required: true,
            default: '1',
            min: '0'
        }),
        unitPrice: f.money({ label: label('税抜単価', 'Net unit price'), required: true, min: '0' }),
        taxCategory: f.enum(TAX_CATEGORIES, { label: label('税区分', 'Tax category'), labels: TAX_CATEGORY_LABELS, required: true }),
        amount: f.money({
            label: label('税抜金額', 'Net amount'),
            serverOwned: true,
            required: true,
            default: '0'
        }),
    };
}
export const lineView = ['seq', 'productId', 'description', 'uomCode', 'quantity', 'unitPrice', 'taxCategory', 'amount'];
