// Test-only module for apps/mcp. Names are prefixed `mcp_test` so they never clash with real modules.
import { z } from 'zod';
import { defineAction, defineDocument, defineEntity, defineModule, f, label, repo } from '@daifuku/kernel';

export const MItem = defineEntity({
  name: 'mcp_test_item',
  label: label('MCPテスト品目', 'MCP test item'),
  fields: {
    name: f.text({ required: true, label: label('名称', 'Name'), maxLength: 100 }),
    code: f.text({ unique: true, immutable: true, label: label('コード', 'Code') }),
    kind: f.enum(['goods', 'service'], { default: 'goods', required: true, label: label('種別', 'Kind') }),
    price: f.money({ label: label('単価', 'Unit price'), min: '0' }),
    isActive: f.bool({ default: true, required: true, label: label('有効', 'Active') }),
    since: f.date({ label: label('取扱開始日', 'Since') }),
    secretNote: f.text({ label: label('機密メモ', 'Secret note') }),
  },
  permissions: {
    roles: {
      clerk: ['read', 'create', 'update'],
      viewer: ['read'],
    },
    fieldGroups: { secret: { fields: ['secretNote'], roles: ['manager'] } },
  },
  views: { list: ['name', 'kind', 'price'], search: ['name'] },
});

export const MOrder = defineDocument({
  name: 'mcp_test_order',
  label: label('MCPテスト注文', 'MCP test order'),
  naming: { type: 'sequence', prefix: 'MO-', period: 'year', width: 4 },
  fields: {
    itemId: f.ref('mcp_test_item', { required: true, label: label('品目', 'Item') }),
    date: f.date({ required: true, label: label('日付', 'Date') }),
    amount: f.money({ required: true, default: '0', label: label('金額', 'Amount') }),
    note: f.text({ label: label('備考', 'Note') }),
  },
  permissions: {
    roles: {
      clerk: ['read', 'create', 'update', 'submit'],
    },
  },
});

export const echo = defineAction({
  name: 'mcp_test.echo',
  description: label('入力をそのまま返す（接続確認用）', 'Echo the input back (connectivity check)'),
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string(), actorType: z.string(), onBehalfOf: z.string().nullable() }),
  permission: 'authenticated',
  tx: 'none',
  handler: async (ctx, { text }) => ({ text, actorType: ctx.actor.type, onBehalfOf: ctx.actor.onBehalfOf ?? null }),
});

export const countItems = defineAction({
  name: 'mcp_test.count_items',
  description: label('品目数を数える', 'Count items'),
  input: z.object({}),
  output: z.object({ count: z.number().int() }),
  permission: { entity: 'mcp_test_item', op: 'read' },
  tx: 'none',
  handler: async (ctx) => ({ count: await repo(ctx, MItem).count() }),
});

/** Deliberately broken: simulates a programming error (a non-DaifukuError thrown from a handler). */
export const broken = defineAction({
  name: 'mcp_test.broken',
  description: label('実行時エラーを起こす（テスト用）', 'Throws a runtime error (test only)'),
  input: z.object({}),
  output: z.object({ n: z.number() }),
  permission: 'authenticated',
  tx: 'none',
  handler: async () => JSON.parse('{not json: secret-internal-detail') as { n: number },
});

export const McpTestModule = defineModule({
  name: 'mcp_test',
  label: label('MCPテスト', 'MCP test'),
  depends: [],
  entities: [MItem, MOrder],
  actions: [echo, countItems, broken],
  menus: [{ label: label('品目', 'Items'), entity: 'mcp_test_item' }],
});
