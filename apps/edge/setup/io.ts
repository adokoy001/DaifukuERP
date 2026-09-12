import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { missingFile } from '../src/files.ts';
import { windowsDurableReplace } from './windows/durable.ts';
export const digest = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
export function safePath(value: string): string {
  if (!isAbsolute(value) || [...value].some((char) => char.charCodeAt(0) < 32) || /["<>|?*]/.test(value) || value.startsWith('\\\\') || value.startsWith('//')) throw new Error('unsafe_absolute_path');
  const path = resolve(value); if (path === parse(path).root) throw new Error('filesystem_root_forbidden'); return path;
}
/** Inspect every existing ancestor; never follow links, including Windows junctions. */
export async function pathChain(path: string, administrative = false): Promise<void> {
  const paths: string[] = []; let current = resolve(path);
  while (current !== dirname(current)) { paths.unshift(current); current = dirname(current); }
  for (const item of paths) {
    let stat; try { stat = await lstat(item); } catch (error) { if (missingFile(error)) break; throw error; }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && item !== resolve(path)) || (stat.isFile() && stat.nlink !== 1)) throw new Error('unsafe_path_link');
    if (administrative && process.platform !== 'win32' && (stat.uid !== 0 || (stat.mode & 0o022))) throw new Error('administrator_owned_path_required');
  }
}
export async function readRegular(path: string, max = 2_000_000): Promise<Buffer> {
  await pathChain(path); const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) throw new Error('unsafe_regular_file'); return await handle.readFile(); }
  finally { await handle.close(); }
}
export async function jsonFile(path: string): Promise<unknown | undefined> {
  try { return JSON.parse((await readRegular(path)).toString('utf8')) as unknown; } catch (error) { if (missingFile(error)) return undefined; throw error; }
}
export async function exclusiveWrite(path: string, data: string | Buffer, mode = 0o600): Promise<void> {
  await pathChain(dirname(path)); const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
export async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(path, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); }
}
export async function durableJson(path: string, value: unknown): Promise<void> {
  const temporary = join(dirname(path), '.intent-' + randomUUID());
  await exclusiveWrite(temporary, JSON.stringify(value, null, 2) + '\n');
  if (process.platform === 'win32') await windowsDurableReplace(temporary, path); else await rename(temporary, path);
  await syncDirectory(dirname(path));
}
export async function absentOrEmpty(path: string, permitted: string[] = []): Promise<void> {
  try { if ((await readdir(path)).some((entry) => !permitted.includes(entry))) throw new Error('unmanaged_directory_not_empty'); }
  catch (error) { if (!missingFile(error)) throw error; }
}
export async function makeDirectory(path: string): Promise<void> { await pathChain(path); await mkdir(path, { recursive: true, mode: 0o700 }); }
