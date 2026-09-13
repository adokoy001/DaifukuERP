// Demo tenant bootstrap and module seeds (spec AC-9 `reset`). Runs in the system context: seeds only (ADR-0007).
import { bootstrapTenant, newId, systemParams, withContext, type Database } from '@daifuku/kernel';
import { modules } from '../modules.ts';
import { DEMO_TENANT, findDemoIdentity } from './demo-identity.ts';
export { DEMO_TENANT } from './demo-identity.ts';

export interface SeedResult {
  tenantId: string;
  companyId: string;
  userId: string;
  seededModules: string[];
}

/** Reuses only the exact demo identity, then runs idempotent module seeds. */
export async function seedAll(owner: Database): Promise<SeedResult> {
  const boot = (await findDemoIdentity(owner)) ?? (await bootstrapTenant(owner, { ...DEMO_TENANT, tenantId: newId() }));
  const seededModules: string[] = [];
  for (const m of modules) {
    if (!m.seed) continue;
    await withContext(owner, systemParams(boot.tenantId, boot.companyId), async (ctx) => m.seed?.(ctx));
    seededModules.push(m.name);
  }
  return { ...boot, seededModules };
}
