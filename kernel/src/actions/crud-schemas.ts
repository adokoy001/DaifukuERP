// Zod shapes of the generic entity actions (ADR-0009): lines input/output, and the create/update inputs with the
// registered ext fields (ADR-0014). Documentation for OpenAPI/MCP; create/update are lenient, the Repository validates.
import { z } from 'zod';
import type { ActionDef } from '../dsl/action.ts';
import type { EntityDef } from '../dsl/entity.ts';
import { extInputSchema } from '../ext.ts';
import { lineSpecs } from '../lines.ts';
import { registry } from '../registry.ts';

type ObjectSchema = z.ZodObject<Record<string, z.ZodType>>;

export function hasLines(entity: EntityDef): boolean {
  return (entity.doc?.lines?.length ?? 0) > 0;
}

/** `ext` typed with the registered fields (loose), or the entity schema unchanged when none are registered. */
function withExt(entity: EntityDef, schema: ObjectSchema, mode: 'insert' | 'update'): ObjectSchema {
  const ext = extInputSchema(entity, mode);
  return ext ? schema.extend({ ext }) : schema;
}

/** `lines: { <lineEntity>: [ {id?, ...fields} ] }` — parent ref omitted, assigned by the kernel. */
function linesInputSchema(entity: EntityDef): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const { entity: line, parentField } of lineSpecs(entity)) {
    const withoutParent = withExt(line, line.schemas.insert, 'insert').omit({ [parentField]: true } as never) as unknown as ObjectSchema;
    shape[line.name] = z.array(withoutParent.extend({ id: z.uuid().optional() })).max(500);
  }
  return z.object(shape).partial();
}

function linesJsonSchema(entity: EntityDef): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const { entity: line } of lineSpecs(entity)) shape[line.name] = z.array(line.schemas.json);
  return z.object(shape).partial();
}

/** Output of get/create/update: the JSON row, plus `lines` for documents with line entities. */
export function recordJsonSchema(entity: EntityDef): z.ZodType {
  return hasLines(entity) ? entity.schemas.json.extend({ lines: linesJsonSchema(entity).optional() }) : entity.schemas.json;
}

export function createInputSchema(entity: EntityDef): z.ZodType {
  const insert = withExt(entity, entity.schemas.insert, 'insert');
  return hasLines(entity) ? insert.extend({ lines: linesInputSchema(entity).optional() }) : insert;
}

export function updateInputSchema(entity: EntityDef): z.ZodType {
  const update = withExt(entity, entity.schemas.update, 'update');
  const patch = hasLines(entity) ? update.extend({ lines: linesInputSchema(entity).optional() }) : update;
  return z.object({ id: z.uuid(), patch, expectedVersion: z.number().int().optional() });
}

/**
 * Makes `def.input` follow ext fields registered after the action was defined (packs may register after
 * registerCrudActions): the schema is rebuilt when the entity's or a line entity's ext version changes.
 */
export function followExtFields(def: ActionDef, entity: EntityDef, build: (entity: EntityDef) => z.ZodType): void {
  const stamp = () => [entity, ...lineSpecs(entity).map((s) => s.entity)].map((e) => registry.extVersion(e.name)).join(',');
  let seen = stamp();
  let schema = def.input;
  Object.defineProperty(def, 'input', {
    enumerable: true,
    configurable: true,
    get: () => {
      const now = stamp();
      if (now !== seen) {
        schema = build(entity);
        seen = now;
      }
      return schema;
    },
  });
}
