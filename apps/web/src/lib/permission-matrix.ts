// Permission matrix screen helpers (docs/specs/access-insight.md AC-6, AC-7): the URL search, filters, the operation
// abbreviations and their full names, the role-only view, and the note badges. The matrix itself (entities, roles,
// grants, summaries) is derived by the kernel from the registry and drawn as received: no list is kept here.
import type { Label } from '../api/types.ts';

export type Op = 'read' | 'create' | 'update' | 'delete' | 'submit' | 'cancel' | 'amend' | 'export';
export const MATRIX_TABS = ['data', 'actions'] as const;
export type MatrixTab = (typeof MATRIX_TABS)[number];

export interface MatrixRole {
  name: string;
  label: Label;
  implicitAll: boolean;
}
export interface MatrixRowRule {
  roles: string[];
  where: unknown;
  summary: Label;
  self: boolean;
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
  allowedOps: Op[];
  sharedReadAnyRole: boolean;
  effective: Record<string, Op[]>;
}
export interface MatrixTransition {
  name: string;
  from: number;
  to: number;
  roles: string[] | null;
  guard: boolean;
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
  auditChanges: boolean;
  transitions: MatrixTransition[];
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
  runnable: string[];
}
export interface KernelCapability {
  id: string;
  label: Label;
  roles: string[];
  companyWide: boolean;
  tenantAdmin: boolean;
}
export interface PermissionMatrix {
  ops: Op[];
  roles: MatrixRole[];
  entities: MatrixEntity[];
  actions: MatrixAction[];
  packs: { name: string; label: Label; applied: boolean }[];
  kernel: KernelCapability[];
}

/** Short cell marks (legend shown on screen) and the full names read by assistive technology. */
export const OP_TEXT: Record<Op, { abbr: Label; name: Label }> = {
  read: { abbr: { ja: '閲', en: 'R' }, name: { ja: '閲覧', en: 'Read' } },
  create: { abbr: { ja: '作', en: 'C' }, name: { ja: '作成', en: 'Create' } },
  update: { abbr: { ja: '更', en: 'U' }, name: { ja: '更新', en: 'Update' } },
  delete: { abbr: { ja: '削', en: 'D' }, name: { ja: '削除', en: 'Delete' } },
  submit: { abbr: { ja: '確', en: 'S' }, name: { ja: '確定', en: 'Submit' } },
  cancel: { abbr: { ja: '取', en: 'X' }, name: { ja: '取消', en: 'Cancel' } },
  amend: { abbr: { ja: '改', en: 'A' }, name: { ja: '改訂', en: 'Amend' } },
  export: { abbr: { ja: '出', en: 'E' }, name: { ja: 'CSV 出力', en: 'Export' } },
};

export interface PermissionsSearch {
  tab: MatrixTab;
  module?: string | undefined;
  role?: string | undefined;
  q?: string | undefined;
  /** `all`: also show entities and actions of packs not applied to this company. */
  packs?: 'all' | undefined;
}
const NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** URL -> search: unknown or malformed values are dropped (the screen shows the default instead). */
export function parsePermissionsSearch(raw: Record<string, unknown>): PermissionsSearch {
  const out: PermissionsSearch = { tab: raw.tab === 'actions' ? 'actions' : 'data' };
  if (typeof raw.module === 'string' && NAME.test(raw.module)) out.module = raw.module;
  if (typeof raw.role === 'string' && NAME.test(raw.role)) out.role = raw.role;
  if (typeof raw.q === 'string' && raw.q.trim() && raw.q.length <= 100) out.q = raw.q;
  if (raw.packs === 'all') out.packs = 'all';
  return out;
}
/** Search -> URL object without defaults, so a plain /admin/permissions stays clean. */
export function permissionsSearchParams(search: PermissionsSearch): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...search, tab: search.tab === 'data' ? undefined : search.tab }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
    ),
  );
}

/** AC-7: the role shown alone — the one in the URL, else on a narrow screen the first role after admin. */
export function viewRole(search: PermissionsSearch, roles: readonly MatrixRole[], narrow: boolean): string | undefined {
  if (search.role && roles.some((r) => r.name === search.role)) return search.role;
  return narrow ? roles.find((r) => !r.implicitAll)?.name : undefined;
}

const matches = (q: string | undefined, label: Label, name: string) => {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  return [label.ja, label.en, name].some((text) => text.toLowerCase().includes(needle));
};

export function filterEntities(matrix: PermissionMatrix, search: PermissionsSearch): MatrixEntity[] {
  return matrix.entities.filter(
    (e) =>
      (search.packs === 'all' || e.applied) &&
      (!search.module || e.module === search.module) &&
      matches(search.q, e.label, e.name),
  );
}
export function filterActions(matrix: PermissionMatrix, search: PermissionsSearch): MatrixAction[] {
  return matrix.actions.filter(
    (a) =>
      (search.packs === 'all' || a.applied) &&
      (!search.module || a.module === search.module) &&
      matches(search.q, a.description, a.name),
  );
}

