// Entry point: `pnpm dev:api`. Validates environment before opening connections or listening.
import { configureStorage, connect, LocalStorage } from '@daifuku/kernel';
import { apiConfig, startupErrorMessage } from './config.ts';
import { packs, packWarnings } from './packs.ts';
import { readIdentityConfig, readSmtpConfig } from './identity/config.ts';
import { smtpTransport } from './identity/smtp.ts';
import { parseSquareConnections } from './adapters/square-pos.ts';
import { createReadiness } from './deployment/readiness.ts';
import { buildServer } from './server.ts';
import { readEventWorkerConfig } from './events/config.ts';
import { startEventWorker, type EventWorker } from './events/worker.ts';

async function main(): Promise<void> {
  const cfg = apiConfig();
  const squarePosConnections = parseSquareConnections(process.env.SQUARE_POS_CONNECTIONS_JSON);
  const eventWorker = readEventWorkerConfig(process.env);
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
    storageDirectory,
    corsOrigins: cfg.corsOrigins,
    squarePosConnections,
    ...(identity ? { identity } : {}),
    eventWorker: { enabledHere: eventWorker.enabled },
    logger: true,
  });
  let worker: EventWorker | null = null;
  const shutdown = async () => {
    // AC-1: no new tick; the running one gets up to 15 s, then in-flight sends are aborted (leases expire, rows resend).
    await worker?.stop();
    await server.close();
    await app.close();
    await owner.close();
  };
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
  server.log.info({ packs: packs.map((p) => p.name) }, 'packs loaded (DAIFUKU_PACKS)');
  for (const w of packWarnings) server.log.warn({ kind: w.kind }, w.message);
  await server.listen({ port: cfg.port, host: cfg.host });
  if (eventWorker.enabled) {
    if (!identity)
      server.log.warn('event worker: IDENTITY_ENCRYPTION_KEY is not configured; this process does not send webhooks');
    worker = startEventWorker({
      owner,
      app,
      config: eventWorker,
      ...(identity
        ? {
            identity: {
              encryptionKey: identity.encryptionKey,
              webUrl: identity.webUrl,
              ...(identity.mailTransport ? { mailTransport: identity.mailTransport } : {}),
            },
          }
        : {}),
      log: {
        info: (msg, data) => server.log.info({ ...data }, msg),
        warn: (msg, data) => server.log.warn({ ...data }, msg),
        error: (msg, data) => server.log.error({ ...data }, msg),
      },
    });
    server.log.info({ intervalMs: eventWorker.intervalMs }, 'event delivery worker started (EVENT_WORKER_ENABLED)');
  }
}

main().catch((err: unknown) => {
  console.error(startupErrorMessage(err));
  process.exit(1);
});
