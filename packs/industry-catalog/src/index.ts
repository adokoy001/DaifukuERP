import { definePack, label, type PackDef } from '@daifuku/kernel';
import { JapanModule } from '@daifuku/l10n-jp';
import { createJobEngine, IndustryOperationsModule } from '@daifuku/mod-industry-operations';
import { INDUSTRY_PROFILES } from './profiles.ts';
import { sampleIndustry } from './sample.ts';
import { seedIndustry } from './seed.ts';
export { INDUSTRY_PACK_NAMES, INDUSTRY_PROFILES } from './profiles.ts';
export { sampleReference, WHOLESALE_RECEIPT_NOTE } from './sample.ts';
export { productCode } from './seed.ts';
const loaded = new Map<string, PackDef>();
/** Register only the selected pack. Importing this package alone does not register ten unrelated entities. */
export function loadIndustryPack(name: string): PackDef {
  const existing = loaded.get(name);
  if (existing) return existing;
  const profile = INDUSTRY_PROFILES.find((item) => item.job.name === name);
  if (!profile) throw new Error(`Unknown industry pack: ${name}`);
  const engine = createJobEngine(profile.job);
  const index = INDUSTRY_PROFILES.indexOf(profile);
  const pack = definePack({
    name,
    label: profile.job.label,
    version: '0.1.0',
    depends: [IndustryOperationsModule.name, JapanModule.name],
    entities: [engine.Job],
    actions: engine.actions,
    hooks: engine.registerHooks,
    settings: { [`${name}.due_days`]: profile.job.dueDays },
    menus: [
      { label: profile.job.label, entity: engine.Job.name, order: 200 + index * 5 },
      { label: label('案件を開始', 'Start job'), route: `/a/${name}.start_job`, order: 201 + index * 5 },
      { label: label('履行を完了', 'Complete job'), route: `/a/${name}.complete_job`, order: 202 + index * 5 },
      { label: label('案件から請求', 'Invoice job'), route: `/a/${name}.invoice_job`, order: 203 + index * 5 },
      { label: label('履行実績', 'Fulfillment report'), route: `/r/${name}.job_summary`, order: 204 + index * 5 },
    ],
    seed: (ctx) => seedIndustry(ctx, profile),
    sample: (ctx) => sampleIndustry(ctx, profile, engine.Job),
  });
  loaded.set(name, pack);
  return pack;
}
