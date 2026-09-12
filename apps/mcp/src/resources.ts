// MCP resources (AC-4): daifuku://meta (appMeta) and daifuku://entities/{name} (entityMeta).
import { ErrorCode, McpError, type ReadResourceResult, type Resource, type ResourceTemplate } from '@modelcontextprotocol/sdk/types.js';
import { appliedPacksOf, appMeta, assertOp, can, entityMeta, findCompany, registry, withContext, type Context, type ContextParams, type Database, type MetaOptions } from '@daifuku/kernel';
import { refreshAgentContext } from './session.ts';

export const META_URI = 'daifuku://meta';
export const ENTITY_URI_PREFIX = 'daifuku://entities/';
const JSON_MIME = 'application/json';

export interface ResourceRuntime {
  app: Database;
  owner: Database;
  params: ContextParams;
}

export function entityUri(name: string): string {
  return `${ENTITY_URI_PREFIX}${name}`;
}

export function listResources(ctx?: Context): Resource[] {
  const meta: Resource = {
    uri: META_URI,
    name: 'meta',
    title: 'Daifuku metadata',
    description: 'Entities (with fields, views and the operations you may perform), modules, menus, actions and your roles. Read this first.',
    mimeType: JSON_MIME,
  };
  const entities = registry.allEntities().filter((e) => !ctx || can(ctx, e, 'read')).map(
    (e): Resource => ({
      uri: entityUri(e.name),
      name: e.name,
      title: `${e.config.label.en} / ${e.config.label.ja}`,
      description: `Field definitions, views and permitted operations for entity "${e.name}".`,
      mimeType: JSON_MIME,
    }),
  );
  return [meta, ...entities];
}

export function listResourceTemplates(): ResourceTemplate[] {
  return [
    {
      uriTemplate: `${ENTITY_URI_PREFIX}{name}`,
      name: 'entity',
      title: 'Entity metadata',
      description: 'Metadata for one entity by its snake_case name (see daifuku://meta for the list).',
      mimeType: JSON_MIME,
    },
  ];
}

function jsonContents(uri: string, value: unknown): ReadResourceResult {
  return { contents: [{ uri, mimeType: JSON_MIME, text: JSON.stringify(value, null, 2) }] };
}

export async function readResource(rt: ResourceRuntime, uri: string): Promise<ReadResourceResult> {
  const params = await refreshAgentContext(rt.owner, rt.params);
  if (uri === META_URI) {
    return jsonContents(uri, await withContext(rt.app, params, async (ctx) => appMeta(ctx, await metaOptions(ctx))));
  }
  if (uri.startsWith(ENTITY_URI_PREFIX)) {
    const name = uri.slice(ENTITY_URI_PREFIX.length);
    if (!registry.hasEntity(name)) {
      throw new McpError(ErrorCode.InvalidParams, `entity "${name}" does not exist`, { code: 'NOT_FOUND', hint: `Read ${META_URI} for the list of entity names.` });
    }
    const entity = registry.entity(name);
    return jsonContents(uri, await withContext(rt.app, params, async (ctx) => { assertOp(ctx, entity, 'read'); return entityMeta(ctx, entity, await metaOptions(ctx)); }));
  }
  throw new McpError(ErrorCode.InvalidParams, `resource "${uri}" does not exist`, { code: 'NOT_FOUND', hint: `Use ${META_URI} or ${ENTITY_URI_PREFIX}{name}.` });
}

async function metaOptions(ctx: Context): Promise<MetaOptions> {
  const company = await findCompany(ctx);
  return company ? { currency: company.currency, appliedPacks: Object.keys(appliedPacksOf(company.settings)) } : {};
}
