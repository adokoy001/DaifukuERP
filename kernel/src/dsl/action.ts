// defineAction (ADR-0009): one typed operation, exposed as REST and MCP by the apps.
import type { z } from 'zod';
import { registry } from '../registry.ts';
import type { ActionConfig, ActionDef, ActionPrintBinding } from './defs.ts';
export type { ActionConfig, ActionDef, ActionPermission, ActionPrintBinding, ActionPrintField } from './defs.ts';

const NAME_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
/** docs/specs/print-templates.md AC-1: the render action naming convention. */
export const PRINT_ACTION_RE = /^[a-z][a-z0-9_]*\.render_[a-z][a-z0-9_]*_html$/;

/** The input property names of a zod object schema; undefined when the input is not an object schema. */
function inputProperties(input: z.ZodType): string[] | undefined {
  const shape = (input as { shape?: unknown }).shape;
  return typeof shape === 'object' && shape !== null ? Object.keys(shape) : undefined;
}

/**
 * AC-1 definition-time checks of a print declaration (developer mistakes). Entity registration may come later, so the
 * entity name, `when` fields, the id property type and the read permission are checked by
 * apps/api/test/print-bindings.test.ts.
 */
function checkPrintBinding(cfg: ActionConfig<z.ZodType, z.ZodType>, print: ActionPrintBinding): void {
  const fail = (why: string) => {
    throw new Error(`action "${cfg.name}" print declaration: ${why} (docs/specs/print-templates.md AC-1)`);
  };
  if (!PRINT_ACTION_RE.test(cfg.name)) fail('the name must be "<module>.render_<document>_html"');
  if ((cfg.tx ?? 'required') !== 'none') fail("tx must be 'none'");
  if (cfg.mutates === true) fail('a render action must not mutate');
  if (cfg.internal === true) fail('an internal action never reaches /meta, so it cannot be printed');
  if (!print.entity) fail('entity is required');
  const idInput = print.idInput ?? 'id';
  const props = inputProperties(cfg.input);
  if (!props) fail('the input must be a zod object');
  if (!props?.includes(idInput)) fail(`the input has no "${idInput}" property`);
  for (const key of Object.keys(print.fields ?? {}))
    if (key === idInput || !props?.includes(key)) fail(`fields.${key} is not an extra input property`);
}

export function defineAction<I extends z.ZodType, O extends z.ZodType>(
  cfg: ActionConfig<I, O>,
  opts: { generic?: boolean } = {},
): ActionDef<I, O> {
  if (!NAME_RE.test(cfg.name))
    throw new Error(`action name "${cfg.name}" must look like "<module>.<verb_object>" in snake_case`);
  if (cfg.print) checkPrintBinding(cfg as unknown as ActionConfig<z.ZodType, z.ZodType>, cfg.print);
  const def: ActionDef<I, O> = {
    ...cfg,
    kind: 'action',
    tx: cfg.tx ?? 'required',
    mutates: cfg.mutates ?? (cfg.tx ?? 'required') === 'required',
    internal: cfg.internal ?? false,
    module: cfg.name.split('.')[0] ?? '',
    generic: opts.generic ?? false,
  };
  registry.registerAction(def as unknown as ActionDef);
  return def;
}

/** MCP tool name for an action (dots are not allowed in tool names). */
export function toolNameOf(action: string): string {
  return action.replace(/\./g, '_');
}
