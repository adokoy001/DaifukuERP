// Test-only masters for the CSV import port (docs/specs/csv-import.md): every importable field kind, a ref target with a
// normalised code and a non-unique display name, server-owned / json / hidden / field-group fields, and a hook.
import { defineEntity } from '../../src/dsl/entity.ts';
import { f } from '../../src/dsl/fields.ts';
import { ValidationError } from '../../src/errors.ts';
import { label } from '../../src/i18n.ts';
import { registry } from '../../src/registry.ts';

export const ImpCategory = defineEntity({
  name: 'test_imp_category',
  label: label('テスト分類', 'Test category'),
  fields: {
    code: f.text({ unique: true, normalize: 'upper', label: label('分類コード', 'Category code') }),
    name: f.text({ required: true, label: label('分類名', 'Category name') }),
  },
  permissions: { roles: { clerk: ['read'], editor: ['read'], viewer: ['read'] } },
});

export const ImpItem = defineEntity({
  name: 'test_imp_item',
  label: label('テスト品目', 'Test item'),
  fields: {
    code: f.text({ unique: true, immutable: true, maxLength: 20, label: label('品目コード', 'Item code') }),
    name: f.text({ required: true, maxLength: 100, label: label('名称', 'Name') }),
    nameKana: f.text({ normalize: 'halfwidth-kana', label: label('カナ', 'Kana') }),
    categoryId: f.ref('test_imp_category', { label: label('分類', 'Category') }),
    price: f.money({ min: '0', label: label('単価', 'Price') }),
    qty: f.int({ min: 0, label: label('数量', 'Quantity') }),
    active: f.bool({ required: true, default: true, label: label('有効', 'Active') }),
    since: f.date({ label: label('開始日', 'Since') }),
    grade: f.enum(['a', 'b'], {
      required: true,
      default: 'a',
      label: label('等級', 'Grade'),
      labels: { a: label('上', 'Premium'), b: label('並', 'Standard') },
    }),
    kind: f.enum(['goods', 'service'], {
      required: true,
      default: 'goods',
      immutable: true,
      label: label('種別', 'Kind'),
    }),
    ownerId: f.uuid({ label: label('担当者', 'Owner') }),
    syncedAt: f.timestamp({ label: label('同期日時', 'Synced at') }),
    stockNote: f.text({ serverOwned: true, label: label('在庫メモ', 'Stock note') }),
    payload: f.json({ label: label('付加情報', 'Payload') }),
    cost: f.money({ label: label('原価', 'Cost') }),
    internalKey: f.text({ hidden: true, label: label('内部キー', 'Internal key') }),
    secretToken: f.text({ serverOwned: true, outputHidden: true }),
    serial: f.int({ unique: true, label: label('連番', 'Serial') }),
  },
  permissions: {
    roles: {
      clerk: ['read', 'create'],
      editor: ['read', 'create', 'update'],
      viewer: ['read'],
      blind: ['create'],
    },
    fieldGroups: { cost: { fields: ['cost'], roles: ['editor'] } },
  },
});

/** Two fields share a label: a header with that label is ambiguous, and the template falls back to field names. */
export const ImpDup = defineEntity({
  name: 'test_imp_dup',
  label: label('テスト重複ラベル', 'Test duplicate labels'),
  fields: {
    first: f.text({ label: label('名称', 'Name') }),
    second: f.text({ label: label('名称', 'Name') }),
  },
  permissions: { roles: {} },
});

/** Nothing a file may set: not importable. */
export const ImpOwned = defineEntity({
  name: 'test_imp_owned',
  label: label('テスト所有のみ', 'Test owned only'),
  fields: { token: f.text({ serverOwned: true }), data: f.json() },
  permissions: { roles: {} },
});

/** The hook runs in dry-run exactly as in execute (AC-6). */
registry.registerHook('test_imp_item', 'before_create', async (_ctx, { row }) => {
  if (row.name === 'REJECT')
    throw new ValidationError('rejected by hook', [{ path: 'name', message: 'the hook rejects this name' }]);
});
