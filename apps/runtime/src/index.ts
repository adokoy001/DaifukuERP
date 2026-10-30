// One catalog for all adapters. Schema tools load all installed packs independently
// of the current runtime selection, preserving disabled packs' data.
import {
  ensureCompanyProfileSetting,
  ensureSetupProgressSetting,
  ensureIntegrationSettings,
  registerCrudActions,
  registerPackActions,
  registry,
} from '@daifuku/kernel';
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
  // Kernel-owned company setting (docs/specs/company-admin.md AC-6); modules read it, the settings console lists it.
  ensureCompanyProfileSetting();
  // The setup wizard's auxiliary record (docs/specs/setup-wizard.md AC-11); shown read-only in the console.
  ensureSetupProgressSetting();
  // Kernel-owned webhook endpoints and inbox mail switch (docs/specs/event-delivery.md AC-15).
  ensureIntegrationSettings();
  return { modules: businessModules, packs, warnings: registry.warnings() };
}
