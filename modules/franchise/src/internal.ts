import {
  Decimal,
  defineWriteCapability,
  hasWriteCapability,
  registry,
  StateError,
  repo,
  withWriteCapability,
  type Context,
} from '@daifuku/kernel';
import { SalesInvoice } from '@daifuku/mod-sales';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import { Payment } from '@daifuku/mod-payment';
import { FranchiseAgreement, FranchiseSettlement } from './entities.ts';
const cap = defineWriteCapability({
  name: 'franchise.workflow',
  entity: FranchiseSettlement.name,
  fields: FranchiseSettlement.fieldNames,
  operations: ['create', 'update', 'workflow'],
});
export function writeFranchise<T>(ctx: Context, work: (inner: Context) => Promise<T>) {
  return withWriteCapability(ctx, cap, work);
}
export function registerFranchiseGuards() {
  for (const phase of ['before_create', 'before_update', 'before_delete'] as const)
    registry.registerHook(FranchiseSettlement.name, phase, (ctx) => {
      if (phase === 'before_delete' || !hasWriteCapability(ctx, FranchiseSettlement.name, 'workflow'))
        throw new StateError('FC精算操作を使用してください。', '生成された精算資料は直接変更できません。');
    });
  registry.registerHook(FranchiseAgreement.name, 'before_update', async (ctx, { row }) => {
    const current = await repo(ctx, FranchiseAgreement).lock(String(row.id));
    const used = await repo(ctx, FranchiseSettlement).list({ where: { agreementId: current.id }, limit: 1 });
    if (used.items.length)
      throw new StateError('使用済みFC契約は変更できません。', '次の期間は新しい契約コードで作成してください。');
  });
  registry.registerHook(FranchiseAgreement.name, 'before_validate', (_ctx, { row, previous }) => {
    const value = { ...previous, ...row };
    if (
      value.fixedAmount !== undefined &&
      !Decimal.from(String(value.fixedAmount)).roundDown(0).eq(String(value.fixedAmount))
    )
      throw new StateError('定額料は整数のJPY額にしてください。', '円未満の定額料は対応していません。');
    if (String(value.startDate) > String(value.endDate) || (value.direction === 'pay' && !value.expenseAccountId))
      throw new StateError(
        '契約期間または支払費用科目が不正です。',
        '開始・終了日と支払契約の費用科目を確認してください。',
      );
  });
  for (const [entity, field] of [
    [SalesInvoice, 'salesInvoiceId'],
    [PurchaseInvoice, 'purchaseInvoiceId'],
    [Payment, 'paymentId'],
  ] as const)
    registry.registerHook(entity.name, 'before_cancel', async (ctx, { row }) => {
      const owner = await repo(ctx, FranchiseSettlement).list({ where: { [field]: String(row.id) }, limit: 1 });
      if (owner.items.length && !hasWriteCapability(ctx, FranchiseSettlement.name, 'workflow'))
        throw new StateError(
          'FC精算画面から取消してください。',
          '精算・入出金・請求の整合性を保つため、一括取消を使用します。',
        );
    });
}
