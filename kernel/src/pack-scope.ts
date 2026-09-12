// Runtime activation is company-scoped; registration and physical schemas remain deployment-wide.
import type { Context } from './context.ts';
import { inheritContext } from './write-capability.ts';

export function packIsActive(ctx: Pick<Context, 'appliedPacks'>, source: string): boolean {
  return !source.startsWith('pack:') || (ctx.appliedPacks ?? []).includes(source.slice(5));
}

/** Only applyPack uses this temporary activation while running the pack's transactional seed/sample. */
export function packApplicationContext(ctx: Context, name: string): Context {
  const child = Object.create(Object.getPrototypeOf(ctx), Object.getOwnPropertyDescriptors(ctx)) as Context;
  Object.defineProperty(child, 'appliedPacks', { value: [...new Set([...(ctx.appliedPacks ?? []), name])], enumerable: true, configurable: true });
  return inheritContext(ctx, child);
}

export function refreshPackScope(ctx: Context, names: readonly string[]): void {
  Object.defineProperty(ctx, 'appliedPacks', { value: [...names], enumerable: true, configurable: true });
}

export function appliedPackNames(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object') return [];
  const packs = (settings as Record<string, unknown>)['packs.applied'];
  return packs && typeof packs === 'object' && !Array.isArray(packs) ? Object.keys(packs) : [];
}
