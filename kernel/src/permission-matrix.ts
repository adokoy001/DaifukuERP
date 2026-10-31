// Permission matrix (docs/specs/access-insight.md AC-1..AC-5, ADR-0007 addendum): entity x role x operation DERIVED at
// run time from the registry's declarations (roles, row rules, field groups, store/site/relay policies, transitions,
// action permissions). There is no hand-written list of entities, roles or operations: the derivation applies the same
// rules as can() / canRunAction() / transitionDocument(), and the tests compare the two cell by cell.
import { availableRoles } from './access-admin-common.ts';
import type { Context } from './context.ts';
import type { ActionDef, EntityDef, LabelOverride, ModuleDef, PackDef } from './dsl/defs.ts';
import type { ExtFieldDef } from './dsl/ext.ts';
import { EXT_PREFIX } from './dsl/ext.ts';
import { DOCSTATUS, OPS, type Domain, type DomainCondition, type Op, type StoreAccessPolicy } from './dsl/types.ts';
import { label, type Label } from './i18n.ts';
import { assertAccessInsight, KERNEL_CAPABILITIES, type KernelCapability } from './kernel-capabilities.ts';
import { registry } from './registry.ts';
import { storePolicy } from './store-access.ts';

/** Operations of a non-document entity; submit/cancel/amend are registered for documents only (decision 11). */
const ENTITY_OPS: readonly Op[] = ['read', 'create', 'update', 'delete', 'export'];
/** What a store- or site-limited membership can never do (ADR-0018; store-access.ts storeAllows). */
const HEADQUARTERS_OPS: readonly Op[] = ['submit', 'cancel', 'amend'];
const ADMIN = 'admin';
const ADMIN_LABEL = label('管理者（すべての操作）', 'Administrator (every operation)');
const DOCSTATUS_TEXT: Record<number, Label> = {
  [DOCSTATUS.draft]: label('下書き', 'draft'),
  [DOCSTATUS.submitted]: label('確定', 'submitted'),
  [DOCSTATUS.cancelled]: label('取消', 'cancelled'),
};
const SELF_TOKENS = new Set(['$ctx.userId', '$ctx.actorId']);
const TOKEN_TEXT: Record<string, Label> = {
  '$ctx.userId': label('自分', 'yourself'),
  '$ctx.actorId': label('自分', 'yourself'),
  '$ctx.companyId': label('現在の会社', 'the current company'),
  '$ctx.tenantId': label('現在のテナント', 'the current tenant'),
};

export interface MatrixRole {
  name: string;
  label: Label;
  /** `admin`: every operation of every entity, implicitly (permissions.ts can()). */
  implicitAll: boolean;
}
export interface MatrixRowRule {
  roles: string[];
  where: Domain;
  summary: Label;
  /** A top-level conjunct pins a field to the caller (`$ctx.userId` / `$ctx.actorId`): "own rows only". */
  self: boolean;
  /** Per restricted role: its granted operations the rule narrows (every one except create; AC-3(a)). */
  restrictedOps: Record<string, Op[]>;
}
export interface MatrixFieldGroup {
  name: string;
  fields: { name: string; label: Label }[];
  roles: string[];
}
export type MatrixPolicy =
  | { kind: 'store'; field: string; fieldLabel: Label }
  | { kind: 'parent'; field: string; entity: string; entityLabel: Label }
  | { kind: 'sharedRead' };
export interface MatrixScopeNote {
  policy: MatrixPolicy | null;
  /** The most a limited membership may do on the entity, whatever its roles. */
  allowedOps: Op[];
  /** `sharedRead`: every role of a limited membership reads it. */
  sharedReadAnyRole: boolean;
  /** Role -> operations of a membership with only that role and this access scope. */
  effective: Record<string, Op[]>;
}
export interface MatrixTransition {
  name: string;
  from: number;
  to: number;
  roles: string[] | null;
  guard: boolean;
  /** Roles that pass transitionDocument: a transition role (or admin), `update`, and `submit`/`cancel` for the target. */
  runnableRoles: string[];
}
export interface MatrixEntity {
  name: string;
  label: Label;
  module: string | null;
  moduleLabel: Label | null;
  kind: 'entity' | 'document';
  scope: 'company' | 'tenant';
  pack: string | null;
  applied: boolean;
  ops: Op[];
  grants: Record<string, Op[]>;
  rowRules: MatrixRowRule[];
  fieldGroups: MatrixFieldGroup[];
  stores: MatrixScopeNote;
  sites: MatrixScopeNote;
  relay: { operations: Op[]; field: string; effective: Op[] } | null;
  /** false for `audit: 'none'`: changes are not audited (CSV exports still are). */
  auditChanges: boolean;
  transitions: MatrixTransition[];
  /** Named transitions to submitted: with one, plain submit runs it; with several, plain submit is refused. */
  submitVia: string[];
}
export type MatrixActionPermission =
  | { kind: 'authenticated' }
  | { kind: 'roles'; roles: string[] }
  | { kind: 'entity'; entity: string; op: Op; entityLabel: Label | null };
