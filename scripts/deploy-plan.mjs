import { parseArgs } from 'node:util';
import { renderProfile } from '../deploy/profile.mjs';
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/deploy-plan.mjs --release /absolute/bundle --manifest-sha256 <approved64hex> --state /absolute/private/state --config /absolute/private/state/runtime.env --output /absolute/new/profile --node /absolute/node22 --user CURRENT_SERVICE_USER --hostname erp.example.jp --profile cloud|onprem [--cert /absolute/certificate --key /absolute/key] [--execute] [--allow-candidate]\nDefault: read-only plan. Execute creates new profile files and private evidence only; never installs/starts services or changes database/credentials.\n',
  );
  process.exit(0);
}
try {
  const names = [
    'release',
    'state',
    'config',
    'output',
    'node',
    'user',
    'hostname',
    'profile',
    'cert',
    'key',
    'manifest-sha256',
  ];
  const { values } = parseArgs({
    options: {
      ...Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
      execute: { type: 'boolean', default: false },
      'allow-candidate': { type: 'boolean', default: false },
    },
  });
  const result = await renderProfile({
    ...values,
    manifestHash: values['manifest-sha256'],
    allowCandidate: values['allow-candidate'],
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  process.stderr.write(
    `Deployment plan stopped: ${error instanceof Error ? error.message : 'INVALID_CONFIGURATION'}\n`,
  );
  process.exitCode = 1;
}
