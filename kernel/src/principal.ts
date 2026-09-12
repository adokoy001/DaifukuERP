/** Authenticated identity and effective company authorization. Never sourced from client claims. */
export interface Principal {
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  roles: string[];
  defaultCompanyId: string | null;
  tenantAdmin: boolean;
  sessionVersion: number;
  mfaEnabled?: boolean;
  accessScope: 'all' | 'stores' | 'sites';
  storeIds: string[];
  siteIds: string[];
}
