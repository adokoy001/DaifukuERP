import {
  Decimal,
  DOCSTATUS,
  getCompany,
  isSavingLines,
  registry,
  repo,
  StateError,
  type Context,
  type EntityDef,
  type LocalDate,
} from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { Product, Uom } from '@daifuku/mod-product';
import { taxSummaryFor, type TaxCategory } from '@daifuku/mod-tax';
import { TradeOrder, TradeOrderLine, TradeQuotation, TradeQuotationLine } from './entities.ts';
import { all, assertDirection, positiveQuantity } from './internal.ts';
type Raw = Record<string, unknown>;
export async function fillPlanningLine(
  ctx: Context,
  row: Raw,
  previous: Raw | undefined,
  parent: EntityDef,
  field: string,
) {
  const value = { ...previous, ...row },
    head = await repo(ctx, parent).get(String(value[field]));
  row.direction = head.direction;
  const product = await repo(ctx, Product).get(String(value.productId));
  if (
    product.kind !== 'goods' ||
    !product.isActive ||
    (head.direction === 'sales' ? !product.isSold : !product.isPurchased)
  )
    throw new StateError('有効な販売・購買対象の物品を選択してください。', 'サービスや無効品目は商流の対象外です。');
  const unit = product.uomId ? await repo(ctx, Uom).get(product.uomId) : null;
  if (!unit) throw new StateError('在庫単位が未設定です。', '品目に固定在庫単位を設定してください。');
  row.uomId = product.uomId;
  row.uomCode = unit.code;
  row.description = value.description ?? product.name;
  row.taxCategory = value.taxCategory ?? product.taxCategory;
  row.unitPrice = value.unitPrice ?? (head.direction === 'sales' ? product.salePrice : product.purchasePrice);
  const qty = positiveQuantity(value.quantity ?? '1'),
    price = Decimal.from(String(row.unitPrice));
  if (price.lt('0') || !price.roundDown(6).eq(price))
    throw new StateError('単価は小数6桁以内の0以上にしてください。', '税抜単価を入力してください。');
  row.amount = qty.times(price);
}
async function frozen(ctx: Context, parent: EntityDef, id: unknown) {
  if (!id) return;
  const row = await repo(ctx, parent).get(String(id));
  if (row.docstatus !== DOCSTATUS.draft)
    throw new StateError('確定済み文書の明細は変更できません。', '取消・改訂してください。');
}
export function registerPlanningLines(parent: EntityDef, line: EntityDef, field: string) {
  registry.registerHook(line.name, 'before_validate', (ctx, { row, previous }) =>
    fillPlanningLine(ctx, row, previous, parent, field),
  );
  for (const phase of ['before_create', 'before_update', 'before_delete'] as const)
    registry.registerHook(line.name, phase, async (ctx, { row, previous }) => {
      await frozen(ctx, parent, row[field]);
      await frozen(ctx, parent, previous?.[field]);
    });
  for (const phase of ['after_create', 'after_update', 'after_delete'] as const)
    registry.registerHook(line.name, phase, async (ctx, { row, previous }) => {
      for (const id of new Set([row[field], previous?.[field]]))
        if (typeof id === 'string' && !isSavingLines(ctx, parent.name, id)) await repo(ctx, parent).update(id, {});
    });
}
async function estimate(ctx: Context, row: Raw, line: EntityDef, parentField: string, requireLines: boolean) {
  const lines = await all(ctx, line, {
    where: { [parentField]: String(row.id) },
    orderBy: [{ field: 'seq', dir: 'asc' }],
  });
  if (lines.length > 500 || (requireLines && !lines.length))
    throw new StateError('明細は1～500行です。', '物品明細を入力してください。');
  const summary = await taxSummaryFor(ctx, {
    date: row.date as LocalDate,
    priceIncludesTax: false,
    lines: lines.map((l) => ({
      amount: Decimal.from(String(l.quantity)).times(String(l.unitPrice)),
      category: l.taxCategory as TaxCategory,
    })),
  });
  Object.assign(row, {
    subtotal: summary.totals.taxable,
    taxTotal: summary.totals.tax,
    total: summary.totals.gross,
    taxSummary: summary.groups.map((g) => ({
      category: g.category,
      code: g.code,
      rate: g.rate.toString(),
      taxable: g.taxable.toString(),
      tax: g.tax.toString(),
      gross: g.gross.toString(),
    })),
  });
  if (requireLines && !summary.totals.gross.gt('0'))
    throw new StateError('注文見込額は0円より大きくしてください。', '数量と単価を確認してください。');
}
function registerHead(entity: EntityDef, line: EntityDef, field: string) {
  registry.registerHook(entity.name, 'before_validate', async (ctx, { row, previous }) => {
    if (entity === TradeQuotation && !previous) row.direction = 'sales';
    if (!previous)
      Object.assign(row, {
        subtotal: '0',
        taxTotal: '0',
        total: '0',
        taxSummary: [],
      });
    const v = { ...previous, ...row };
    assertDirection(ctx, v.direction);
    if (v.requiredDate && String(v.requiredDate) < String(v.date))
      throw new StateError('希望納期が注文日より前です。', '日付を確認してください。');
  });
  registry.registerHook(entity.name, 'before_update', async (ctx, { row }) => {
    if (row.docstatus === DOCSTATUS.draft) await estimate(ctx, row, line, field, false);
  });
  registry.registerHook(entity.name, 'after_lines_saved', (ctx, { row }) =>
    repo(ctx, entity)
      .update(String(row.id), {})
      .then(() => undefined),
  );
  registry.registerHook(entity.name, 'before_submit', async (ctx, { row }) => {
    assertDirection(ctx, row.direction);
    if ((await getCompany(ctx)).currency !== 'JPY')
      throw new StateError('商流はJPY会社のみです。', 'JPY会社を使用してください。');
    const partner = await repo(ctx, Partner).get(String(row.partnerId));
    if (row.direction === 'sales' ? !partner.isCustomer : !partner.isSupplier)
      throw new StateError('取引先の販売・購買区分が不正です。', '得意先・仕入先区分を確認してください。');
    row.partnerName = partner.name;
    if (entity === TradeOrder && row.amendedFrom) {
      const original = await repo(ctx, TradeOrder).get(String(row.amendedFrom));
      if (original.quotationId) row.quotationId = original.quotationId;
    }
    if (row.quotationId) {
      const quote = await repo(ctx, TradeQuotation).lock(String(row.quotationId), 'read');
      if (
        await repo(ctx, TradeOrder).count({
          quotationId: quote.id,
          id: { $ne: String(row.id) },
          docstatus: { $ne: DOCSTATUS.cancelled },
        })
      )
        throw new StateError(
          '同じ見積を使用する受注が存在します。',
          '既存受注を確認し、重複する下書きを整理してください。',
        );
      if (quote.docstatus !== DOCSTATUS.submitted || quote.partnerId !== row.partnerId || row.direction !== 'sales')
        throw new StateError('元見積が無効、または取引先が異なります。', '有効な見積から受注を作成してください。');
    }
    if (row.validUntil && String(row.validUntil) < String(row.date))
      throw new StateError('見積有効期限が見積日より前です。', '有効期限を確認してください。');
    await estimate(ctx, row, line, field, true);
  });
}
export function registerPlanningHooks() {
  registry.registerHook(TradeQuotation.name, 'before_cancel', async (ctx, { row }) => {
    if (
      (await repo(ctx, TradeOrder).count({ quotationId: String(row.id), docstatus: { $ne: DOCSTATUS.cancelled } })) > 0
    )
      throw new StateError(
        '元見積を使用する受注が残っています。',
        '下書きは削除、確定受注は取消してから見積を取り消してください。',
      );
  });
  registerPlanningLines(TradeQuotation, TradeQuotationLine, 'quotationId');
  registerPlanningLines(TradeOrder, TradeOrderLine, 'orderId');
  registerHead(TradeQuotation, TradeQuotationLine, 'quotationId');
  registerHead(TradeOrder, TradeOrderLine, 'orderId');
}
