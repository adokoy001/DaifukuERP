// Spec AC-6: a link target must be a registered entity and a record the caller may read (伝票⇔証憑リンク).
import { registry, repo, ValidationError, type Context } from '@daifuku/kernel';

export async function assertLinkTarget(ctx: Context, entity: string, recordId: string): Promise<void> {
  if (!registry.hasEntity(entity)) {
    throw new ValidationError(
      `entity "${entity}" does not exist`,
      [{ path: 'entity', message: 'unknown entity' }],
      'List entities with GET /meta and pass one of their names as `entity`.',
    );
  }
  // get() applies the target's own permissions and row visibility: NotFound when the caller may not see it.
  await repo(ctx, registry.entity(entity)).get(recordId);
}

/** linkedEntity and linkedId travel together. */
export function assertLinkPair(entity: unknown, recordId: unknown): void {
  const hasEntity = typeof entity === 'string';
  const hasId = typeof recordId === 'string';
  if (hasEntity !== hasId) {
    throw new ValidationError(
      'linkedEntity and linkedId must be given together',
      [{ path: hasEntity ? 'linkedId' : 'linkedEntity', message: 'missing' }],
      'Pass both linkedEntity and linkedId, or neither.',
    );
  }
}
