import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseOptions } from './options.ts';
import { buildPlan } from './inspect.ts';
import { runSetup } from './execute.ts';
import { safeFailure } from './types.ts';

export async function main(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Daifuku safe setup — default: read-only plan
Usage: pnpm run setup install|upgrade --env /absolute/private.env --state-dir /absolute/operations
Install identity: --tenant-name NAME --company-code CODE --company-name NAME --admin-email EMAIL --admin-name NAME
Initial password: --generate-admin-password OR --admin-password-file /absolute/private-file (otherwise hidden prompt)
Execution: --execute --confirm-target TARGET_ID --maintenance-confirmed
Remote DB: --allow-remote (requires verified TLS)
Read docs/operations/setup.md before running. Help does not inspect or change the database or state directory.
`);
    return;
  }
  const options = parseOptions(args);
  const plan = await buildPlan(options);
  process.stdout.write(
    `${JSON.stringify({ ...plan, executionRequested: options.execute, initialAdmin: options.mode === 'install' ? { tenant: options.tenantName ?? '(required)', company: options.companyCode ?? '(required)', email: options.adminEmail ?? '(required)' } : undefined, backupScope: 'PostgreSQL only; preserve evidence files and runtime.env separately' }, null, 2)}\n`,
  );
  if (!options.execute) {
    process.stdout.write('計画のみです。DB・設定・ファイルを変更していません。\n');
    return;
  }
  await runSetup(options, { progress: (phase) => process.stdout.write(`setup: ${phase}\n`) });
  process.stdout.write('セットアップ処理を完了しました。保存済み設定とバックアップを保全してください。\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${safeFailure(error)}\n`);
    process.exitCode = 1;
  });
}
