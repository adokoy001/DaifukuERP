// One MCP tool per registered action (ADR-0009): listing and invocation.
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { canRunAction, DaifukuError, newId, registry, runAction, toolNameOf, withContext, type ActionDef, type Context, type ContextParams, type Database, type ErrorBody, type Logger } from '@daifuku/kernel';
import { toolInputSchema } from './schema.ts';
import { refreshAgentContext } from './session.ts';

export interface ToolRuntime {
  /** App-role connection; every call runs inside its own transaction (RLS enforced). */
  app: Database;
  /** Restricted use: current principal and company membership lookup, as in REST auth. */
  owner: Database;
  /** Session identity; roles are refreshed before every invocation. */
  params: ContextParams;
  log: Logger;
}

export function toolOf(action: ActionDef, log: Logger): Tool {
  return {
    name: toolNameOf(action.name),
    description: `${action.description.en}\n${action.description.ja}\nmutates: ${action.mutates ? 'yes' : 'no'}`,
    inputSchema: toolInputSchema(action.name, action.input, log),
    annotations: { title: action.name, readOnlyHint: !action.mutates },
  };
}

/** AC-2: every exposed action, in registration order. `internal` actions (in-process only, ADR-0014) are not tools. */
export function listTools(log: Logger, ctx?: Context): Tool[] {
  return registry.actions().filter((a) => !ctx || canRunAction(ctx, a)).map((a) => toolOf(a, log));
}

/** Tool names are derived (`.` -> `_`), so resolve by comparing derived names rather than guessing the inverse. Internal actions do not resolve. */
export function findAction(toolName: string): ActionDef | undefined {
  return registry.actions().find((a) => toolNameOf(a.name) === toolName);
}

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** Errors go back as `isError` text carrying `{code,message,hint,details}` so the agent can self-correct (AC-3). */
export function errorResult(body: ErrorBody): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] };
}

export async function callTool(rt: ToolRuntime, toolName: string, args: Record<string, unknown> | undefined): Promise<CallToolResult> {
  const action = findAction(toolName);
  if (!action) {
    return errorResult({ code: 'NOT_FOUND', message: `tool "${toolName}" does not exist`, hint: 'List the available tools (tools/list) and use one of those names.', details: { tool: toolName } });
  }
  const requestId = newId();
  try {
    const params = await refreshAgentContext(rt.owner, rt.params);
    const result = await withContext(rt.app, { ...params, requestId }, (ctx) => runAction(ctx, action.name, args ?? {}));
    return textResult(result);
  } catch (err) {
    if (err instanceof DaifukuError) return errorResult(err.toBody());
    rt.log.error('tool call failed', { tool: toolName, action: action.name, requestId, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    return errorResult({
      code: 'INTERNAL',
      message: `tool "${toolName}" failed with an internal error`,
      hint: 'This is a server-side bug, not an input problem. Report the requestId in details to the operator; do not retry with the same input.',
      details: { requestId },
    });
  }
}
