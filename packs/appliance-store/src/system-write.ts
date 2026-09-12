import { defineWriteCapability, withWriteCapability, type Context } from '@daifuku/kernel';
const serviceWrite = defineWriteCapability({ name: 'appliance-store-service', entity: 'appliance_store_service', fields: ['status', 'salesInvoiceId'], operations: ['update'] });
export function withServiceWrite<T>(ctx: Context, work: (ctx: Context) => Promise<T>): Promise<T> { return withWriteCapability(ctx, serviceWrite, work); }
