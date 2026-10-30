// stdio entrypoint (spec mcp-app AC-1). stdout is the MCP channel: all logging goes to stderr via consoleLogger.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { configureStorage, connect, consoleLogger, LocalStorage, safeErrorDiagnostics } from '@daifuku/kernel';
import { loadDotEnv, readConfig } from './config.ts';
import { loadModules } from './modules.ts';
import { buildMcpServer } from './server.ts';
import { openAgentSession, openMachineSession } from './session.ts';

const log = consoleLogger;

async function main(): Promise<void> {
  const envFile = loadDotEnv();
  const cfg = readConfig(process.env);
  if (!cfg.ok) {
    const conflicting = cfg.problem.conflicting ?? [];
    log.error(conflicting.length ? 'conflicting environment variables' : 'missing environment variables', {
      missing: cfg.problem.missing,
      conflicting,
      envFile: envFile ?? null,
      hint: conflicting.length
        ? 'Use either DAIFUKU_API_KEY or DAIFUKU_EMAIL / DAIFUKU_PASSWORD (with DAIFUKU_MFA_CODE / DAIFUKU_TENANT_ID), not both.'
        : 'Set DATABASE_URL_OWNER, DATABASE_URL and either DAIFUKU_API_KEY or DAIFUKU_EMAIL and DAIFUKU_PASSWORD (optional: DAIFUKU_AGENT_ID, DAIFUKU_COMPANY_ID).',
    });
    process.exit(2);
  }
  const { config } = cfg;
  const loaded = loadModules();

  configureStorage(new LocalStorage(process.env.DAIFUKU_STORAGE_DIR ?? '.data/storage'));
  const owner = connect(config.ownerUrl, { max: 1 });
  // An API key is validated in its tenant on the app connection, so open it before authenticating.
  const app = connect(config.appUrl, { max: 4 });
  const session = config.apiKey
    ? await openMachineSession(owner, app, config.apiKey, config.companyId, log)
    : await openAgentSession(owner, config, log);
  if (!session) {
    await Promise.all([app.close(), owner.close()]);
    log.error(
      'authentication failed',
      config.apiKey
        ? {
            hint: 'Check DAIFUKU_API_KEY: it must be an active, unexpired mcp key whose issuer is an active tenant administrator, and DAIFUKU_COMPANY_ID (if set) must be its company.',
          }
        : { email: config.email, hint: 'Check DAIFUKU_EMAIL / DAIFUKU_PASSWORD; the user must exist and be active.' },
    );
    process.exit(3);
  }

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
    ...('credential' in session
      ? { credentialId: session.credential.id, credentialName: session.credential.name }
      : { user: session.user.email, agentId: config.agentId }),
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
