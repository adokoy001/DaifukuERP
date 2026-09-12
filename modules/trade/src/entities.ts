import { defineDocument, defineEntity, f, label } from '@daifuku/kernel';
import { estimateFields, headFields, lineFields, lineView, permissions } from './fields.ts';
export const TradeQuotation = defineDocument({
    name: 'trade_quotation',
    label: label('見積書', 'Quotation'),
    naming: { type: 'sequence', prefix: 'QT-', period: 'year' },
    fields: { ...headFields(), ...estimateFields(), validUntil: f.date({ label: label('有効期限', 'Valid until') }) },
    lines: [{ entity: 'trade_quotation_line', parentField: 'quotationId' }],
    permissions: { roles: { sales: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'], viewer: ['read'] } },
    views: { list: ['partnerId', 'date', 'validUntil', 'total'], form: [['partnerId', 'date', 'validUntil'], ['note']] }
});
export const TradeQuotationLine = defineEntity({
    name: 'trade_quotation_line',
    label: label('見積明細', 'Quotation line'),
    fields: { ...lineFields(), quotationId: f.ref('trade_quotation', { label: label('見積', 'Quotation'), required: true, onDelete: 'cascade' }) },
    permissions: { roles: { sales: ['read', 'create', 'update', 'delete'], viewer: ['read'] } },
    views: { list: lineView }
});
export const TradeOrder = defineDocument({
    name: 'trade_order',
    label: label('受発注書', 'Trade order'),
    naming: { type: 'sequence', prefix: 'ORD-', period: 'year' },
    fields: {
        ...headFields(),
        ...estimateFields(),
        quotationId: f.ref('trade_quotation', { label: label('元見積', 'Quotation'), serverOwned: true }),
        requiredDate: f.date({ label: label('希望納期', 'Required date') }),
        closed: f.bool({
            label: label('残数打切り', 'Remainder closed'),
            required: true,
            default: false,
            serverOwned: true
        }),
        closedReason: f.text({ label: label('打切り理由', 'Close reason'), serverOwned: true, maxLength: 1000 })
    },
    allowOnSubmit: ['closed', 'closedReason'],
    lines: [{ entity: 'trade_order_line', parentField: 'orderId' }],
    permissions: permissions(),
    views: { list: ['direction', 'partnerId', 'date', 'requiredDate', 'total', 'closed'], form: [['direction', 'partnerId', 'date', 'requiredDate'], ['note']] }
});
export const TradeOrderLine = defineEntity({
    name: 'trade_order_line',
    label: label('受発注明細', 'Trade order line'),
    fields: { ...lineFields(), orderId: f.ref('trade_order', { label: label('受発注', 'Order'), required: true, onDelete: 'cascade' }) },
    permissions: permissions(true),
    views: { list: lineView }
});
export const TradeFulfillment = defineDocument({
    name: 'trade_fulfillment',
    label: label('出荷・入荷', 'Fulfillment'),
    naming: { type: 'sequence', prefix: 'FUL-', period: 'year' },
    fields: {
        ...headFields(),
        orderId: f.ref('trade_order', { label: label('受発注', 'Order'), required: true, serverOwned: true }),
        warehouseId: f.ref('warehouse', { label: label('倉庫', 'Warehouse'), required: true }),
        cancelReason: f.text({ label: label('取消理由', 'Cancellation reason'), serverOwned: true, maxLength: 1000 }),
        warehouseName: f.text({ label: label('取引時倉庫', 'Warehouse snapshot'), serverOwned: true }),
        stockEntryId: f.ref('stock_entry', { label: label('入出庫', 'Stock entry'), serverOwned: true }),
        requestId: f.uuid({
            label: label('再送識別子', 'Request ID'),
            serverOwned: true,
            required: true,
            unique: true
        }),
        requestHash: f.text({ label: label('要求ハッシュ', 'Request hash'), serverOwned: true, outputHidden: true })
    },
    allowOnSubmit: ['stockEntryId', 'cancelReason'],
    lines: [{ entity: 'trade_fulfillment_line', parentField: 'fulfillmentId' }],
    permissions: permissions(),
    views: { list: ['direction', 'orderId', 'date', 'warehouseId', 'stockEntryId'] }
});
export const TradeFulfillmentLine = defineEntity({
    name: 'trade_fulfillment_line',
    label: label('出荷・入荷明細', 'Fulfillment line'),
    fields: { ...lineFields(), fulfillmentId: f.ref('trade_fulfillment', { label: label('出荷・入荷', 'Fulfillment'), required: true, onDelete: 'cascade' }), orderLineId: f.ref('trade_order_line', { label: label('受発注明細', 'Order line'), required: true, serverOwned: true }) },
    permissions: permissions(true),
    views: { list: lineView }
});
export const TradeBilling = defineDocument({
    name: 'trade_billing',
    label: label('商流請求', 'Trade billing'),
    naming: { type: 'sequence', prefix: 'BIL-', period: 'year' },
    fields: {
        ...headFields(),
        fulfillmentId: f.ref('trade_fulfillment', { label: label('出荷・入荷', 'Fulfillment'), required: true, serverOwned: true }),
        dueDate: f.date({ label: label('支払期日', 'Due date') }),
        supplierInvoiceNo: f.text({ label: label('仕入先請求番号', 'Supplier invoice number'), maxLength: 50 }),
        salesInvoiceId: f.ref('sales_invoice', { label: label('売上請求', 'Sales invoice'), serverOwned: true }),
        purchaseInvoiceId: f.ref('purchase_invoice', { label: label('仕入請求', 'Purchase invoice'), serverOwned: true }),
        total: f.money({
            label: label('請求税込額', 'Invoiced total'),
            required: true,
            default: '0',
            serverOwned: true
        }),
        requestId: f.uuid({
            label: label('再送識別子', 'Request ID'),
            serverOwned: true,
            required: true,
            unique: true
        }),
        requestHash: f.text({ label: label('要求ハッシュ', 'Request hash'), serverOwned: true, outputHidden: true }),
        cancelReason: f.text({ label: label('取消理由', 'Cancellation reason'), serverOwned: true, maxLength: 1000 })
    },
    allowOnSubmit: ['salesInvoiceId', 'purchaseInvoiceId', 'total', 'cancelReason'],
    lines: [{ entity: 'trade_billing_line', parentField: 'billingId' }],
    permissions: permissions(),
    views: { list: ['direction', 'fulfillmentId', 'date', 'salesInvoiceId', 'purchaseInvoiceId', 'total'] }
});
export const TradeBillingLine = defineEntity({
    name: 'trade_billing_line',
    label: label('商流請求明細', 'Trade billing line'),
    fields: { ...lineFields(), billingId: f.ref('trade_billing', { label: label('商流請求', 'Billing'), required: true, onDelete: 'cascade' }), fulfillmentLineId: f.ref('trade_fulfillment_line', { label: label('出荷・入荷明細', 'Fulfillment line'), required: true, serverOwned: true }) },
    permissions: permissions(true),
    views: { list: lineView }
});
export const tradeEntities = [TradeQuotation, TradeQuotationLine, TradeOrder, TradeOrderLine, TradeFulfillment, TradeFulfillmentLine, TradeBilling, TradeBillingLine];
