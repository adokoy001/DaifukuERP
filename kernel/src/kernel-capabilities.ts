// Roles of the kernel's own capabilities (docs/specs/access-insight.md AC-3a). The same constants decide access in
// settings.ts, health.ts and audit-search.ts and build the "kernel capabilities" legend of the permission matrix, so the
// legend cannot drift from the checks.
import type { Context } from './context.ts';
import { PermissionDenied } from './errors.ts';
import { label, type Label } from './i18n.ts';

/** Company settings: change, delete and read their history (company-wide access only). */
export const SETTINGS_ROLES: readonly string[] = ['admin', 'settings'];
/** Setup health report (company-wide access only). */
export const HEALTH_ROLES: readonly string[] = SETTINGS_ROLES;
/** Permission matrix and the audit search (company-wide access only; human or agent-for-human actors). */
export const ACCESS_INSIGHT_ROLES: readonly string[] = ['admin'];

export function hasAnyRole(ctx: Pick<Context, 'roles'>, roles: readonly string[]): boolean {
  return roles.some((role) => ctx.roles.includes(role));
}

export interface KernelCapability {
  id: string;
  label: Label;
  /** Roles that grant it; empty when only the tenant administrator flag does. */
  roles: readonly string[];
  /** A store- or site-limited membership is refused even with the role. */
  companyWide: boolean;
  /** Needs `users.tenant_admin` (checked against the database on every call). */
  tenantAdmin: boolean;
}

export const KERNEL_CAPABILITIES: readonly KernelCapability[] = [
  {
    id: 'company_settings',
    label: label('会社設定の変更と変更履歴', 'Company settings and their history'),
    roles: SETTINGS_ROLES,
    companyWide: true,
    tenantAdmin: false,
  },
  {
    id: 'setup_health',
    label: label('導入チェック', 'Setup check'),
    roles: HEALTH_ROLES,
    companyWide: true,
    tenantAdmin: false,
  },
  {
    id: 'access_insight',
    label: label('権限マトリクスと監査ログの検索', 'Permission matrix and audit search'),
    roles: ACCESS_INSIGHT_ROLES,
    companyWide: true,
    tenantAdmin: false,
  },
  {
    id: 'access_admin',
    label: label(
      '利用者と権限・会社の管理（テナントの管理操作の監査を含む）',
      'Users, access and companies (and tenant audit)',
    ),
    roles: [],
    companyWide: true,
    tenantAdmin: true,
  },
];

/**
 * access-insight AC-5/AC-11: the permission matrix and the audit search are for an `admin` with company-wide access, as
 * a person (`user`) or an AI acting for that person with the person's own token (`agent` with `onBehalfOf`). Relay,
 * system and machine credentials (F2) are refused whatever their roles.
 */
export function assertAccessInsight(ctx: Pick<Context, 'roles' | 'accessScope' | 'actor'>): void {
  const humanActor = ctx.actor.type === 'user' || (ctx.actor.type === 'agent' && !!ctx.actor.onBehalfOf);
  if (!humanActor || (ctx.accessScope && ctx.accessScope !== 'all') || !hasAnyRole(ctx, ACCESS_INSIGHT_ROLES))
    throw new PermissionDenied('access_insight', 'read', ctx.roles);
}
