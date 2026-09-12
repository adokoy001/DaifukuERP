import { build } from 'esbuild';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
const result = await build({ entryPoints: { edge: 'src/main.ts', setup: 'setup/main.ts' }, outdir: 'dist', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'bundle', sourcemap: false, metafile: true, write: false, banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, external: ['bufferutil', 'utf-8-validate'] });
const packages = new Map();
for (const output of Object.values(result.metafile.outputs)) for (const [input, contribution] of Object.entries(output.inputs)) {
  if (!contribution.bytesInOutput || !input.includes('node_modules/')) continue;
  let directory = dirname(resolve(input));
  while (directory !== dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name && manifest.version) { packages.set(manifest.name + '@' + manifest.version, { directory, manifest }); break; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    directory = dirname(directory);
  }
  if (directory === dirname(directory)) throw new Error('Bundled dependency manifest is missing');
}
const notices = ['Daifuku LAN agent - bundled third-party notices', 'Keep this file and LICENSE beside edge.mjs when redistributing the standalone bundle.'];
for (const [name, { directory, manifest }] of [...packages.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  const files = (await readdir(directory)).filter((file) => /^(license|licence|notice)([.-].*)?$/i.test(file)).sort();
  if (!files.some((file) => /^licen[cs]e([.-].*)?$/i.test(file))) throw new Error('Bundled dependency license is missing: ' + name);
  notices.push('========================================', name + ' (' + String(manifest.license ?? 'see included license') + ')');
  for (const file of files) notices.push(file, await readFile(join(directory, file), 'utf8'));
}
const projectLicense = await readFile('../../LICENSE', 'utf8');
await mkdir('dist', { recursive: true });
for (const output of result.outputFiles) await writeFile(output.path, output.contents);
await writeFile('dist/LICENSE', projectLicense);
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n\n') + '\n');