export interface MatrixAction {
  name: string;
  description: Label;
  module: string;
  moduleLabel: Label | null;
  pack: string | null;
  applied: boolean;
  mutates: boolean;
  permission: MatrixActionPermission;
  storeAccess: boolean;
  siteAccess: boolean;
  relayAccess: boolean;
  /** Roles that pass checkActionPermission with company-wide access and every pack applied. */
  runnable: string[];
}
export interface MatrixPack {
  name: string;
  label: Label;
  applied: boolean;
}
export interface PermissionMatrix {
  ops: Op[];
  roles: MatrixRole[];
  entities: MatrixEntity[];
  actions: MatrixAction[];
  packs: MatrixPack[];
  kernel: KernelCapability[];
}

export interface MatrixInput {
  entities: readonly EntityDef[];
  /** Exposed actions (internal ones left out by the caller). Generic CRUD actions are skipped here. */
  actions: readonly ActionDef[];
  modules: readonly ModuleDef[];
  packs: readonly PackDef[];
  /** Column roles: the roles user administration can assign (availableRoles()). */
  roles: readonly string[];
  appliedPacks: readonly string[];
  storePolicy: (entity: EntityDef) => StoreAccessPolicy | undefined;
  labelOverride?: (entity: string) => LabelOverride | undefined;
  extFields?: (entity: string) => readonly ExtFieldDef[];
}

function opsOf(entity: EntityDef): Op[] {
  return entity.kind === 'document' ? [...OPS] : [...ENTITY_OPS];
}
const ordered = (ops: Iterable<Op>): Op[] => {
  const set = new Set(ops);
  return OPS.filter((op) => set.has(op));
};

function fieldLabel(entity: EntityDef, name: string, input: Pick<MatrixInput, 'labelOverride' | 'extFields'>): Label {
  if (name === 'docstatus') return label('状態', 'Status');
  if (name.startsWith(EXT_PREFIX)) {
    const key = name.slice(EXT_PREFIX.length);
    const ext = input.extFields?.(entity.name).find((d) => d.key === key);
    return (ext?.field.opts.label as Label | undefined) ?? label(key, key);
  }
  const override = input.labelOverride?.(entity.name)?.fields?.[name];
  if (override) return override;
  return (entity.config.fields[name]?.opts.label as Label | undefined) ?? label(name, name);
}

function valueText(entity: EntityDef, field: string, value: unknown): Label {
  if (typeof value === 'string' && TOKEN_TEXT[value]) return TOKEN_TEXT[value];
  if (field === 'docstatus' && typeof value === 'number' && DOCSTATUS_TEXT[value]) return DOCSTATUS_TEXT[value];
  if (typeof value === 'boolean') return value ? label('はい', 'yes') : label('いいえ', 'no');
  const labels = (entity.config.fields[field]?.opts as { labels?: Record<string, Label> } | undefined)?.labels;
  if (typeof value === 'string' && labels?.[value]) return labels[value];
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return label(raw, raw);
}

type Lang = keyof Label;
const JOIN = { and: { ja: ' かつ ', en: ' and ' }, or: { ja: ' または ', en: ' or ' } } as const;

