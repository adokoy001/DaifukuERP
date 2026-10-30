// Derived generic read action <entity>.related (document-links AC-2/AC-3): the records related to one record, through
// kernel/src/related.ts. Registered for every entity by registerRelatedActions(), which registerCrudActions() calls once.
import { z } from 'zod';
import { defineAction } from '../dsl/action.ts';
import type { EntityDef } from '../dsl/entity.ts';
import { label } from '../i18n.ts';
import { registry } from '../registry.ts';
import { relatedRecords } from '../related.ts';

const relatedItem = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  number: z.string().nullable(),
  docstatus: z.number().int().nullable(),
  date: z.string().nullable(),
  relation: z.enum(['references', 'referenced_by', 'amended_from', 'amendment']),
  via: z.string(),
});

export const relatedOutput = z.object({
  entity: z.string(),
  id: z.uuid(),
  groups: z.array(
    z.object({
      entity: z.string(),
      label: z.object({ ja: z.string(), en: z.string() }),
      kind: z.enum(['entity', 'document']),
      items: z.array(relatedItem),
      more: z.boolean(),
    }),
  ),
});

function registerRelatedAction(entity: EntityDef): void {
  const { name } = entity;
  const { ja, en } = entity.config.label;
  defineAction(
    {
      name: `${name}.related`,
      description: label(
        `${ja}1件に関連する記録（参照先・参照元・訂正元・訂正先）を entity ごとに最大50件返します。読めない entity は含みません。`,
        `Records related to one ${en} (referenced, referencing, amendment chain), up to 50 per entity; unreadable entities are omitted.`,
      ),
      input: z.object({ id: z.uuid() }),
      output: relatedOutput,
      permission: { entity: name, op: 'read' },
      tx: 'none',
      mutates: false,
      handler: async (ctx, { id }) => relatedRecords(ctx, entity, id),
    },
    { generic: true },
  );
}

/** Registers <entity>.related for every entity that has none yet (idempotent, like registerCrudActions). */
export function registerRelatedActions(): void {
  for (const entity of registry.allEntities())
    if (!registry.hasAction(`${entity.name}.related`)) registerRelatedAction(entity);
}
