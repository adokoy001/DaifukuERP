import { applyPack, companies, newId, systemParams, withContext, type Database } from '@daifuku/kernel';
import { and, eq, inArray } from 'drizzle-orm';
import { modules } from '../modules.ts';
import { findDemoIdentity } from './demo-identity.ts';

export const INDUSTRY_DEMOS = [
  { pack: 'appliance_store', code: 'DEMO_APPLIANCE', name: '電器店サンプル｜あかり電器' },
  { pack: 'farm', code: 'DEMO_FARM', name: '農家サンプル｜ひなた農園' },
  { pack: 'restaurant_chain', code: 'DEMO_RESTAURANT', name: '飲食チェーンサンプル｜こもれび食堂' },
] as const;

export const INDUSTRY_DEMO_MARKER = 'demo.industry';

function assertDemoOwnership(company: { code: string; settings: unknown } | undefined, pack: string): void {
  if (!company) return;
  const settings = company.settings;
  const marker = typeof settings === 'object' && settings !== null && !Array.isArray(settings) ? (settings as Record<string, unknown>)[INDUSTRY_DEMO_MARKER] : undefined;
  if (marker !== pack) throw new Error(`Company ${company.code} is not an owned ${pack} demo. Existing company data will not be seeded.`);
}

/** Add isolated demo companies; never repurpose the user's default company or overwrite settings. */
export async function prepareIndustryDemoCompanies(owner: Database) {
  const demo = await findDemoIdentity(owner);
  if (!demo) throw new Error('An initialized Demo tenant is required. Prepare a separate demo database first.');
  // Refuse known collisions before creating or seeding any of the three companies.
  const existing = await owner.drizzle.select().from(companies).where(and(eq(companies.tenantId, demo.tenantId), inArray(companies.code, INDUSTRY_DEMOS.map((item) => item.code))));
  for (const item of INDUSTRY_DEMOS) assertDemoOwnership(existing.find((company) => company.code === item.code), item.pack);
  const out: { tenantId: string; companyId: string; pack: string; code: string; name: string }[] = [];
  for (const item of INDUSTRY_DEMOS) {
    await owner.drizzle.insert(companies).values({ id: newId(), tenantId: demo.tenantId, code: item.code, name: item.name, settings: { [INDUSTRY_DEMO_MARKER]: item.pack } }).onConflictDoNothing();
    const company = (await owner.drizzle.select().from(companies).where(and(eq(companies.tenantId, demo.tenantId), eq(companies.code, item.code))))[0];
    if (!company) throw new Error(`Unable to prepare ${item.code}`);
    assertDemoOwnership(company, item.pack);
    for (const module of modules) if (module.seed) await withContext(owner, systemParams(demo.tenantId, company.id), async (ctx) => { await module.seed?.(ctx); });
    out.push({ tenantId: demo.tenantId, companyId: company.id, pack: item.pack, code: company.code, name: company.name });
  }
  return out;
}

export async function seedIndustryDemos(owner: Database) {
  const prepared = await prepareIndustryDemoCompanies(owner);
  for (const item of prepared) await withContext(owner, systemParams(item.tenantId, item.companyId), (ctx) => applyPack(ctx, item.pack, { sample: true }));
  return prepared;
}
