// defineAction (ADR-0009): one typed operation, exposed as REST and MCP by the apps.
import type { z } from 'zod';
import { registry } from '../registry.ts';
import type { ActionConfig, ActionDef } from './defs.ts';
export type { ActionConfig, ActionDef, ActionPermission } from './defs.ts';

const NAME_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function defineAction<I extends z.ZodType, O extends z.ZodType>(cfg: ActionConfig<I, O>, opts: { generic?: boolean } = {}): ActionDef<I, O> {
  if (!NAME_RE.test(cfg.name)) throw new Error(`action name "${cfg.name}" must look like "<module>.<verb_object>" in snake_case`);
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
