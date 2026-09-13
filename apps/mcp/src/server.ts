// Builds the MCP server: tools from the action registry, resources from the metadata (ADR-0009, spec mcp-app).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { consoleLogger, withContext, type ContextParams, type Database, type Logger } from '@daifuku/kernel';
import { listResources, listResourceTemplates, readResource, META_URI } from './resources.ts';
import { callTool, listTools } from './tools.ts';
import { refreshAgentContext } from './session.ts';
import { withProtocolErrors } from './errors.ts';

export const SERVER_INFO = { name: 'daifuku', version: '0.0.1' } as const;

const INSTRUCTIONS = [
  'Daifuku ERP. Each tool is one business action; the name is <module>_<verb_object> (the REST name with "." replaced by "_").',
  `Read ${META_URI} first: it lists entities, their fields and the operations your roles allow.`,
  'Money and quantities are decimal strings ("1234.50"), business dates are "YYYY-MM-DD".',
  'Errors come back as JSON {code, message, hint, details}: follow the hint before retrying.',
].join('\n');

export interface McpServerOptions {
  /** App-role connection (RLS enforced). Never the owner connection. */
  app: Database;
  owner: Database;
  /** Resolved at startup: tenant, company, agent actor with onBehalfOf, roles (AC-1). */
  params: ContextParams;
  log?: Logger;
}

export function buildMcpServer(opts: McpServerOptions): Server {
  const log = opts.log ?? opts.params.log ?? consoleLogger;
  const rt = { app: opts.app, owner: opts.owner, params: opts.params, log };
  const server = new Server(SERVER_INFO, { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () =>
    withProtocolErrors(log, 'tools/list', async () => {
      const params = await refreshAgentContext(opts.owner, opts.params);
      return withContext(opts.app, params, async (ctx) => ({ tools: listTools(log, ctx) }));
    }),
  );
  server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(rt, req.params.name, req.params.arguments));
  server.setRequestHandler(ListResourcesRequestSchema, async () =>
    withProtocolErrors(log, 'resources/list', async () => {
      const params = await refreshAgentContext(opts.owner, opts.params);
      return withContext(opts.app, params, async (ctx) => ({ resources: listResources(ctx) }));
    }),
  );
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () =>
    withProtocolErrors(log, 'resources/templates/list', async () => {
      await refreshAgentContext(opts.owner, opts.params);
      return { resourceTemplates: listResourceTemplates() };
    }),
  );
  server.setRequestHandler(ReadResourceRequestSchema, async (req) =>
    withProtocolErrors(log, 'resources/read', () => readResource(rt, req.params.uri)),
  );
  return server;
}
