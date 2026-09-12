// ADR-0016: module-owned writes add field ownership, never role/row permission bypasses.
import type { Context } from './context.ts';
import { PermissionDenied } from './errors.ts';

export interface WriteCapability {
  readonly name: string;
  readonly entity: string;
  readonly fields: readonly string[];
  readonly operations: readonly string[];
}

const issued = new WeakSet<WriteCapability>();
const grants = new WeakMap<Context, readonly WriteCapability[]>();
const roots = new WeakMap<Context, Context>();

/** Keep the returned object private to the owning module; JSON input cannot forge its identity. */
export function defineWriteCapability(config: { name: string; entity: string; fields?: readonly string[]; operations?: readonly string[] }): WriteCapability {
  const capability = Object.freeze({ ...config, fields: Object.freeze([...(config.fields ?? [])]), operations: Object.freeze([...(config.operations ?? [])]) });
  issued.add(capability);
  return capability;
}

export function contextRoot(ctx: Context): Context {
  return roots.get(ctx) ?? ctx;
}

/** Preserve private authority and transaction bookkeeping when deriving a context (e.g. a savepoint). */
export function inheritContext(parent: Context, child: Context): Context {
  grants.set(child, grants.get(parent) ?? []);
  roots.set(child, contextRoot(parent));
  return child;
}

export async function withWriteCapability<T>(ctx: Context, capability: WriteCapability, work: (ctx: Context) => Promise<T>): Promise<T> {
  if (!issued.has(capability)) throw new PermissionDenied(capability.entity, 'invalid-capability', ctx.roles);
  const child = inheritContext(ctx, Object.create(Object.getPrototypeOf(ctx), Object.getOwnPropertyDescriptors(ctx)) as Context);
  grants.set(child, [...(grants.get(ctx) ?? []), capability]);
  return work(child);
}

export function hasWriteCapability(ctx: Context, entity: string, operation: string): boolean {
  return (grants.get(ctx) ?? []).some((c) => c.entity === entity && c.operations.includes(operation));
}

export function ownsField(ctx: Context, entity: string, field: string, operation?: string): boolean {
  return (grants.get(ctx) ?? []).some((c) => c.entity === entity && c.fields.includes(field) && (operation === undefined || c.operations.includes(operation)));
}
