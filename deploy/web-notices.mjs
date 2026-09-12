import { lstat, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { within } from './files.mjs';
const licenseName = /^(licen[cs]e|unlicense|copying)([.-].*)?$/i;
const noticeName = /^(licen[cs]e|unlicense|copying|notice|copyright)([.-].*)?$/i;
async function packageForInput(stage, input) {
  if (typeof input !== 'string' || !within(stage, resolve(stage, input))) throw new Error('Invalid Web license input.');
  const actual = await realpath(resolve(stage, input));
  if (!within(stage, actual) || !relative(stage, actual).split('/').includes('node_modules')) throw new Error('Web license input escapes installed dependencies.');
  for (let directory = dirname(actual); within(stage, directory); directory = dirname(directory)) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (metadata.name && metadata.version) return { directory, metadata };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (directory === stage) break;
  }
  throw new Error('Bundled Web dependency manifest is missing.');
}
async function packageNotices(directory, metadata) {
  const label = metadata.name + '@' + metadata.version;
  const files = (await readdir(directory)).filter((name) => noticeName.test(name)).sort();
  if (!files.some((name) => licenseName.test(name))) throw new Error('Web dependency license is missing: ' + label);
  const notices = [];
  for (const file of files) {
    const actual = await realpath(join(directory, file));
    if (!within(directory, actual) || !(await lstat(actual)).isFile()) throw new Error('Invalid Web dependency notice: ' + label);
    const text = await readFile(actual, 'utf8');
    if (!text.trim()) throw new Error('Web dependency notice is empty: ' + label);
    notices.push({ file, text });
  }
  return notices;
}
/** Collect only dependencies contributing code to main/worker chunks in the frozen Vite build. */
export async function writeWebNotices(stage, destination) {
  stage = resolve(stage);
  const evidence = join(destination, '.license-inputs'), packages = new Map();
  const files = await readdir(evidence);
  if (!files.length) throw new Error('Web bundle license evidence is missing.');
  for (const file of files) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) throw new Error('Invalid Web license evidence.');
    const inputs = JSON.parse(await readFile(join(evidence, file), 'utf8'));
    if (!Array.isArray(inputs)) throw new Error('Invalid Web bundle license inputs.');
    for (const input of inputs) {
      const { directory, metadata } = await packageForInput(stage, input);
      if (packages.has(directory)) continue;
      const notices = await packageNotices(directory, metadata);
      packages.set(directory, { name: metadata.name, version: metadata.version, license: metadata.license ?? 'see included license', path: relative(stage, directory), notices });
    }
  }
  if (!packages.size) throw new Error('Web bundle license inputs are empty.');
  // Tailwind's CSS/preflight is emitted by the CSS pipeline, outside JavaScript chunk.modules.
  const css = await packageForInput(stage, 'apps/web/node_modules/tailwindcss/index.css');
  const cssNotices = await packageNotices(css.directory, css.metadata);
  packages.set(css.directory, { name: css.metadata.name, version: css.metadata.version, license: css.metadata.license, path: relative(stage, css.directory), notices: cssNotices });
  // These vendored icon paths are embedded in icon.tsx, so npm input IDs cannot identify them.
  const iconDirectory = join(stage, 'vendor/feather');
  const iconNotices = await packageNotices(iconDirectory, { name: 'feather-icons', version: '4.29.2' });
  const icons = { name: 'feather-icons', version: '4.29.2', license: 'MIT', path: 'vendor/feather', notices: iconNotices };
  const sorted = [...packages.values(), icons].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const body = ['Daifuku Web - third-party notices', 'Keep this file and LICENSE with the Web distribution. These dependencies contribute to the main/worker bundles, Tailwind CSS pipeline or embedded Feather icons.'];
  for (const pkg of sorted) {
    body.push('========================================', `${pkg.name}@${pkg.version} (${pkg.license})`);
    for (const notice of pkg.notices) body.push(notice.file, notice.text);
  }
  // Resolve every required notice before emitting files; never publish an incomplete bundle.
  const projectLicense = await readFile(join(stage, 'LICENSE'), 'utf8');
  if (!projectLicense.trim()) throw new Error('Web distribution license is empty.');
  await writeFile(join(destination, 'LICENSE'), projectLicense, { flag: 'wx' });
  await writeFile(join(destination, 'THIRD_PARTY_NOTICES.txt'), body.join('\n\n') + '\n', { flag: 'wx' });
  const inventory = sorted.map(({ notices, ...pkg }) => ({ ...pkg, noticeFiles: notices.map((notice) => notice.file) }));
  await writeFile(join(destination, 'web-packages.json'), JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx' });
  await rm(evidence, { recursive: true });
  return inventory;
}
