// Spec AC-3: metadata for generic UIs and agents. web-phase1 AC-3/AC-5: actions carry `inputSchema` (JSON Schema)
// and `resultKind` so the web app can render report forms; settings routes are registered here too.
import {
  appliedPacksOf,
  appMeta,
  assertOp,
  DaifukuError,
  entityMeta,
  findCompany,
  registry,
  type ActionDef,
  type AppMeta,
  type Context,
  type Database,
  type MetaOptions,
} from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, withRequestContext } from '../request-context.ts';
import { registerSettingsRoutes } from './settings.ts';

const entityParams = z.object({ name: z.string().min(1).max(100) });

export function unknownEntity(name: string): DaifukuError {
  return new DaifukuError(
    'NOT_FOUND',
    `entity "${name}" does not exist`,
    'List entities with GET /meta.',
    { entity: name },
    404,
  );
}

// ---- action schemas ----------------------------------------------------------------------------

export type ResultKind = 'table' | 'record' | 'other';
type JsonSchema = z.core.JSONSchema.BaseSchema;

function isEmptySchema(s: unknown): boolean {
  return typeof s === 'object' && s !== null && Object.keys(s).length === 0;
}

/**
 * Same adjustments as apps/mcp: the kernel's Decimal input is `string | z.custom(Decimal)` — only the string
 * alternative is JSON-representable; `z.date()` inputs are ISO strings on the wire.
 */
function override(ctx: { zodSchema: z.core.$ZodTypes; jsonSchema: JsonSchema }): void {
  const def = ctx.zodSchema._zod.def;
  const json = ctx.jsonSchema;
  if (def.type === 'date') {
    json.type = 'string';
    json.format = 'date-time';
    return;
  }
  if (def.type === 'union' && Array.isArray(json.anyOf)) {
    const kept = json.anyOf.filter((m) => !isEmptySchema(m));
    if (kept.length > 0 && kept.length < json.anyOf.length) json.anyOf = kept;
  }
}

/** Zod -> JSON Schema without the `$schema` id (clients with draft-07 validators reject it). Undefined when zod cannot convert. */
export function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema | undefined {
  try {
    const { $schema: _omitted, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: 'any', override });
    return rest;
  } catch {
    return undefined;
  }
}

function propertyNames(schema: JsonSchema | undefined): Set<string> {
  const props =
    schema?.type === 'object' && typeof schema.properties === 'object' && schema.properties !== null
      ? schema.properties
      : {};
  return new Set(Object.keys(props));
}

/** TableResult (docs/conventions/reports.md) is recognised structurally: an object with title, columns[] and rows[]. */
export function resultKindOf(output: JsonSchema | undefined): ResultKind {
  const names = propertyNames(output);
  if (names.has('title') && names.has('columns') && names.has('rows')) return 'table';
  if (names.has('id') && names.has('version') && names.has('tenantId')) return 'record';
  return 'other';
}

export interface ActionSchemaMeta {
  resultKind: ResultKind;
  /** Only for module actions: generic CRUD inputs are already described per entity by `fields`. */
  inputSchema?: JsonSchema;
}

const schemaCache = new Map<string, ActionSchemaMeta>();

function actionSchemaMeta(action: ActionDef): ActionSchemaMeta {
  const cached = schemaCache.get(action.name);
  if (cached) return cached;
  const meta: ActionSchemaMeta = { resultKind: resultKindOf(toJsonSchema(action.output, 'output')) };
  if (!action.generic) {
    const input = toJsonSchema(action.input, 'input');
    if (input) meta.inputSchema = input;
  }
  schemaCache.set(action.name, meta);
  return meta;
}

export type ActionMetaOut = AppMeta['actions'][number] & ActionSchemaMeta;

function withActionSchemas(meta: AppMeta): Omit<AppMeta, 'actions'> & { actions: ActionMetaOut[] } {
  return { ...meta, actions: meta.actions.map((a) => ({ ...a, ...actionSchemaMeta(registry.action(a.name)) })) };
}

// ---- routes ------------------------------------------------------------------------------------

/** kernel-phase15 AC-11: money FieldMeta.scale follows the caller's company currency. pack AC-5: packs[].applied per company. */
async function metaOptions(ctx: Context): Promise<MetaOptions> {
  const company = await findCompany(ctx);
  return company ? { currency: company.currency, appliedPacks: Object.keys(appliedPacksOf(company.settings)) } : {};
}

export function registerMetaRoutes(app: FastifyInstance, opts: { db: Database }): void {
  app.get(
    '/meta',
    {
      schema: {
        tags: ['meta'],
        summary: 'Entities, modules, menus, actions (with inputSchema/resultKind) and roles visible to the caller',
      },
    },
    async (req) =>
      withRequestContext(opts.db, req, async (ctx) => withActionSchemas(appMeta(ctx, await metaOptions(ctx)))),
  );

  app.get(
    '/meta/entities/:name',
    { schema: { tags: ['meta'], summary: 'Field/view/permission metadata of one entity', params: entityParams } },
    async (req) => {
      const { name } = parse(entityParams, req.params, 'params');
      if (!registry.hasEntity(name)) throw unknownEntity(name);
      return withRequestContext(opts.db, req, async (ctx) => {
        assertOp(ctx, registry.entity(name), 'read');
        return entityMeta(ctx, registry.entity(name), await metaOptions(ctx));
      });
    },
  );

  registerSettingsRoutes(app, { db: opts.db, toJsonSchema });
}
