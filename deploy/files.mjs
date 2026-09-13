import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
export const digest = (data) => createHash('sha256').update(data).digest('hex');
export function within(root, target) {
  const value = relative(resolve(root), resolve(target));
  return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}
export function safePath(value) {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    !/^[a-zA-Z0-9_/.-]+$/.test(value) ||
    value.includes('/../') ||
    value.includes('/./')
  )
    throw new Error('Use an absolute path without shell syntax, whitespace or traversal.');
  return resolve(value);
}
export function restrictedSource(path) {
  return (
    /(^|\/)(\.git|node_modules|\.data|\.runtime|backups|test-results|playwright-report)(\/|$)/.test(path) ||
    /(^|\/)(runtime\.env|setup-state\.json|initial-admin-password\.txt|\.npmrc)$/.test(path) ||
    (/(^|\/)\.env(?:$|\.)/.test(path) && !path.endsWith('.example')) ||
    /\.(dump|pgdump|pem|key|p12|pfx|log|zip|tar|gz)$/.test(path)
  );
}
export async function owned(path, directory = false, privateMode = true) {
  const info = await lstat(path);
  if (
    info.isSymbolicLink() ||
    (await realpath(path)) !== resolve(path) ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    (process.getuid && info.uid !== process.getuid()) ||
    (privateMode && info.mode & 0o077)
  )
    throw new Error('Expected an owned, non-symlink path with private permissions.');
  return info;
}
export async function inventory(root) {
  const records = [];
  async function visit(dir) {
    for (const item of (await readdir(dir)).sort()) {
      const path = join(dir, item),
        name = relative(root, path),
        info = await lstat(path);
      if (name === 'manifest.json') continue;
      if (!info.isSymbolicLink() && info.mode & 0o6022)
        throw new Error('Release contains privileged or writable-by-other files.');
      if (info.isDirectory()) {
        records.push({ path: name, type: 'directory', mode: info.mode & 0o777 });
        await visit(path);
      } else if (info.isSymbolicLink()) {
        const target = await readlink(path);
        if (isAbsolute(target) || !within(root, resolve(dir, target)) || !within(root, await realpath(path)))
          throw new Error('Release contains an escaping or broken symlink.');
        records.push({ path: name, type: 'symlink', target });
      } else if (info.isFile())
        records.push({
          path: name,
          type: 'file',
          mode: info.mode & 0o777,
          bytes: info.size,
          sha256: digest(await readFile(path)),
        });
      else throw new Error('Release contains a special filesystem object.');
    }
  }
  await visit(root);
  return records;
}
export async function verifyRelease(root, expectedHash) {
  const directory = await lstat(root);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (await realpath(root)) !== resolve(root) ||
    directory.mode & 0o6022
  )
    throw new Error('Use the immutable release directory directly, without a mutable path alias.');
  const manifestPath = join(root, 'manifest.json'),
    info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024 || info.mode & 0o6022)
    throw new Error('Invalid manifest file.');
  const raw = await readFile(manifestPath),
    manifest = JSON.parse(raw);
  if (expectedHash && digest(raw) !== expectedHash)
    throw new Error('Release manifest does not match the approved digest.');
  if (
    manifest.format !== 1 ||
    typeof manifest.candidate !== 'boolean' ||
    !/^v22\./.test(manifest.node ?? '') ||
    !/^[a-f0-9]{40}$/.test(manifest.commit) ||
    manifest.apiBase !== '/api' ||
    manifest.platform !== 'linux' ||
    !['x64', 'arm64'].includes(manifest.arch) ||
    !Array.isArray(manifest.files)
  )
    throw new Error('Invalid release manifest.');
  if (JSON.stringify(await inventory(root)) !== JSON.stringify(manifest.files))
    throw new Error('Release contents, modes or symlinks changed.');
  return { manifest, sha256: digest(raw) };
}
