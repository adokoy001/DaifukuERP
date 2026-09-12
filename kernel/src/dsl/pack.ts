// definePack (ADR-0015): one declaration bundling an industry/customer's differences — ext fields, small entities, actions,
// hooks, setting defaults, label overrides, menus, seed and sample data. Like defineModule it registers at import time, so
// migrations and /meta see everything the pack adds; company-level application (settings/seed/sample) is applyPack (../pack.ts).
import { Conflict, DependencyError, ValidationError, type ValidationIssue } from '../errors.ts';
import { registry } from '../registry.ts';
import type { PackConfig, PackDef } from './defs.ts';
import { checkExtFields, type ExtFieldDef } from './ext.ts';
import type { FieldMap } from './fields.ts';
export type { LabelOverride, PackConfig, PackDef } from './defs.ts';

const NAME_RE = /^[a-z][a-z0-9_]*$/;
/** `pack.apply` / `pack.list` are the kernel's generic actions; a pack named `pack` would own their prefix. */
const RESERVED_NAMES: ReadonlySet<string> = new Set(['pack']);
export const DEFAULT_PACK_VERSION = '0.0.0';

/** Ext source recorded for a pack's fields (EntityMeta.extFields[].source). */
export function packSource(name: string): string {
  return `pack:${name}`;
}

/** The pack itself, its depends, and everything those modules/packs depend on (transitively). */
function dependencyClosure(name: string, depends: readonly string[]): Set<string> {
  const seen = new Set<string>([name]);
  const queue = [...depends];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (seen.has(next)) continue;
    seen.add(next);
    const deps = registry.hasModule(next) ? registry.module(next).depends : (registry.pack(next)?.depends ?? []);
    queue.push(...deps);
  }
  return seen;
}

function shapeIssues(cfg: PackConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!NAME_RE.test(cfg.name)) issues.push({ path: 'name', message: `must be snake_case (${String(NAME_RE)})` });
  if (RESERVED_NAMES.has(cfg.name)) issues.push({ path: 'name', message: `"${cfg.name}" is reserved for the kernel's generic pack actions` });
  for (const a of cfg.actions ?? []) {
    if (!a.name.startsWith(`${cfg.name}.`)) issues.push({ path: `actions.${a.name}`, message: `must be prefixed with the pack name "${cfg.name}."` });
  }
  for (const [entity, o] of Object.entries(cfg.labels ?? {})) {
    if (!registry.hasEntity(entity)) continue; // reported as a dependency error
    const fields = registry.entity(entity).config.fields;
    for (const f of Object.keys(o.fields ?? {})) {
      if (!(f in fields)) issues.push({ path: `labels.${entity}.fields.${f}`, message: `${entity} has no field "${f}" (ext fields take their label from the ext definition)` });
    }
  }
  return issues;
}

/** Entities targeted by ext/labels must exist and belong to the pack or something it (transitively) depends on. */
function assertTargetsReachable(cfg: PackConfig): void {
  const closure = dependencyClosure(cfg.name, cfg.depends);
  const own = new Set((cfg.entities ?? []).map((e) => e.name));
  const targets = new Set([...Object.keys(cfg.ext ?? {}), ...Object.keys(cfg.labels ?? {})]);
  const problems: string[] = [];
  for (const name of targets) {
    if (!registry.hasEntity(name)) {
      problems.push(`entity "${name}" is not registered`);
      continue;
    }
    const owner = registry.entity(name).module;
    if (owner && !own.has(name) && !closure.has(owner)) problems.push(`entity "${name}" belongs to "${owner}", which is not in depends`);
  }
  if (problems.length > 0) {
    throw new DependencyError(`pack:${cfg.name}`, '', [], {
      message: `pack "${cfg.name}": ${problems.join('; ')}`,
      hint: `Import the module that defines each entity before the pack and list it (or a module/pack depending on it) in depends.`,
    });
  }
}

function assertOwnership(cfg: PackConfig): void {
  for (const e of cfg.entities ?? []) {
    if (e.module && e.module !== cfg.name) {
      throw new Conflict(`pack "${cfg.name}": entity ${e.name} already belongs to "${e.module}"`, 'List an entity in exactly one module or pack manifest.', { pack: cfg.name, entity: e.name });
    }
  }
}

/** All ext registrations checked against the current registry before any is applied (all-or-nothing across entities). */
function checkedExt(cfg: PackConfig): [string, FieldMap][] {
  const source = packSource(cfg.name);
  const entries = Object.entries(cfg.ext ?? {});
  for (const [entity, fields] of entries) {
    const existing = new Map<string, ExtFieldDef>(registry.extFields(entity).map((d) => [d.key, d]));
    checkExtFields(registry.entity(entity), fields, existing, source);
  }
  return entries;
}

/**
 * Validates and registers a pack. Nothing is registered unless every check passes:
 * bad name/action prefix/label field -> ValidationError; name taken, entity owned elsewhere, ext key or label already
 * registered -> Conflict; unregistered depends or target entity outside depends -> DependencyError.
 */
export function definePack(cfg: PackConfig): PackDef {
  const issues = shapeIssues(cfg);
  if (issues.length > 0) throw new ValidationError(`definePack(${cfg.name}): invalid pack definition`, issues, 'Fix the listed pack fields (docs/conventions/packs.md).');
  const def: PackDef = { ...cfg, kind: 'pack', version: cfg.version ?? DEFAULT_PACK_VERSION };
  const missing = registry.missingDependencies(cfg.depends);
  if (missing.length === 0) {
    assertTargetsReachable(cfg);
    assertOwnership(cfg);
  }
  const ext = missing.length === 0 ? checkedExt(cfg) : [];
  registry.registerPack(def); // re-checks name/depends/label conflicts before mutating
  const source = packSource(cfg.name);
  for (const [entity, fields] of ext) registry.registerExt(entity, fields, { source });
  for (const e of cfg.entities ?? []) e.module = cfg.name;
  for (const a of cfg.actions ?? []) a.module = cfg.name;
  if (cfg.hooks) registry.withRegistrationSource(source, cfg.hooks);
  return def;
}
