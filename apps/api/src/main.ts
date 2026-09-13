// Entry point: `pnpm dev:api`. Validates environment before opening connections or listening.
import { configureStorage, connect, LocalStorage } from '@daifuku/kernel';
import { apiConfig, startupErrorMessage } from './config.ts';
import { packs, packWarnings } from './packs.ts';
import { readIdentityConfig, readSmtpConfig } from './identity/config.ts';
import { smtpTransport } from './identity/smtp.ts';
import { parseSquareConnections } from './adapters/square-pos.ts';
import { createReadiness } from './deployment/readiness.ts';
import { buildServer } from './server.ts';

async function main(): Promise<void> {
  const cfg = apiConfig();
  const squarePosConnections = parseSquareConnections(process.env.SQUARE_POS_CONNECTIONS_JSON);
  const identityConfig = readIdentityConfig(process.env);
  const smtp = readSmtpConfig(process.env);
  const identity = identityConfig
    ? { ...identityConfig, ...(smtp ? { mailTransport: smtpTransport(smtp) } : {}) }
    : undefined;
  const storageDirectory = process.env.DAIFUKU_STORAGE_DIR ?? '.data/storage';
  configureStorage(new LocalStorage(storageDirectory));
  const owner = connect(cfg.databaseUrlOwner, { max: 2 });
  const app = connect(cfg.databaseUrl, { max: 10 });
  const server = await buildServer({
    owner,
    app,
    jwtSecret: cfg.jwtSecret,
    trustedProxies: cfg.trustedProxies,
    readiness: createReadiness({ owner, app, storageDirectory }),
    corsOrigins: cfg.corsOrigins,
    squarePosConnections,
    ...(identity ? { identity } : {}),
    logger: true,
  });
  const shutdown = async () => {
    await server.close();
    await app.close();
    await owner.close();
  };
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
  server.log.info({ packs: packs.map((p) => p.name) }, 'packs loaded (DAIFUKU_PACKS)');
  for (const w of packWarnings) server.log.warn({ kind: w.kind }, w.message);
  await server.listen({ port: cfg.port, host: cfg.host });
}

main().catch((err: unknown) => {
  console.error(startupErrorMessage(err));
  process.exit(1);
});