/** Modules (and packs) in first-appearance order, for the filter and the row groups. */
export function moduleOptions(matrix: PermissionMatrix, includeUnapplied: boolean): { name: string; label: Label }[] {
  const seen = new Map<string, Label>();
  for (const item of [...matrix.entities, ...matrix.actions]) {
    if (!item.module || (!includeUnapplied && !item.applied) || seen.has(item.module)) continue;
    seen.set(item.module, item.moduleLabel ?? { ja: item.module, en: item.module });
  }
  return [...seen].map(([name, label]) => ({ name, label }));
}
export function groupByModule<T extends { module: string | null; moduleLabel: Label | null }>(
  items: readonly T[],
): { module: string; label: Label; items: T[] }[] {
  const groups = new Map<string, { module: string; label: Label; items: T[] }>();
  for (const item of items) {
    const key = item.module ?? '';
    const group = groups.get(key) ?? {
      module: key,
      label: item.moduleLabel ?? { ja: key || 'その他', en: key || 'Other' },
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** A cell: abbreviations for the eye, full names for assistive technology; empty grants say so. */
export function cellText(ops: readonly Op[], locale: 'ja' | 'en'): { abbr: string; full: string } {
  if (!ops.length) return { abbr: '—', full: locale === 'ja' ? '権限なし' : 'No access' };
  return {
    abbr: ops.map((op) => OP_TEXT[op].abbr[locale]).join(locale === 'ja' ? '' : ' '),
    full: ops.map((op) => OP_TEXT[op].name[locale]).join(locale === 'ja' ? '、' : ', '),
  };
}

export type BadgeId =
  'self' | 'conditional' | 'fields' | 'stores' | 'sites' | 'relay' | 'noAudit' | 'unapplied' | 'tenant';
export const BADGE_TEXT: Record<BadgeId, { label: Label; tone: 'neutral' | 'accent' | 'warning' }> = {
  self: { label: { ja: '自分の行のみ', en: 'Own rows only' }, tone: 'accent' },
  conditional: { label: { ja: '条件付き', en: 'Conditional' }, tone: 'accent' },
  fields: { label: { ja: '項目の制限', en: 'Restricted fields' }, tone: 'neutral' },
  stores: { label: { ja: '店舗限定', en: 'Store-limited' }, tone: 'neutral' },
  sites: { label: { ja: '拠点限定', en: 'Site-limited' }, tone: 'neutral' },
  relay: { label: { ja: '店舗端末', en: 'Site device' }, tone: 'neutral' },
  noAudit: {
    label: { ja: '変更の監査なし（CSV 出力は記録）', en: 'Changes not audited (CSV exports are)' },
    tone: 'warning',
  },
  unapplied: { label: { ja: '未適用のパック', en: 'Pack not applied' }, tone: 'warning' },
  tenant: { label: { ja: 'テナント共通', en: 'Shared by the tenant' }, tone: 'neutral' },
};

/** Note badges of a row; with a role, row rules count only when they restrict that role. */
export function entityBadges(entity: MatrixEntity, role?: string): BadgeId[] {
  const rules = role ? entity.rowRules.filter((r) => r.roles.includes(role)) : entity.rowRules;
  const out: BadgeId[] = [];
  if (rules.some((r) => r.self)) out.push('self');
  if (rules.some((r) => !r.self)) out.push('conditional');
  if (entity.fieldGroups.some((g) => !role || !g.roles.includes(role))) out.push('fields');
  if (entity.stores.policy) out.push('stores');
  if (entity.sites.policy) out.push('sites');
  if (entity.relay && entity.relay.effective.length) out.push('relay');
  if (!entity.auditChanges) out.push('noAudit');
  if (!entity.applied) out.push('unapplied');
  if (entity.scope === 'tenant') out.push('tenant');
  return out;
}

/** AC-3(f): what the submit cell adds when plain submit runs a named transition (or is refused for several). */
export function submitNote(entity: MatrixEntity): Label | null {
  if (!entity.submitVia.length) return null;
  if (entity.submitVia.length === 1)
    return { ja: `${entity.submitVia[0]} 経由のみ`, en: `only via ${entity.submitVia[0]}` };
  const names = entity.submitVia.join(', ');
  return { ja: `通常の確定は不可（${names} を使う）`, en: `plain submit refused (use ${names})` };
}

export function permissionText(p: MatrixActionPermission, roles: readonly MatrixRole[]): Label {
  if (p.kind === 'authenticated') return { ja: 'ログインした利用者', en: 'Any signed-in user' };
  if (p.kind === 'roles') {
    const names = p.roles.map((name) => roles.find((r) => r.name === name)?.label ?? { ja: name, en: name });
    return {
      ja: `ロール: ${names.map((l) => l.ja).join('、')}`,
      en: `Roles: ${names.map((l) => l.en).join(', ')}`,
    };
  }
  const target = p.entityLabel ?? { ja: p.entity, en: p.entity };
  return { ja: `${target.ja}の${OP_TEXT[p.op].name.ja}`, en: `${OP_TEXT[p.op].name.en} on ${target.en}` };
}

/** AC-3a: kernel capabilities a role column carries even with no entity grant (e.g. `settings`). */
export function kernelCapabilitiesOf(matrix: PermissionMatrix, role: string): KernelCapability[] {
  return matrix.kernel.filter((c) => c.roles.includes(role));
}

export function policyText(policy: MatrixPolicy | null): Label {
  if (!policy) return { ja: '使えない（方針なし）', en: 'Not available (no policy)' };
  if (policy.kind === 'sharedRead') return { ja: '共有の閲覧（全ロール）', en: 'Shared reading (every role)' };
  if (policy.kind === 'store')
    return {
      ja: `担当の店舗・拠点の行（${policy.fieldLabel.ja}）`,
      en: `Rows of assigned stores or sites (${policy.fieldLabel.en})`,
    };
  return {
    ja: `見える${policy.entityLabel.ja}に属する行（${policy.field}）`,
    en: `Rows under a visible ${policy.entityLabel.en} (${policy.field})`,
  };
}
