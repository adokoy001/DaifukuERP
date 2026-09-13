import { contentHash } from '@daifuku/kernel';
import { stableJson } from '../services/json.ts';
import type { PayrollRuleBundle, PayrollRuleManifest } from './port.ts';

/** Content identities, not signatures. Database metadata is deliberately excluded. */
export function payloadHash(
  bundle: Pick<PayrollRuleBundle, 'code' | 'taxYear' | 'data' | 'sources' | 'verifiedOn'>,
): string {
  return contentHash(
    stableJson({
      code: bundle.code,
      taxYear: bundle.taxYear,
      data: bundle.data,
      sources: bundle.sources,
      verifiedOn: bundle.verifiedOn,
    }),
  );
}
export function manifestHash(manifest: PayrollRuleManifest): string {
  return contentHash(stableJson(manifest));
}
