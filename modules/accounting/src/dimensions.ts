import { registry } from '@daifuku/kernel';

/** A shared registered key is an explicit pack contract; unrelated source extension data is not copied. */
export function postingDimensions(sourceEntity: string, targetEntity: string, values: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const source = new Set(registry.extFields(sourceEntity).map((f) => f.key));
  const target = new Set(registry.extFields(targetEntity).map((f) => f.key));
  return Object.fromEntries(Object.entries(values ?? {}).filter(([key]) => source.has(key) && target.has(key)));
}