/** One operator of one field, or undefined for an operator the summary does not know. */
function conditionText(
  entity: EntityDef,
  field: string,
  cond: DomainCondition,
  f: Label,
  lang: Lang,
): string | undefined {
  const v = (value: unknown) => valueText(entity, field, value)[lang];
  if (cond === null) return lang === 'ja' ? `${f.ja}が空` : `${f.en} is empty`;
  if (typeof cond !== 'object') return `${f[lang]} = ${v(cond)}`;
  const entries = Object.entries(cond);
  if (entries.length === 0) return undefined;
  const parts: string[] = [];
  for (const [op, operand] of entries) {
    switch (op) {
      case '$ne':
        parts.push(
          operand === null
            ? lang === 'ja'
              ? `${f.ja}が空でない`
              : `${f.en} is not empty`
            : `${f[lang]} ≠ ${v(operand)}`,
        );
        break;
      case '$gt':
        parts.push(`${f[lang]} > ${v(operand)}`);
        break;
      case '$gte':
        parts.push(`${f[lang]} ≥ ${v(operand)}`);
        break;
      case '$lt':
        parts.push(`${f[lang]} < ${v(operand)}`);
        break;
      case '$lte':
        parts.push(`${f[lang]} ≤ ${v(operand)}`);
        break;
      case '$in': {
        if (!Array.isArray(operand)) return undefined;
        const list = operand
          .map((x) => (x === null ? (lang === 'ja' ? '空' : 'empty') : v(x)))
          .join(lang === 'ja' ? '、' : ', ');
        parts.push(lang === 'ja' ? `${f.ja}が次のいずれか: ${list}` : `${f.en} is one of: ${list}`);
        break;
      }
      case '$like':
        parts.push(lang === 'ja' ? `${f.ja}が「${String(operand)}」に一致` : `${f.en} matches "${String(operand)}"`);
        break;
      default:
        return undefined;
    }
  }
  return parts.join(JOIN.and[lang]);
}

function domainText(
  entity: EntityDef,
  where: Domain,
  lang: Lang,
  input: Pick<MatrixInput, 'labelOverride' | 'extFields'>,
): string | undefined {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) return undefined;
      const subs = (value as Domain[]).map((d) => domainText(entity, d, lang, input));
      if (subs.some((s) => s === undefined)) return undefined;
      if (subs.length === 0) {
        parts.push(
          key === '$or' ? (lang === 'ja' ? '（該当なし）' : '(nothing)') : lang === 'ja' ? '（すべて）' : '(all)',
        );
        continue;
      }
      const joined = subs.join(key === '$or' ? JOIN.or[lang] : JOIN.and[lang]);
      const [open, close] = lang === 'ja' ? ['（', '）'] : ['(', ')'];
      parts.push(subs.length > 1 ? `${open}${joined}${close}` : joined);
      continue;
    }
    if (key.startsWith('$') || Array.isArray(value)) return undefined;
    const text = conditionText(entity, key, value as DomainCondition, fieldLabel(entity, key, input), lang);
    if (text === undefined) return undefined;
    parts.push(text);
  }
  if (parts.length === 0) return lang === 'ja' ? '（すべて）' : '(all)';
  return parts.join(JOIN.and[lang]);
}

/**
 * AC-3(a): a Japanese and English sentence for a row rule's `where` (field and enum labels, `$ctx` tokens as words,
 * docstatus as state names). An operator the summary does not know falls back to the raw `where` JSON.
 */
export function describeRowRule(
  entity: EntityDef,
  where: Domain,
  input: Pick<MatrixInput, 'labelOverride' | 'extFields'> = {},
): Label {
  const ja = domainText(entity, where, 'ja', input);
  const en = domainText(entity, where, 'en', input);
  if (ja === undefined || en === undefined) {
    const raw = JSON.stringify(where);
    return label(raw, raw);
  }
  return label(ja, en);
}

/** AC-3(a): "own rows only" only when a top-level AND conjunct pins a field to the caller (equality or a token-only $in). */
export function isSelfRule(where: Domain): boolean {
  return Object.entries(where).some(([key, value]) => {
    if (key.startsWith('$')) return false;
    if (typeof value === 'string') return SELF_TOKENS.has(value);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = Object.entries(value);
    if (entries.length !== 1 || entries[0]?.[0] !== '$in') return false;
    const list = entries[0][1];
    return Array.isArray(list) && list.length > 0 && list.every((x) => typeof x === 'string' && SELF_TOKENS.has(x));
  });
}

