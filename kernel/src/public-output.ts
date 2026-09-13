// A public-output boundary, independent of ordinary role masks and UI-only hidden fields.
import type { EntityDef } from './dsl/defs.ts';
import { registry } from './registry.ts';

export function outputHiddenFields(entity: EntityDef): Set<string> {
  const fields = entity.fieldNames.filter((name) => entity.config.fields[name]?.opts.outputHidden);
  for (const ext of registry.extFields(entity.name)) if (ext.field.opts.outputHidden) fields.push(`ext.${ext.key}`);
  return new Set(fields);
}

/** Returns a copy; trusted repository rows and their domain types are not masked. */
export function publicOutput(entity: EntityDef, row: Record<string, unknown>): Record<string, unknown> {
  const hidden = outputHiddenFields(entity);
  const out = Object.fromEntries(Object.entries(row).filter(([key]) => !hidden.has(key)));
  if (out.ext && typeof out.ext === 'object' && !Array.isArray(out.ext))
    out.ext = Object.fromEntries(Object.entries(out.ext).filter(([key]) => !hidden.has(`ext.${key}`)));
  return out;
}
