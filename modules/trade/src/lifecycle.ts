import { cancelDocument, DOCSTATUS, registry, repo, StateError, type Context, type EntityDef, type HookArgs } from '@daifuku/kernel';
import type { z } from 'zod';
import type { cancelBillingInput, cancelFulfillmentInput, closeInput } from './contract.ts';
import { TradeBilling, TradeBillingLine, TradeFulfillment, TradeFulfillmentLine, TradeOrder } from './entities.ts';
import { all, assertDirection, assertInternal, assertVersion, result, writeTrade } from './internal.ts';
import { actualDate } from './generate.ts';
function generated(entity: EntityDef) {
    for (const phase of ['before_create', 'before_update', 'before_delete', 'before_submit'] as const)
        registry.registerHook(entity.name, phase, (ctx) => assertInternal(ctx));
}
async function cancelDate(ctx: Context, args: HookArgs, children: EntityDef, parentField: string) {
    const { row, correctionDate } = args, date = correctionDate ?? String(row.date);
    actualDate(ctx, date, String(row.date));
    const descendants = await all(ctx, children, { where: { [parentField]: String(row.id) } });
    if (descendants.some((c) => c.docstatus !== DOCSTATUS.cancelled || (c.cancelledDate && String(c.cancelledDate) > date)))
        throw new StateError('後続文書が残る、または後続取消日より前です。', '後続文書を取消し、その取消日以降を指定してください。');
    row.cancelledDate = date;
}
export function registerLifecycleHooks() {
    for (const entity of [TradeFulfillment, TradeFulfillmentLine, TradeBilling, TradeBillingLine])
        generated(entity);
    registry.registerHook(TradeFulfillment.name, 'before_cancel', async (ctx, args) => {
        assertInternal(ctx);
        await repo(ctx, TradeOrder).lock(String(args.row.orderId));
        await cancelDate(ctx, args, TradeBilling, 'fulfillmentId');
    });
    registry.registerHook(TradeBilling.name, 'before_cancel', async (ctx, { row, correctionDate }) => {
        assertInternal(ctx);
        await repo(ctx, TradeFulfillment).lock(String(row.fulfillmentId));
        actualDate(ctx, correctionDate ?? String(row.date), String(row.date));
        row.cancelledDate = correctionDate ?? row.date;
    });
    registry.registerHook(TradeOrder.name, 'before_cancel', (ctx, args) => cancelDate(ctx, args, TradeFulfillment, 'orderId'));
}
export async function cancelBilling(ctx: Context, input: z.infer<typeof cancelBillingInput>) {
    const row = await repo(ctx, TradeBilling).lock(input.billingId, 'cancel');
    assertVersion(row, input.expectedVersion);
    assertDirection(ctx, row.direction);
    return writeTrade(ctx, async (inner) => {
        await repo(inner, TradeBilling).update(row.id, { cancelReason: input.reason });
        return result(await cancelDocument(inner, TradeBilling, row.id, { correctionDate: input.correctionDate }), TradeBilling);
    });
}
export async function cancelFulfillment(ctx: Context, input: z.infer<typeof cancelFulfillmentInput>) {
    const row = await repo(ctx, TradeFulfillment).lock(input.fulfillmentId, 'cancel');
    assertVersion(row, input.expectedVersion);
    assertDirection(ctx, row.direction);
    return writeTrade(ctx, async (inner) => {
        await repo(inner, TradeFulfillment).update(row.id, { cancelReason: input.reason });
        return result(await cancelDocument(inner, TradeFulfillment, row.id, { correctionDate: input.correctionDate }), TradeFulfillment);
    });
}
export async function closeOrder(ctx: Context, input: z.infer<typeof closeInput>) {
    const row = await repo(ctx, TradeOrder).lock(input.orderId);
    assertVersion(row, input.expectedVersion);
    assertDirection(ctx, row.direction);
    if (row.docstatus !== DOCSTATUS.submitted || row.closed)
        throw new StateError('未確定・取消・打切り済みの注文です。', '有効な確定注文を選んでください。');
    return writeTrade(ctx, async (inner) => result(await repo(inner, TradeOrder).update(row.id, { closed: true, closedReason: input.reason }), TradeOrder));
}
