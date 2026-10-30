// One delivery tick for deployments that run the worker from a scheduler (docs/specs/event-delivery.md AC-3):
// `pnpm --filter @daifuku/api events:deliver`, or `node dist/events/cli.js` in a release. Prints counts only (no
// destination, URL, body or error text). Exit code 1 when a tenant failed, 2 when due rows could not be sent because this
// process lacks IDENTITY_ENCRYPTION_KEY or SMTP, otherwise 0. The process loads the same runtime as the API (modules,
// selected packs, kernel settings) before the tick, so internal subscribers run and inbox checks see every
// `<module>.todo` provider; without it every inbox would count 0 and events would be marked published unhandled.
import { connect, safeErrorDiagnostics } from '@daifuku/kernel';
import { loadRuntime } from '@daifuku/runtime';
import { apiConfig } from '../config.ts';
import { readIdentityConfig, readSmtpConfig } from '../identity/config.ts';
import { smtpTransport } from '../identity/smtp.ts';
import { readEventWorkerConfig } from './config.ts';
import { runEventTick, tickExitCode } from './worker.ts';

async function main(): Promise<void> {
  const config = apiConfig();
  const workerConfig = readEventWorkerConfig(process.env);
  const identity = readIdentityConfig(process.env);
  const smtp = readSmtpConfig(process.env);
  await loadRuntime();
  const owner = connect(config.databaseUrlOwner, { max: 2 });
  const app = connect(config.databaseUrl, { max: 4 });
  try {
    const result = await runEventTick({
      owner,
      app,
      config: workerConfig,
      ...(identity
        ? {
            identity: {
              encryptionKey: identity.encryptionKey,
              webUrl: identity.webUrl,
              ...(smtp ? { mailTransport: smtpTransport(smtp) } : {}),
            },
          }
        : {}),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = tickExitCode(result);
  } finally {
    await app.close();
    await owner.close();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ message: 'Event delivery tick failed.', ...safeErrorDiagnostics(error) }));
  process.exitCode = 1;
});
