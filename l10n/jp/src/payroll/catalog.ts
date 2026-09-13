import type { PayrollRuleBundle } from '@daifuku/mod-workforce';
import data from './bundles/2026-regular/data.json' with { type: 'json' };
import manifest from './bundles/2026-regular/manifest.json' with { type: 'json' };
import parameters from './bundles/2026-regular/parameters.json' with { type: 'json' };
import sources from './bundles/2026-regular/sources.json' with { type: 'json' };
import { payrollManifestSchema } from './schema.ts';

/** The distribution catalog contains only verified releases. Future years belong in test fixtures. */
export const JAPAN_PAYROLL_BUNDLES: readonly PayrollRuleBundle[] = [
  {
    code: data.code,
    taxYear: data.taxYear,
    verifiedOn: data.verifiedOn,
    data,
    sources,
    manifest: payrollManifestSchema.parse({ ...manifest, parameters }),
  },
];
