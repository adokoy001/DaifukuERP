import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBundle } from './bundle.ts';
import { deploy } from './engine.ts';
import { operate } from './operations.ts';
import { windowsAdapter } from './platform-windows.ts';
import { linuxAdapter, macAdapter } from './platform-posix.ts';
const help = `Daifuku Edge service setup (administrator/root for execution)
  setup install --config <private.json> --manifest-sha256 <trusted sha256> [--execute]
  setup update --manifest-sha256 <trusted sha256> [--execute] [--resume]
  setup status
  setup start|stop|uninstall [--execute]
  setup pair --pairing-file <private.json> [--execute]
Optional: --install-root <absolute path> --state <absolute path> --bundle <directory>
Without --execute, mutations only show a plan. Uninstall retains data/accounts/releases.
Resume requires the same bundle and initial config file. No credentials on command lines.
`;
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean' },
      execute: { type: 'boolean' },
      resume: { type: 'boolean' },
      bundle: { type: 'string' },
      'manifest-sha256': { type: 'string' },
      'install-root': { type: 'string' },
      state: { type: 'string' },
      config: { type: 'string' },
      'pairing-file': { type: 'string' },
    },
  });
  if (values.help || !positionals.length) {
    process.stdout.write(help);
    return;
  }
  const operation = positionals[0];
  if (
    positionals.length !== 1 ||
    !['install', 'update', 'start', 'stop', 'status', 'uninstall', 'pair'].includes(operation ?? '')
  )
    throw new Error('unknown_operation');
  const adapter =
    process.platform === 'win32'
      ? windowsAdapter
      : process.platform === 'linux'
        ? linuxAdapter
        : process.platform === 'darwin'
          ? macAdapter
          : undefined;
  if (!adapter) throw new Error('unsupported_platform');
  const defaults = adapter.defaults();
  const installRoot = values['install-root'] ?? defaults.installRoot;
  let result: unknown;
  if (operation === 'install' || operation === 'update') {
    const directory = resolve(values.bundle ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    const bundle = await verifyBundle(directory, values['manifest-sha256'] ?? '');
    result = await deploy(
      {
        operation,
        bundle,
        installRoot,
        statePath: values.state ?? defaults.statePath,
        execute: values.execute ?? false,
        resume: values.resume ?? false,
        ...(values.config ? { configSource: resolve(values.config) } : {}),
      },
      adapter,
    );
  } else {
    if (values.resume || values.config || values.state) throw new Error('option_not_applicable');
    result = await operate(
      {
        operation: operation as 'start' | 'stop' | 'status' | 'uninstall' | 'pair',
        installRoot,
        execute: values.execute ?? false,
        ...(values['pairing-file'] ? { pairingSource: resolve(values['pairing-file']) } : {}),
      },
      adapter,
    );
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
void main().catch((error: unknown) => {
  const message =
    error instanceof Error && /^[a-z][a-z0-9_]+$/.test(error.message)
      ? error.message
      : 'setup_failed_review_paths_permissions_and_service_status';
  process.stderr.write(message + '\n');
  process.exitCode = 1;
});
