// Bridges a Fastify request to a kernel Context: one transaction per request, tenant set for RLS (ADR-0004).
import {
  DaifukuError,
  registry,
  runAction,
  ValidationError,
  withContext,
  type Context,
  type Database,
} from '@daifuku/kernel';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';

/** Parses request parts with a zod schema; failures become the standard VALIDATION error (400). */
export function parse<T extends z.ZodType>(schema: T, value: unknown, part: string): z.output<T> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => ({ path: [part, ...i.path.map(String)].join('.'), message: i.message }));
  throw new ValidationError(`invalid ${part}`, issues);
}

export function withRequestContext<T>(db: Database, req: FastifyRequest, fn: (ctx: Context) => Promise<T>): Promise<T> {
  return withContext(db, req.contextParams(), fn);
}

/** `internal: true` actions run in-process only (ADR-0014): over HTTP they answer like an unknown action. */
export function assertExposedAction(name: string): void {
  if (!registry.hasAction(name) || !registry.action(name).internal) return;
  throw new DaifukuError(
    'NOT_FOUND',
    `action "${name}" is not available over the API`,
    'It is an internal action, called in-process by other modules (e.g. the payment module). List available actions with GET /meta.',
    { action: name },
    404,
  );
}

export async function callAction(db: Database, req: FastifyRequest, name: string, input: unknown): Promise<unknown> {
  assertExposedAction(name);
  return withRequestContext(db, req, (ctx) => runAction(ctx, name, input));
}
