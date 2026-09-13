// One catalog for all adapters. Schema tools load all installed packs independently
// of the current runtime selection, preserving disabled packs' data.
import { registerCrudActions, registerPackActions, registry } from '@daifuku/kernel';
import { loadDotEnv } from './environment.ts';
import { loadPacks, selectedPackNames } from './packs.ts';

export { loadDotEnv } from './environment.ts';
export { selectedPackNames } from './packs.ts';

export async function loadRuntime(options: { schema?: boolean } = {}) {
  loadDotEnv();
  const { businessModules } = await import('./catalog.ts');
  const packs = await loadPacks(selectedPackNames(options.schema ? 'all' : process.env.DAIFUKU_PACKS));
  registerPackActions();
  registerCrudActions();
  return { modules: businessModules, packs, warnings: registry.warnings() };
}
