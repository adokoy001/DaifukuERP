import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { compileWorkspace, compileApiRuntime, loadCompiler } from '../compile-api.mjs';
import { copyRuntime } from '../runtime.mjs';
import { inventory } from '../files.mjs';

test('AC-5 the emission compiler comes from the selected frozen source, not the release tool checkout', async () => {
  const source = await mkdtemp(join(tmpdir(), 'daifuku-compiler-origin-'));
  try {
    await writeFile(join(source, 'package.json'), '{}');
    await assert.rejects(loadCompiler(source));
    const dependency = join(source, 'node_modules/typescript');
    await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'typescript', main: 'index.cjs' }));
    await writeFile(join(dependency, 'index.cjs'), "module.exports = { version: 'frozen-source-sentinel' };");
    assert.equal((await loadCompiler(source)).version, 'frozen-source-sentinel');
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});

test('AC-5 compilation preserves relative static/dynamic imports, JSON assets and public subpaths without a TS loader', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daifuku-compile-fixture-'));
  try {
    await mkdir(join(directory, 'src/nested'), { recursive: true });
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: '@daifuku/synthetic',
        type: 'module',
        exports: { '.': './src/index.ts', './nested': { import: './src/nested/value.ts' } },
      }),
    );
    await writeFile(join(directory, 'src/nested/value.ts'), 'export const value: number = 17;');
    await writeFile(join(directory, 'src/values.json'), JSON.stringify({ text: '日本語の制度データ' }));
    await writeFile(
      join(directory, 'src/index.ts'),
      `
      import { value } from './nested/value.ts';
      import data from './values.json' with { type: 'json' };
      import { readFileSync } from 'node:fs';
      const dynamic = await import('./nested/value.ts');
      const asset = JSON.parse(readFileSync(new URL('./values.json', import.meta.url), 'utf8'));
      console.log(JSON.stringify({ value, dynamic: dynamic.value, data, asset }));
    `,
    );
    await writeFile(join(directory, 'src/ignored.test.ts'), 'throw Error("test must not run");');
    await compileWorkspace(directory, await loadCompiler(fileURLToPath(new URL('../../', import.meta.url))));
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.equal(metadata.exports['.'], './dist/index.js');
    assert.equal(metadata.exports['./nested'].import, './dist/nested/value.js');
    await rm(join(directory, 'src'), { recursive: true });
    const result = JSON.parse(
      execFileSync(process.execPath, ['dist/index.js'], { cwd: directory, env: {}, encoding: 'utf8' }),
    );
    assert.equal(result.value, 17);
    assert.equal(result.dynamic, 17);
    assert.deepEqual(result.data, result.asset);
    assert.equal(result.data.text, '日本語の制度データ');
    await assert.rejects(readFile(join(directory, 'dist/ignored.test.js')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('AC-5 frozen compiled API loads without tsx or schema tooling; setup retains its independent migration tools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daifuku-compiled-api-'));
  const stage = fileURLToPath(new URL('../../', import.meta.url));
  try {
    const runtime = join(directory, 'runtime');
    const packages = await copyRuntime(stage, runtime);
    const compiled = await compileApiRuntime(runtime, packages, await loadCompiler(stage));
    assert.ok(compiled.some((pkg) => pkg.name === '@daifuku/l10n-jp'));
    // Fail on the actual loaded module graph, not just a text search of an entry file.
    const guard = join(directory, 'guard.mjs');
    await writeFile(
      guard,
      `export async function resolve(specifier, context, next) {
      if (/^(tsx|drizzle-kit)(\\/|$)/.test(specifier) || specifier.endsWith('.ts'))
        throw new Error('Unexpected API runtime dependency: ' + specifier);
      return next(specifier, context);
    }`,
    );
    const api = join(runtime, 'apps/api');
    const probe = join(api, 'probe.mjs');
    await writeFile(
      probe,
      `
      import { register } from 'node:module';
      register(${JSON.stringify('file://' + guard)}, import.meta.url);
      const { buildServer } = await import('./dist/server.js');
      const { loadRuntime } = await import('@daifuku/runtime');
      await loadRuntime({ schema: true });
      if (typeof buildServer !== 'function') throw Error('API export absent');
      console.log('compiled-api-ready');
    `,
    );
    const env = { NODE_ENV: 'test', DAIFUKU_PACKS: 'all' };
    assert.match(
      execFileSync(process.execPath, [probe], { cwd: api, env, encoding: 'utf8', stdio: 'pipe' }),
      /compiled-api-ready/,
    );
    const help = execFileSync(process.execPath, ['dist/setup/cli.js', '--help'], {
      cwd: api,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.match(help, /Usage|usage|使い方/);
    await rm(probe);
    await inventory(runtime);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
