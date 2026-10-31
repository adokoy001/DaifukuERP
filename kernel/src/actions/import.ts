// Derived `<entity>.import` action (docs/specs/csv-import.md AC-1, ADR-0028): one generic action per importable master
// entity, registered next to the generic CRUD actions so REST (`POST /api/:entity/import`), `/actions/*` and MCP share it.
import { defineAction } from '../dsl/action.ts';
import type { EntityDef } from '../dsl/entity.ts';
import { label } from '../i18n.ts';
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, importInputSchema, importRecords, importResultSchema } from '../import.ts';

export function registerImportAction(entity: EntityDef): void {
  const { ja, en } = entity.config.label;
  defineAction(
    {
      name: `${entity.name}.import`,
      description: label(
        `${ja}を CSV の行（文字列のセル）から一括で取り込みます。mode: dry-run は検証のみで変更しません。` +
          `onExisting で既存行（keyField が一致）を skip / update / error にします。最大 ${IMPORT_MAX_ROWS} 行・2 MB。`,
        `Import ${en} records from CSV rows of string cells. mode dry-run validates without changing data; onExisting ` +
          `decides what happens to rows whose keyField matches an existing record (skip / update / error). ` +
          `At most ${IMPORT_MAX_ROWS} rows and 2 MB per request.`,
      ),
      input: importInputSchema,
      output: importResultSchema,
      permission: { entity: entity.name, op: 'create' },
      inputBytes: IMPORT_MAX_BYTES,
      handler: (ctx, input) => importRecords(ctx, entity, input),
    },
    { generic: true },
  );
}
