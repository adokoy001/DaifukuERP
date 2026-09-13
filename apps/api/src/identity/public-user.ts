import type { Principal } from '@daifuku/kernel';
export function publicUser(p: Principal) {
  return {
    id: p.userId,
    name: p.name,
    email: p.email,
    roles: p.roles,
    tenantId: p.tenantId,
    defaultCompanyId: p.defaultCompanyId,
    tenantAdmin: p.tenantAdmin,
    accessScope: p.accessScope,
    storeIds: p.storeIds,
    siteIds: p.siteIds,
  };
}
