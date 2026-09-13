import { cp, lstat, mkdir, readFile, readlink, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { within } from './files.mjs';
async function dependency(stage, directory, name) {
  if (!/^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(name)) throw new Error('Invalid dependency name.');
  for (let current = directory; within(stage, current); current = dirname(current)) {
    const path = join(current, 'node_modules', name);
    try {
      const info = await lstat(path);
      const target = await realpath(path);
      return { path, target, link: info.isSymbolicLink() };
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
    if (current === stage) break;
  }
}
async function copyHoistedLinks(stage, destination, visited) {
  async function directory(path) {
    let entries;
    try {
      entries = await readdir(path);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const name of entries) {
      const link = join(path, name);
      const info = await lstat(link);
      if (name.startsWith('@') && info.isDirectory()) {
        await directory(link);
        continue;
      }
      if (!info.isSymbolicLink()) continue;
      const actual = await realpath(link);
      if (!visited.has(actual)) continue;
      const output = join(destination, relative(stage, link));
      const target = join(destination, relative(stage, actual));
      await mkdir(dirname(output), { recursive: true });
      try {
        await symlink(relative(dirname(output), target), output);
      } catch (error) {
        if (error.code !== 'EEXIST' || (await readlink(output)) !== relative(dirname(output), target)) throw error;
      }
    }
  }
  // Keep only fallback links for already selected packages. Some upstream bundles
  // (drizzle-kit/api) load a consumer-provided package without declaring a peer.
  await directory(join(stage, 'node_modules/.pnpm/node_modules'));
  await directory(join(stage, 'node_modules'));
}
/** Copy the already frozen installed graph. Never resolve semver ranges during deployment. */
export async function copyRuntime(stage, destination) {
  stage = resolve(stage);
  await mkdir(destination);
  const pending = [join(stage, 'apps/api')];
  const visited = new Set();
  const packages = [];
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json'])
    await cp(join(stage, name), join(destination, name));
  while (pending.length) {
    const directory = pending.shift();
    if (visited.has(directory)) continue;
    if (!within(stage, directory)) throw new Error('Installed dependency escapes the frozen build.');
    visited.add(directory);
    const path = relative(stage, directory);
    const target = join(destination, path);
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    await mkdir(dirname(target), { recursive: true });
    await cp(directory, target, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (entry) => !relative(directory, entry).split('/').includes('node_modules'),
    });
    packages.push({ name: metadata.name, version: metadata.version, path });
    const required = metadata.dependencies ?? {};
    const optional = metadata.optionalDependencies ?? {};
    const peers = metadata.peerDependencies ?? {};
    for (const name of new Set([...Object.keys(required), ...Object.keys(optional), ...Object.keys(peers)])) {
      const found = await dependency(stage, directory, name);
      if (!found) {
        if (name in required && !(name in optional))
          throw new Error('A required frozen runtime dependency is missing.');
        continue;
      }
      if (!within(stage, found.target)) throw new Error('Installed dependency points outside the build.');
      if (found.link) {
        const link = join(destination, relative(stage, found.path));
        const output = join(destination, relative(stage, found.target));
        await mkdir(dirname(link), { recursive: true });
        try {
          await symlink(relative(dirname(link), output), link);
        } catch (error) {
          if (error.code !== 'EEXIST' || (await readlink(link)) !== relative(dirname(link), output)) throw error;
        }
      }
      pending.push(found.target);
    }
  }
  await copyHoistedLinks(stage, destination, visited);
  packages.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(join(destination, 'runtime-packages.json'), JSON.stringify(packages, null, 2) + '\n');
  return packages;
}
