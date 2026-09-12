// Spec AC-4: POST /actions/:name. One route per registered action carries the action's zod schemas so
// /openapi.json documents it; validation itself happens in runAction (the kernel is the single validation
// point and reports field paths), so the per-route validator is a pass-through.
import { checkActionExport, registry, runAction, tableResult, type ActionDef, type Database } from '@daifuku/kernel';
import type { FastifyInstance, FastifySchemaCompiler } from 'fastify';
import { z } from 'zod';
import { assertExposedAction, callAction, parse, withRequestContext } from '../request-context.ts';

/** Accepts everything; runAction validates. */
export const passthroughValidator: FastifySchemaCompiler<unknown> = () => (value) => ({ value });

const nameParams = z.object({ name: z.string().min(1).max(200) });

function describe(action: ActionDef): string {
  const flags = [`tx: ${action.tx}`, action.mutates ? 'mutates data' : 'read-only', action.generic ? 'generic entity action' : 'module action'];
  return `${action.description.ja}\n\n${action.description.en}\n\n(${flags.join(', ')})`;
}

export function registerActionRoutes(app: FastifyInstance, opts: { db: Database }): void {
  app.post('/actions/:name/export', { schema: { tags: ['actions'], summary: 'Run a report with fresh export authorization' }, validatorCompiler: passthroughValidator }, async (req) => {
    const { name } = parse(nameParams, req.params, 'params');
    assertExposedAction(name);
    return withRequestContext(opts.db, req, async (ctx) => {
      if (registry.hasAction(name)) checkActionExport(ctx, registry.action(name));
      return tableResult.parse(await runAction(ctx, name, req.body));
    });
  });
  // internal actions (ADR-0014) get no route and no OpenAPI entry; the catch-all below answers 404 for them
  for (const action of registry.actions()) {
    app.post(
      `/actions/${action.name}`,
      {
        schema: {
          tags: [action.module],
          summary: action.description.en,
          description: describe(action),
          body: action.input,
          response: { 200: action.output },
        },
        validatorCompiler: passthroughValidator,
      },
      async (req) => callAction(opts.db, req, action.name, req.body),
    );
  }
  // Unknown names fall through to runAction, which answers 404 with a hint; internal ones are refused by callAction. Hidden from OpenAPI.
  app.post('/actions/:name', { schema: { hide: true }, validatorCompiler: passthroughValidator }, async (req) => {
    const { name } = parse(nameParams, req.params, 'params');
    return callAction(opts.db, req, name, req.body);
  });
}
