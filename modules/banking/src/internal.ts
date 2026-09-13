import {
  Conflict,
  PermissionDenied,
  StateError,
  defineWriteCapability,
  hasWriteCapability,
  registry,
  repo,
  withLock,
  withWriteCapability,
  type Context,
  type EntityDef,
} from '@daifuku/kernel';
import { Payment } from '@daifuku/mod-payment';
import { BankAccount, BankImport, BankReconciliation, bankingEntities } from './entities.ts';
const capabilities = new Map(
  bankingEntities.map((entity) => [
    entity.name,
    defineWriteCapability({
      name: `banking.${entity.name}`,
      entity: entity.name,
      fields: entity.fieldNames,
      operations: ['create', 'update', 'workflow'],
    }),
  ]),
);
export function assertBankContext(ctx: Context) {
  if (
    !ctx.companyId ||
    ctx.actor.type === 'relay' ||
    (ctx.accessScope && ctx.accessScope !== 'all') ||
    !ctx.roles.some((role) => role === 'accounting' || role === 'admin')
  )
    throw new PermissionDenied('banking', 'company-accounting', ctx.roles);
}
export function bankLock<T>(ctx: Context, work: () => Promise<T>) {
  assertBankContext(ctx);
  return withLock(ctx, 'banking.workflow', work);
}
export function bankWrite<T>(ctx: Context, entity: EntityDef, work: (inner: Context) => Promise<T>): Promise<T> {
  const cap = capabilities.get(entity.name);
  if (!cap) throw new StateError('Unknown banking entity', 'Use a banking workflow.');
  return withWriteCapability(ctx, cap, work);
}
export function checkVersion(actual: number, expected: number | undefined) {
  if (expected !== actual)
    throw new Conflict('確認後にデータが変更されました。', '最新の内容を再表示して確認してください。');
}
export function checkRequest(actual: string, expected: string) {
  if (actual !== expected)
    throw new Conflict('同じ操作 ID に異なる内容が指定されました。', '元の操作結果を確認してください。');
}
export function registerBankGuards() {
  for (const entity of bankingEntities) {
    for (const phase of ['before_create', 'before_update', 'before_delete'] as const)
      registry.registerHook(entity.name, phase, (ctx) => {
        assertBankContext(ctx);
        if (phase === 'before_delete' || !hasWriteCapability(ctx, entity.name, 'workflow'))
          throw new StateError('銀行ワークスペースから操作してください。', '銀行データの直接変更・削除はできません。');
      });
  }
  registry.registerHook(BankAccount.name, 'before_update', async (ctx, { row, previous }) => {
    const used = await repo(ctx, BankImport).count({ bankAccountId: String(row.id) });
    const fixed = ['ledgerAccountId', 'bankCode', 'branchCode', 'accountType', 'accountNumber'];
    if (used && fixed.some((field) => row[field] !== undefined && row[field] !== previous?.[field]))
      throw new StateError('使用済み口座の識別情報は変更できません。', '新しい口座コードで登録してください。');
  });
  registry.registerHook(Payment.name, 'before_cancel', async (ctx, { row }) => {
    const active = await repo(ctx, BankReconciliation).list({
      where: { paymentId: String(row.id), state: 'active' },
      limit: 1,
    });
    if (active.items.length && !hasWriteCapability(ctx, BankReconciliation.name, 'workflow'))
      throw new StateError(
        '銀行照合を先に取り消してください。',
        '銀行ワークスペースから関連と帳簿を同時に取り消します。',
      );
  });
}
