// Test-only entities exercising every DSL feature. Names are prefixed to avoid clashing with real modules.
import { z } from 'zod';
import { Decimal } from '../../src/decimal.ts';
import { defineAction } from '../../src/dsl/action.ts';
import { defineDocument, defineEntity } from '../../src/dsl/entity.ts';
import { f } from '../../src/dsl/fields.ts';
import { defineModule } from '../../src/dsl/module.ts';
import { label } from '../../src/i18n.ts';
import { registry } from '../../src/registry.ts';
import { repo } from '../../src/repository/repository.ts';

export const TPartner = defineEntity({
  name: 'test_partner',
  label: label('テスト取引先', 'Test partner'),
  fields: {
    name: f.text({ required: true, label: label('名称', 'Name'), maxLength: 100 }),
    nameKana: f.text({ label: label('カナ', 'Kana'), normalize: 'halfwidth-kana' }),
    code: f.text({ unique: true, immutable: true }),
    kind: f.enum(['customer', 'supplier', 'both'], { default: 'customer', required: true }),
    creditLimit: f.money({ label: label('与信限度', 'Credit limit') }),
    ownerId: f.uuid({ label: label('担当者', 'Owner') }),
    isActive: f.bool({ default: true, required: true }),
    secretNote: f.text({ label: label('機密メモ', 'Secret note') }),
    since: f.date(),
  },
  permissions: {
    roles: {
      sales: ['read', 'create', 'update'],
      viewer: ['read'],
      manager: ['read', 'create', 'update', 'delete', 'export'],
    },
    rowRules: [{ roles: ['sales'], where: { $or: [{ ownerId: '$ctx.userId' }, { ownerId: null }] } }],
    fieldGroups: { secret: { fields: ['secretNote'], roles: ['manager'] } },
  },
  views: { list: ['name', 'kind', 'creditLimit'], search: ['name', 'nameKana'] },
});

export const TMemo = defineDocument({
  name: 'test_memo',
  label: label('テストメモ伝票', 'Test memo document'),
  naming: { type: 'sequence', prefix: 'MEMO-', period: 'year', width: 4 },
  fields: {
    partnerId: f.ref('test_partner', { required: true }),
    date: f.date({ required: true }),
    amount: f.money({ required: true, default: '0' }),
    note: f.text(),
    remarks: f.text(),
  },
  allowOnSubmit: ['remarks'],
  lines: [{ entity: 'test_memo_line', parentField: 'memoId' }],
  transitions: {
    approve: { from: 0, to: 1, roles: ['manager'], guard: 'memo_has_amount' },
  },
  permissions: {
    roles: {
      sales: ['read', 'create', 'update', 'submit'],
      manager: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
    },
  },
});

export const TMemoLine = defineEntity({
  name: 'test_memo_line',
  label: label('テストメモ明細', 'Test memo line'),
  fields: {
    memoId: f.ref('test_memo', { required: true, onDelete: 'cascade' }),
    seq: f.int({ required: true, default: 1 }),
    description: f.text({ required: true }),
    qty: f.quantity({ required: true, default: '1' }),
    amount: f.money({ required: true, default: '0' }),
  },
  audit: 'none',
  permissions: {
    roles: {
      sales: ['read', 'create', 'update', 'delete'],
      manager: ['read', 'create', 'update', 'delete'],
    },
  },
});

export const echoAction = defineAction({
  name: 'test.echo',
  description: label('入力をそのまま返す', 'Echo input'),
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string(), roles: z.array(z.string()) }),
  permission: 'authenticated',
  tx: 'none',
  handler: async (ctx, { text }) => ({ text, roles: [...ctx.roles] }),
});

export const countPartners = defineAction({
  name: 'test.count_partners',
  description: label('取引先数を数える', 'Count partners'),
  input: z.object({}),
  output: z.object({ count: z.number().int() }),
  permission: { entity: 'test_partner', op: 'read' },
  tx: 'none',
  handler: async (ctx) => ({ count: await repo(ctx, TPartner).count() }),
});

export const TestModule = defineModule({
  name: 'test',
  label: label('テスト', 'Test'),
  depends: [],
  entities: [TPartner, TMemo, TMemoLine],
  actions: [echoAction, countPartners],
  hooks: () => {
    registry.registerGuard('memo_has_amount', (_ctx, row) => !Decimal.from(String(row.amount ?? '0')).isZero());
    registry.registerHook('test_partner', 'before_validate', (_ctx, { row }) => {
      if (typeof row.name === 'string') row.name = row.name.trim();
    });
  },
  menus: [{ label: label('取引先', 'Partners'), entity: 'test_partner' }],
});
