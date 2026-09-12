// Spec AC-4: `code` is unique per company. The DB unique index is the backstop; this hook turns the
// common case into a Conflict (409) with a hint instead of a raw constraint violation (docs/conventions/errors.md).
import { Conflict, registry, repo } from '@daifuku/kernel';
import { Partner } from '../entities/partner.ts';

export function registerUniqueCodeHook(): void {
  registry.registerHook('partner', 'before_create', async (ctx, { row }) => {
    const code = row.code;
    if (typeof code !== 'string' || code.length === 0) return;
    const n = await repo(ctx, Partner).count({ code });
    if (n > 0) {
      throw new Conflict(`partner code "${code}" already exists in this company`, 'Use a different code, or update the existing partner instead.', { field: 'code', code });
    }
  });
}
