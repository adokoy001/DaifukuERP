import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EdgeError } from './errors.ts';
import { windowsIo } from './windows.ts';
import { assertNoMacAcl } from './macos.ts';
function privateMode(mode: number, uid: number): void {
  if (mode & 0o077 || typeof process.getuid !== 'function' || uid !== process.getuid())
    throw new EdgeError('private_file_permissions_required');
}
export async function privateDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') {
    await windowsIo('directory', { path });
    return;
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new EdgeError('unsafe_state_directory');
  privateMode(stat.mode, stat.uid);
  await assertNoMacAcl(path);
}
export async function readPrivateJson(path: string, maxBytes = 2000000): Promise<unknown> {
  if (process.platform === 'win32') {
    const text = await windowsIo('read', { path, maxBytes });
    if (typeof text !== 'string') throw new EdgeError('invalid_state_file');
    return JSON.parse(text) as unknown;
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    privateMode(stat.mode, stat.uid);
    if (!stat.isFile() || stat.size > maxBytes) throw new EdgeError('invalid_state_file');
    await assertNoMacAcl(path);
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}
export async function syncJson(path: string, value: unknown, maxBytes = 2000000): Promise<void> {
  const data = JSON.stringify(value);
  if (Buffer.byteLength(data) > maxBytes) throw new EdgeError('journal_capacity_exceeded');
  if (process.platform === 'win32') {
    await windowsIo('write', { path, bytes: Buffer.from(data).toString('base64'), maxBytes });
    return;
  }
  await privateDirectory(dirname(path));
  const temporary = join(dirname(path), '.' + basename(path) + '.' + randomUUID() + '.tmp');
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
export const missingFile = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

async function checkPrivateFile(path: string): Promise<void> {
  await privateDirectory(dirname(path));
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    privateMode(stat.mode, stat.uid);
    if (!stat.isFile()) throw new EdgeError('invalid_state_file');
    await assertNoMacAcl(path);
  } finally {
    await handle.close();
  }
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
/** Used only for fixed inbox/processing/archive names while the state writer lock is held. */
export async function movePrivateFile(source: string, destination: string): Promise<void> {
  if (dirname(source) !== dirname(destination)) throw new EdgeError('private_parent_required');
  if (process.platform === 'win32') {
    await windowsIo('move', { path: source, destination });
    return;
  }
  await checkPrivateFile(source);
  try {
    await lstat(destination);
    throw new EdgeError('private_file_exists');
  } catch (error) {
    if (!missingFile(error)) throw error;
  }
  await rename(source, destination);
  await syncDirectory(dirname(source));
}
export async function removePrivateFile(path: string): Promise<void> {
  if (process.platform === 'win32') {
    await windowsIo('remove', { path });
    return;
  }
  await checkPrivateFile(path);
  await unlink(path);
  await syncDirectory(dirname(path));
}
