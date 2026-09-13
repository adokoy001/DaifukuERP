import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildRelease } from '../deploy/build.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    'Build a clean committed Linux/Node22 release using the pinned offline dependency store.\nUsage: node scripts/build-release.mjs --source /absolute/clean/repo --output /absolute/new/directory [--candidate]\nNo database access, source writes, service operations or inherited runtime secrets.\n',
  );
  process.exit(0);
}
try {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: root },
      output: { type: 'string' },
      candidate: { type: 'boolean', default: false },
    },
  });
  if (!values.output)
    throw new Error('Use --output /new/absolute/directory. Builds use offline dependencies from a clean commit.');
  const result = await buildRelease({
    source: values.source,
    output: values.output,
    candidate: values.candidate,
    progress: (stage) => process.stdout.write(`release: ${stage}\n`),
  });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write(
    `Release build stopped: ${error instanceof Error && !('stderr' in error) ? error.message : 'BUILD_FAILED (no dependency output or environment is disclosed)'}\n`,
  );
  process.exitCode = 1;
}
