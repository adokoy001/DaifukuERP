// stdio entrypoint (spec mcp-app AC-1). stdout is the MCP channel: all logging goes to stderr via consoleLogger.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { configureStorage, connect, consoleLogger, LocalStorage, safeErrorDiagnostics } from '@daifuku/kernel';
import { loadDotEnv, readConfig } from './config.ts';
import { loadModules } from './modules.ts';
import { buildMcpServer } from './server.ts';
import { openAgentSession } from './session.ts';

const log = consoleLogger;

async function main(): Promise<void> {
  const envFile = loadDotEnv();
  const cfg = readConfig(process.env);
  if (!cfg.ok) {
    log.error('missing environment variables', {
      missing: cfg.problem.missing,
      envFile: envFile ?? null,
      hint: 'Set DATABASE_URL_OWNER, DATABASE_URL, DAIFUKU_EMAIL and DAIFUKU_PASSWORD (optional: DAIFUKU_AGENT_ID, DAIFUKU_COMPANY_ID).',
    });
    process.exit(2);
  }
  const { config } = cfg;
  const loaded = loadModules();

  configureStorage(new LocalStorage(process.env.DAIFUKU_STORAGE_DIR ?? '.data/storage'));
  const owner = connect(config.ownerUrl, { max: 1 });
  const session = await openAgentSession(owner, config, log);
  if (!session) {
    await owner.close();
    log.error('authentication failed', {
      email: config.email,
      hint: 'Check DAIFUKU_EMAIL / DAIFUKU_PASSWORD; the user must exist and be active.',
    });
    process.exit(3);
  }

  const app = connect(config.appUrl, { max: 4 });
  const server = buildMcpServer({ app, owner, params: session.params, log });
  const transport = new StdioServerTransport();
  const shutdown = (): void => {
    void Promise.all([app.close(), owner.close()]).finally(() => process.exit(0));
  };
  server.onclose = shutdown;
  // The stdio transport does not watch for EOF; without this the process would outlive its client.
  process.stdin.on('end', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await server.connect(transport);
  log.info('daifuku mcp server ready', {
    user: session.user.email,
    agentId: config.agentId,
    companyId: session.params.companyId,
    roles: session.params.roles,
    ...loaded,
  });
}

main().catch((err: unknown) => {
  log.error('fatal', {
    ...safeErrorDiagnostics(err),
    hint: 'Check database connection, storage and account settings; sensitive details are not logged.',
  });
  process.exit(1);
});
