import { Conflict, Decimal, defineWriteCapability, hasWriteCapability, PermissionDenied, StateError, withWriteCapability, type Context, type EntityDef, type Infer, type ListQuery } from '@daifuku/kernel';
import { repo } from '@daifuku/kernel';
import { tradeEntities, TradeOrder } from './entities.ts';
const grants = tradeEntities.map((e) => defineWriteCapability({
    name: 'trade.' + e.name,
    entity: e.name,
    fields: e.fieldNames,
    operations: ['create', 'update', 'workflow']
}));
export const internal = (ctx: Context) => hasWriteCapability(ctx, TradeOrder.name, 'workflow');
export async function writeTrade<T>(ctx: Context, work: (inner: Context) => Promise<T>): Promise<T> {
    const next = (i: number, current: Context): Promise<T> => {
        const grant = grants[i];
        return grant ? withWriteCapability(current, grant, (inner) => next(i + 1, inner)) : work(current);
    };
    return next(0, ctx);
}
export function assertInternal(ctx: Context) {
    if (!internal(ctx))
        throw new StateError('商流の専用操作を使用してください。', '出荷・入荷・請求は元文書から作成します。');
}
export function assertDirection(ctx: Context, value: unknown) {
    if (ctx.roles.includes('admin'))
        return;
    if (!ctx.roles.includes(value === 'sales' ? 'sales' : 'purchasing'))
        throw new PermissionDenied('trade_order', String(value), ctx.roles);
}
export function assertVersion(row: {
    version: number;
}, expected: number) {
    if (row.version !== expected)
        throw new Conflict('商流文書が更新されました。', '最新の内容を読み込み直してください。');
}
export function positiveQuantity(value: unknown) {
    const d = Decimal.from(String(value));
    if (!d.gt('0') || !d.roundDown(6).eq(d))
        throw new StateError('数量は小数6桁以内の正数にしてください。', '数量を訂正してください。');
    return d;
}
export async function all<E extends EntityDef>(ctx: Context, entity: E, query: ListQuery): Promise<Infer<E>[]> {
    const rows: Infer<E>[] = [];
    for (let offset = 0;; offset += 500) {
        const page = await repo(ctx, entity).list({ ...query, limit: 500, offset });
        rows.push(...page.items);
        if (page.items.length === 0 || offset + page.items.length >= page.total)
            return rows;
        if (rows.length >= 10000)
            throw new StateError('関連資料が1万件を超えました。', '商流を複数注文へ分けてください。');
    }
}
export function result(row: {
    id: string;
    version: number;
    number: string | null;
    docstatus: number;
}, entity: EntityDef) {
    return {
        id: row.id,
        version: row.version,
        number: row.number,
        docstatus: row.docstatus,
        entity: entity.name
    };
}
