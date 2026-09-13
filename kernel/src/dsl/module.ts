// defineModule: the manifest that ties entities, actions, hooks and seeds to a module (docs/conventions/layers.md).
import { registry } from '../registry.ts';
import type { ModuleConfig, ModuleDef } from './defs.ts';
export type { MenuItem, ModuleConfig, ModuleDef } from './defs.ts';

export function defineModule(cfg: ModuleConfig): ModuleDef {
  const def: ModuleDef = { ...cfg, kind: 'module' };
  for (const e of cfg.entities) {
    if (e.module && e.module !== cfg.name) throw new Error(`entity ${e.name} already belongs to module ${e.module}`);
    e.module = cfg.name;
  }
  for (const a of cfg.actions ?? []) {
    if (!a.name.startsWith(`${cfg.name}.`))
      throw new Error(`action ${a.name} must be prefixed with its module name "${cfg.name}."`);
    a.module = cfg.name;
  }
  registry.registerModule(def);
  cfg.hooks?.();
  return def;
}