function policyNote(
  policy: StoreAccessPolicy | undefined,
  entity: EntityDef,
  ops: readonly Op[],
  grants: Record<string, Op[]>,
  roles: readonly string[],
  byName: Map<string, EntityDef>,
  input: MatrixInput,
): MatrixScopeNote {
  const allowedOps = !policy
    ? []
    : policy.kind === 'sharedRead'
      ? ops.filter((op) => op === 'read' || op === 'export')
      : ops.filter((op) => !HEADQUARTERS_OPS.includes(op));
  const sharedReadAnyRole = policy?.kind === 'sharedRead';
  const effective: Record<string, Op[]> = {};
  for (const role of roles) {
    const granted = role === ADMIN ? allowedOps : (grants[role] ?? []).filter((op) => allowedOps.includes(op));
    effective[role] = ordered([...granted, ...(sharedReadAnyRole && ops.includes('read') ? (['read'] as Op[]) : [])]);
  }
  let note: MatrixPolicy | null = null;
  if (policy?.kind === 'store')
    note = { kind: 'store', field: policy.field, fieldLabel: fieldLabel(entity, policy.field, input) };
  else if (policy?.kind === 'parent') {
    const parent = byName.get(policy.entity);
    note = {
      kind: 'parent',
      field: policy.field,
      entity: policy.entity,
      entityLabel:
        input.labelOverride?.(policy.entity)?.entity ?? parent?.config.label ?? label(policy.entity, policy.entity),
    };
  } else if (policy?.kind === 'sharedRead') note = { kind: 'sharedRead' };
  return { policy: note, allowedOps, sharedReadAnyRole, effective };
}

function roleLabels(input: MatrixInput): Map<string, Label> {
  const labels = new Map<string, Label>([[ADMIN, ADMIN_LABEL]]);
  for (const owner of [...input.modules, ...input.packs])
    for (const [role, l] of Object.entries(owner.roles ?? {})) if (!labels.has(role)) labels.set(role, l);
  return labels;
}

function ownerLabel(name: string | undefined, input: MatrixInput): Label | null {
  if (!name) return null;
  return input.modules.find((m) => m.name === name)?.label ?? input.packs.find((p) => p.name === name)?.label ?? null;
}

function deriveEntity(
  entity: EntityDef,
  roles: readonly string[],
  byName: Map<string, EntityDef>,
  packNames: Set<string>,
  input: MatrixInput,
): MatrixEntity {
  const ops = opsOf(entity);
  const declared = entity.config.permissions.roles;
  const grants: Record<string, Op[]> = {};
  for (const role of roles) grants[role] = role === ADMIN ? [...ops] : ops.filter((op) => declared[role]?.includes(op));
  const pack = entity.module && packNames.has(entity.module) ? entity.module : null;
  const rowRules: MatrixRowRule[] = (entity.config.permissions.rowRules ?? []).map((rule) => ({
    roles: [...rule.roles],
    where: rule.where,
    summary: describeRowRule(entity, rule.where, input),
    self: isSelfRule(rule.where),
    restrictedOps: Object.fromEntries(
      rule.roles.map((role) => [role, ops.filter((op) => op !== 'create' && declared[role]?.includes(op))]),
    ),
  }));
  const fieldGroups = Object.entries(entity.config.permissions.fieldGroups ?? {}).map(([name, group]) => ({
    name,
    fields: group.fields.map((f) => ({ name: f, label: fieldLabel(entity, f, input) })),
    roles: [...group.roles],
  }));
  const store = input.storePolicy(entity);
  const relayAccess = entity.config.relayAccess;
  const transitions = Object.entries(entity.doc?.transitions ?? {}).map(([name, t]) => {
    const target: Op | null = t.to === DOCSTATUS.submitted ? 'submit' : t.to === DOCSTATUS.cancelled ? 'cancel' : null;
    return {
      name,
      from: t.from,
      to: t.to,
      roles: t.roles ? [...t.roles] : null,
      guard: !!t.guard,
      runnableRoles: target
        ? roles.filter(
            (role) =>
              role === ADMIN ||
              ((!t.roles || t.roles.includes(role)) &&
                (grants[role] ?? []).includes('update') &&
                (grants[role] ?? []).includes(target)),
          )
        : [],
    };
  });
  return {
    name: entity.name,
    label: input.labelOverride?.(entity.name)?.entity ?? entity.config.label,
    module: entity.module ?? null,
    moduleLabel: ownerLabel(entity.module, input),
    kind: entity.kind,
    scope: entity.scope,
    pack,
    applied: !pack || input.appliedPacks.includes(pack),
    ops,
    grants,
    rowRules,
    fieldGroups,
    stores: policyNote(store, entity, ops, grants, roles, byName, input),
    sites: policyNote(entity.config.siteAccess ?? store, entity, ops, grants, roles, byName, input),
    relay: relayAccess
      ? {
          operations: ordered(relayAccess.operations.filter((op) => ops.includes(op))),
          field: relayAccess.field,
          effective: ordered(relayAccess.operations.filter((op) => ops.includes(op) && declared.relay?.includes(op))),
        }
      : null,
    auditChanges: entity.audit !== 'none',
    transitions,
    submitVia: transitions.filter((t) => t.to === DOCSTATUS.submitted).map((t) => t.name),
  };
}

