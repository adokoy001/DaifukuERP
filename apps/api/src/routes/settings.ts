// web-phase1 AC-5 / settings-console AC-4..AC-7: company settings declared by modules (registry.registerSetting,
// ADR-0013 L1) with their presentation (ADR-0027).
//   GET    /meta/settings              -> [ { key, label, description?, schema (JSON Schema), value, category, order?,
//                                            fields?, widget?, valueLabels?, defaultValue?, isDefault, managedBy? } ]
//   PUT    /meta/settings/:key         body { value } -> the same shape for that key
//   DELETE /meta/settings/:key         -> removes the stored value (back to the module default); the same shape
//   GET    /meta/settings/:key/audit   -> the latest 20 changes of that key, newest first
// All require admin or the `settings` role; values are validated by the module's zod schema (kernel setSetting).
import {
  DaifukuError,
  deleteSetting,
  getCompany,
  isAdmin,
  PermissionDenied,
  registry,
  setSetting,
  settingCategory,
  settingHistory,
  type Context,
  type Database,
  type Label,
  type SettingCategory,
  type SettingChange,
  type SettingDef,
  type SettingFieldDef,
  type SettingManagedBy,
  type SettingWidget,
} from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, withRequestContext } from '../request-context.ts';

/** Zod -> JSON Schema, supplied by meta.ts (which registers these routes) so the two files do not import each other. */
export type JsonSchemaFn = (schema: z.ZodType, io: 'input' | 'output') => Record<string, unknown> | undefined;

const keyParams = z.object({ key: z.string().min(1).max(200) });
const putBody = z.object({ value: z.unknown() });
const HISTORY_LIMIT = 20;

export interface SettingOut {
  key: string;
  label: Label;
  description?: Label;
  schema: Record<string, unknown>;
  /** Current company value (null when unset or when the stored value no longer matches the schema). */
  value: unknown;
  category: SettingCategory;
  order?: number;
  fields?: Readonly<Record<string, SettingFieldDef>>;
  widget?: SettingWidget;
  valueLabels?: Readonly<Record<string, Label>>;
  /** The module's fallback when the company has no value (only when the definition declares one). */
  defaultValue?: unknown;
  /** True when the company has no stored value (the module default applies). */
  isDefault: boolean;
  /** A dedicated screen keeps this setting (setup-wizard AC-12): the console links there instead of editing. */
  managedBy?: SettingManagedBy;
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

function declared(key: string): SettingDef {
  if (!registry.hasSetting(key)) throw unknownSetting(key);
  return registry.setting(key);
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
    category: settingCategory(def),
    isDefault: raw === undefined,
  };
  if (def.description) out.description = def.description;
  if (def.order !== undefined) out.order = def.order;
  if (def.fields) out.fields = def.fields;
  if (def.widget) out.widget = def.widget;
  if (def.valueLabels) out.valueLabels = def.valueLabels;
  if (def.default !== undefined) out.defaultValue = def.default;
  if (def.managedBy) out.managedBy = def.managedBy;
  return out;
}

export function registerSettingsRoutes(app: FastifyInstance, opts: { db: Database; toJsonSchema: JsonSchemaFn }): void {
  app.get(
    '/meta/settings',
    {
      schema: {
        tags: ['meta'],
        summary:
          'Company settings declared by modules, with JSON Schema, presentation, default and current value (admin/settings role)',
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
      const def = declared(key);
      return withRequestContext(opts.db, req, async (ctx) => {
        await setSetting(ctx, key, def.schema, value);
        return toOut(def, (await getCompany(ctx)).settings, opts.toJsonSchema);
      });
    },
  );

  app.delete(
    '/meta/settings/:key',
    {
      schema: {
        tags: ['meta'],
        summary:
          'Remove the company value of one setting so the module default applies again; audited (admin/settings role)',
        params: keyParams,
      },
    },
    async (req) => {
      const { key } = parse(keyParams, req.params, 'params');
      const def = declared(key);
      return withRequestContext(opts.db, req, async (ctx) => {
        await deleteSetting(ctx, key);
        return toOut(def, (await getCompany(ctx)).settings, opts.toJsonSchema);
      });
    },
  );

  app.get(
    '/meta/settings/:key/audit',
    {
      schema: {
        tags: ['meta'],
        summary: `The latest ${HISTORY_LIMIT} audited changes of one company setting, newest first (admin/settings role)`,
        params: keyParams,
      },
    },
    async (req) => {
      const { key } = parse(keyParams, req.params, 'params');
      declared(key);
      return withRequestContext(opts.db, req, async (ctx): Promise<SettingChange[]> =>
        settingHistory(ctx, key, HISTORY_LIMIT),
      );
    },
  );
}
