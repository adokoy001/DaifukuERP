// Entry point: `pnpm dev:api`. Validates environment before opening connections or listening.
import { configureStorage, connect, LocalStorage } from '@daifuku/kernel';
import { apiConfig, startupErrorMessage } from './config.ts';
import { packs, packWarnings } from './packs.ts';
import { buildServer } from './server.ts';

async function main(): Promise<void> {
  const cfg = apiConfig();
  configureStorage(new LocalStorage(process.env.DAIFUKU_STORAGE_DIR ?? '.data/storage'));
  const owner = connect(cfg.databaseUrlOwner, { max: 2 });
  const app = connect(cfg.databaseUrl, { max: 10 });
  const server = await buildServer({ owner, app, jwtSecret: cfg.jwtSecret, corsOrigins: cfg.corsOrigins, logger: true });
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