function deriveAction(
  action: ActionDef,
  roles: readonly string[],
  byName: Map<string, EntityDef>,
  packNames: Set<string>,
  input: MatrixInput,
): MatrixAction {
  const p = action.permission;
  const target = p !== 'authenticated' && 'entity' in p ? byName.get(p.entity) : undefined;
  const permission: MatrixActionPermission =
    p === 'authenticated'
      ? { kind: 'authenticated' }
      : 'entity' in p
        ? {
            kind: 'entity',
            entity: p.entity,
            op: p.op,
            entityLabel: target ? (input.labelOverride?.(p.entity)?.entity ?? target.config.label) : null,
          }
        : { kind: 'roles', roles: [...p.roles] };
  const runnable = roles.filter((role) => {
    if (role === ADMIN) return permission.kind !== 'entity' || !!target;
    if (permission.kind === 'authenticated') return true;
    if (permission.kind === 'roles') return permission.roles.includes(role);
    return !!target && !!target.config.permissions.roles[role]?.includes(permission.op);
  });
  const pack = packNames.has(action.module) ? action.module : null;
  const targetPack = target?.module && packNames.has(target.module) ? target.module : null;
  return {
    name: action.name,
    description: action.description,
    module: action.module,
    moduleLabel: ownerLabel(action.module, input),
    pack,
    applied: [pack, targetPack].every((name) => !name || input.appliedPacks.includes(name)),
    mutates: action.mutates,
    permission,
    storeAccess: action.storeAccess === true,
    siteAccess: action.siteAccess === true,
    relayAccess: action.relayAccess === true,
    runnable,
  };
}

/** Pure derivation (AC-1..AC-4): the caller supplies the registry contents, so tests can pass a registry of their own. */
export function derivePermissionMatrix(input: MatrixInput): PermissionMatrix {
  const roleNames = [ADMIN, ...[...new Set(input.roles)].filter((r) => r !== ADMIN).sort()];
  const labels = roleLabels(input);
  const byName = new Map(input.entities.map((e) => [e.name, e]));
  const packNames = new Set(input.packs.map((p) => p.name));
  return {
    ops: [...OPS],
    roles: roleNames.map((name) => ({
      name,
      label: labels.get(name) ?? label(name, name),
      implicitAll: name === ADMIN,
    })),
    entities: input.entities.map((e) => deriveEntity(e, roleNames, byName, packNames, input)),
    actions: input.actions
      .filter((a) => !a.generic && !a.internal)
      .map((a) => deriveAction(a, roleNames, byName, packNames, input)),
    packs: input.packs.map((p) => ({ name: p.name, label: p.label, applied: input.appliedPacks.includes(p.name) })),
    kernel: KERNEL_CAPABILITIES.map((c) => ({ ...c, roles: [...c.roles] })),
  };
}

/** GET /admin/permissions: the matrix of the running registry for an admin with company-wide access (AC-5). */
export function permissionMatrix(ctx: Context): PermissionMatrix {
  assertAccessInsight(ctx);
  const appliedPacks = ctx.appliedPacks ?? [];
  return derivePermissionMatrix({
    entities: registry.allEntities(),
    actions: registry.actions(),
    modules: registry.allModules(),
    packs: registry.packs(),
    roles: availableRoles(),
    appliedPacks,
    storePolicy,
    labelOverride: (entity) => registry.labelOverrides(entity, appliedPacks),
    extFields: (entity) => registry.extFields(entity),
  });
}
