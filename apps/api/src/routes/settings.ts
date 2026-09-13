// web-phase1 AC-5: company settings declared by modules (registry.registerSetting, ADR-0013 L1).
//   GET /meta/settings           -> [ { key, label, description?, schema (JSON Schema), value } ]
//   PUT /meta/settings/:key      body { value } -> the same shape for that key
// Both require admin or the `settings` role; values are validated by the module's zod schema (kernel setSetting).
import {
  DaifukuError,
  getCompany,
  isAdmin,
  PermissionDenied,
  registry,
  setSetting,
  type Context,
  type Database,
  type Label,
  type SettingDef,
} from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, withRequestContext } from '../request-context.ts';

/** Zod -> JSON Schema, supplied by meta.ts (which registers these routes) so the two files do not import each other. */
export type JsonSchemaFn = (schema: z.ZodType, io: 'input' | 'output') => Record<string, unknown> | undefined;

const keyParams = z.object({ key: z.string().min(1).max(200) });
const putBody = z.object({ value: z.unknown() });

export interface SettingOut {
  key: string;
  label: Label;
  description?: Label;
  schema: Record<string, unknown>;
  /** Current company value (null when unset or when the stored value no longer matches the schema). */
  value: unknown;
}

function unknownSetting(key: string): DaifukuError {
  return new DaifukuError(
    'NOT_FOUND',
    `setting "${key}" is not declared`,
    'List declared settings with GET /meta/settings.',
    { key },
    404,
  );
}

function assertSettingsRole(ctx: Context): void {
  if (ctx.accessScope === 'stores' || ctx.accessScope === 'sites')
    throw new PermissionDenied('company_settings', 'read', ctx.roles);
  if (!isAdmin(ctx) && !ctx.roles.includes('settings'))
    throw new PermissionDenied('company_settings', 'read', ctx.roles);
}

function toOut(def: SettingDef, stored: Record<string, unknown>, toJsonSchema: JsonSchemaFn): SettingOut {
  const raw = stored[def.key];
  const parsed = raw === undefined ? undefined : def.schema.safeParse(raw);
  const out: SettingOut = {
    key: def.key,
    label: def.label,
    schema: toJsonSchema(def.schema, 'input') ?? { type: 'object' },
    value: parsed?.success ? parsed.data : null,
  };
  if (def.description) out.description = def.description;
  return out;
}

export function registerSettingsRoutes(app: FastifyInstance, opts: { db: Database; toJsonSchema: JsonSchemaFn }): void {
  app.get(
    '/meta/settings',
    {
      schema: {
        tags: ['meta'],
        summary: 'Company settings declared by modules, with their JSON Schema and current value (admin/settings role)',
      },
    },
    async (req) =>
      withRequestContext(opts.db, req, async (ctx) => {
        assertSettingsRole(ctx);
        const company = await getCompany(ctx);
        return registry.allSettings().map((def) => toOut(def, company.settings, opts.toJsonSchema));
      }),
  );

  app.put(
    '/meta/settings/:key',
    {
      schema: {
        tags: ['meta'],
        summary: 'Set one company setting: body { value } validated by the declaring module (admin/settings role)',
        params: keyParams,
        body: putBody,
      },
    },
    async (req) => {
      const { key } = parse(keyParams, req.params, 'params');
      const { value } = parse(putBody, req.body, 'body');
      if (!registry.hasSetting(key)) throw unknownSetting(key);
      const def = registry.setting(key);
      return withRequestContext(opts.db, req, async (ctx) => {
        await setSetting(ctx, key, def.schema, value);
        return toOut(def, (await getCompany(ctx)).settings, opts.toJsonSchema);
      });
    },
  );
}
