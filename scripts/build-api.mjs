import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { copyRuntime } from '../deploy/runtime.mjs';
import { compileApiRuntime, loadCompiler } from '../deploy/compile-api.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const parent = join(source, '.runtime');
const output = join(parent, 'api');
execFileSync('pnpm', ['typecheck'], { cwd: source, stdio: 'inherit' });
await mkdir(parent, { recursive: true });
const temporary = await mkdtemp(join(parent, 'api-build-'));
try {
  const runtime = join(temporary, 'runtime');
  const packages = await copyRuntime(source, runtime);
  const compiled = await compileApiRuntime(runtime, packages, await loadCompiler(source));
  execFileSync(process.execPath, ['dist/setup/cli.js', '--help'], { cwd: join(runtime, 'apps/api'), stdio: 'pipe' });
  // Only this script's fixed generated output is replaced after successful compilation and smoke testing.
  await rm(output, { recursive: true, force: true });
  await rename(runtime, output);
  console.log(
    `Compiled ${compiled.length} API workspace packages to .runtime/api; start with pnpm --filter @daifuku/api start.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
