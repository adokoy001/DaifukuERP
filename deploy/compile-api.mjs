import { cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { within } from './files.mjs';

/** Resolve the compiler installed by the selected source's frozen lockfile, never the caller's checkout. */
export async function loadCompiler(source) {
  const require = createRequire(join(source, 'package.json'));
  const entry = await realpath(require.resolve('typescript'));
  if (!within(await realpath(source), entry)) throw new Error('The frozen source compiler is missing.');
  return require(entry);
}

function compiledPath(value) {
  if (typeof value === 'string') return value.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');
  if (Array.isArray(value)) return value.map(compiledPath);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compiledPath(item)]));
  return value;
}

/** Preserve module/file layout: import.meta.url assets and native dependency resolution remain valid. */
export async function compileWorkspace(directory, ts) {
  const source = join(directory, 'src'),
    output = join(directory, 'dist');
  let count = 0;
  async function walk(input, destination) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(input, { withFileTypes: true })) {
      const path = join(input, entry.name),
        target = join(destination, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Workspace source links are not supported in compiled runtime.');
      if (entry.isDirectory()) {
        if (!['__tests__', '__snapshots__'].includes(entry.name)) await walk(path, target);
      } else if (entry.isFile() && !/\.(?:test|spec|d)\.ts$/.test(entry.name)) {
        if (entry.name.endsWith('.ts')) {
          const result = ts.transpileModule(await readFile(path, 'utf8'), {
            fileName: entry.name,
            reportDiagnostics: true,
            compilerOptions: {
              target: ts.ScriptTarget.ES2023,
              module: ts.ModuleKind.ESNext,
              verbatimModuleSyntax: true,
              rewriteRelativeImportExtensions: true,
              newLine: ts.NewLineKind.LineFeed,
            },
          });
          if (result.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error))
            throw new Error(`Cannot compile workspace source: ${path}`);
          await writeFile(target.replace(/\.ts$/, '.js'), result.outputText);
          count++;
        } else {
          await cp(path, target);
        }
      }
    }
  }
  await walk(source, output);
  const metadataPath = join(directory, 'package.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (metadata.exports) metadata.exports = compiledPath(metadata.exports);
  for (const key of ['main', 'module', 'types']) if (metadata[key]) metadata[key] = compiledPath(metadata[key]);
  // The runtime copy is a generated artifact; development watch/build commands stay in source/.
  delete metadata.devDependencies;
  delete metadata.scripts;
  if (metadata.name === '@daifuku/api') metadata.scripts = { start: 'node dist/main.js' };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  return count;
}

/** Compile only first-party packages selected by the frozen production graph. Dependencies stay byte-identical. */
export async function compileApiRuntime(runtime, packages, compiler) {
  const compiled = [];
  for (const pkg of packages) {
    if (!pkg.name.startsWith('@daifuku/')) continue;
    const files = await compileWorkspace(join(runtime, pkg.path), compiler);
    compiled.push({ name: pkg.name, path: pkg.path, files });
  }
  const file = join(runtime, 'compiled-workspaces.json');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ format: 1, compiler: compiler.version, packages: compiled }, null, 2) + '\n');
  return compiled;
}
