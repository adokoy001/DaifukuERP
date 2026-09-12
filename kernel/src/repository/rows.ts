// Row conversion between DB representation and domain values (Decimal, masking, ext).
import { Decimal } from '../decimal.ts';
import type { EntityDef } from '../dsl/entity.ts';

/** DB -> domain: numeric strings become Decimal. Masked fields are removed. */
export function fromDb(entity: EntityDef, raw: Record<string, unknown>, masked: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (masked.has(k)) continue;
    const fd = entity.config.fields[k];
    if (fd?.kind === 'decimal' && typeof v === 'string') out[k] = Decimal.from(v);
    else out[k] = v;
  }
  if (entity.scope === 'tenant') out.companyId = null;
  return out;
}

/** domain -> DB: Decimal becomes its canonical string. */
export function toDb(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = v instanceof Decimal ? v.toString() : v;
  }
  return out;
}

/** JSON-safe snapshot for audit/before-after (Decimal -> string, Date -> ISO). */
export function snapshot(row: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    const same = a instanceof Decimal && b instanceof Decimal ? a.eq(b) : JSON.stringify(a) === JSON.stringify(b);
    if (!same) changed.push(k);
  }
  return changed;
}
