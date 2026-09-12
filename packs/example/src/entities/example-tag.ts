// A tiny pack-owned master (docs/specs/pack.md AC-6): packs may add small entities; they get a table, /meta and generic CRUD.
import { defineEntity, f, label } from '@daifuku/kernel';

export const ExampleTag = defineEntity({
  name: 'example_tag',
  label: label('タグ', 'Tag'),
  fields: {
    code: f.text({ label: label('コード', 'Code'), required: true, unique: true, immutable: true, maxLength: 20 }),
    name: f.text({ label: label('名称', 'Name'), required: true, maxLength: 100 }),
  },
  permissions: {
    roles: {
      sales: ['read', 'create', 'update'],
      viewer: ['read'],
    },
  },
  views: { list: ['code', 'name'], search: ['code', 'name'] },
});
