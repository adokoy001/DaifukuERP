import { z } from 'zod';
export const direction = z.enum(['sales', 'purchase']);
const date = z.iso.date(), decimal = z.string(), version = z.number().int().min(1);
const quantity = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/).refine((v) => /[1-9]/.test(v), '数量は0より大きくしてください');
export const boardInput = z.object({
    direction,
    partnerId: z.uuid().optional(),
    status: z.enum(['open', 'all']).default('open'),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0)
}).strict();
export const convertInput = z.object({
    quotationId: z.uuid(),
    expectedVersion: version,
    date,
    requiredDate: date.optional()
}).strict();
export const fulfillInput = z.object({
    orderId: z.uuid(),
    expectedVersion: version,
    date,
    warehouseId: z.uuid(),
    lines: z.array(z.object({ orderLineId: z.uuid(), quantity }).strict()).min(1).max(500),
    requestId: z.uuid()
}).strict();
export const billInput = z.object({
    fulfillmentId: z.uuid(),
    expectedVersion: version,
    date,
    dueDate: date.optional(),
    supplierInvoiceNo: z.string().max(50).optional(),
    lines: z.array(z.object({ fulfillmentLineId: z.uuid(), quantity }).strict()).min(1).max(500),
    requestId: z.uuid()
}).strict();
export const cancelBillingInput = z.object({
    billingId: z.uuid(),
    expectedVersion: version,
    correctionDate: date,
    reason: z.string().trim().min(1).max(1000)
}).strict();
export const cancelFulfillmentInput = z.object({
    fulfillmentId: z.uuid(),
    expectedVersion: version,
    correctionDate: date,
    reason: z.string().trim().min(1).max(1000)
}).strict();
export const closeInput = z.object({ orderId: z.uuid(), expectedVersion: version, reason: z.string().trim().min(1).max(1000) }).strict();
export const command = z.object({
    id: z.uuid(),
    entity: z.string(),
    version,
    number: z.string().nullable(),
    docstatus: z.number().int()
});
export const orderRow = command.extend({
    direction,
    partnerId: z.uuid(),
    partner: z.string(),
    date,
    requiredDate: date.nullable(),
    total: decimal,
    status: z.enum(['draft', 'open', 'fulfilled', 'closed', 'cancelled']),
    openLineCount: z.number().int(),
    unbilledLineCount: z.number().int(),
    closedReason: z.string().nullable()
});
export const boardOutput = z.object({
    rows: z.array(orderRow),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
    currency: z.literal('JPY')
});
const line = z.object({
    id: z.uuid(),
    seq: z.number().int(),
    productId: z.uuid(),
    description: z.string(),
    uomCode: z.string(),
    quantity: decimal,
    unitPrice: decimal,
    taxCategory: z.string(),
    amount: decimal
});
export const orderLine = line.extend({
    fulfilledQuantity: decimal,
    billedQuantity: decimal,
    remainingQuantity: decimal,
    unbilledQuantity: decimal
});
export const fulfillmentLine = line.extend({ orderLineId: z.uuid(), billedQuantity: decimal, unbilledQuantity: decimal });
export const billingRow = command.extend({
    date,
    cancelledDate: date.nullable(),
    invoiceId: z.uuid().nullable(),
    invoiceEntity: z.string(),
    invoiceNumber: z.string().nullable(),
    total: decimal
});
export const fulfillmentRow = command.extend({
    date,
    cancelledDate: date.nullable(),
    warehouseId: z.uuid(),
    warehouse: z.string(),
    stockEntryId: z.uuid().nullable(),
    lines: z.array(fulfillmentLine),
    billings: z.array(billingRow)
});
export const detailOutput = z.object({ order: orderRow, lines: z.array(orderLine), fulfillments: z.array(fulfillmentRow) });
export type TradeBoard = z.infer<typeof boardOutput>;
export type TradeOrderDetail = z.infer<typeof detailOutput>;
export type TradeCommand = z.infer<typeof command>;
