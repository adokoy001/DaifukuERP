import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { SetupError, type SetupState } from './types.ts';

export async function privateFile(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new SetupError('PRIVATE_PATH', '秘密ファイルは絶対パスで指定してください。');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))
      throw new SetupError('PRIVATE_PERMISSIONS', '秘密ファイルは自分が所有する通常ファイル、権限0600にしてください。');
    return await file.readFile('utf8');
  } finally {
    await file.close();
  }
}
export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
export async function privateDirectory(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new SetupError('STATE_PATH', '運用ディレクトリは絶対パスで指定してください。');
  let ancestor = path;
  while (!(await exists(ancestor))) ancestor = dirname(ancestor);
  if ((await realpath(ancestor)) !== resolve(ancestor))
    throw new SetupError('STATE_SYMLINK', '運用ディレクトリの経路にsymlinkを使用できません。');
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new SetupError('STATE_PERMISSIONS', '運用ディレクトリは自分の所有で権限0700にしてください。');
}
export async function writeExclusive(path: string, text: string): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
}
export async function readState(dir: string): Promise<SetupState | undefined> {
  const path = join(resolve(dir), 'setup-state.json');
  if (!(await exists(path))) return undefined;
  const state = JSON.parse(await privateFile(path)) as SetupState;
  if (
    state.format !== 1 ||
    !['install', 'upgrade'].includes(state.operationMode) ||
    typeof state.phase !== 'string' ||
    typeof state.targetId !== 'string' ||
    !Array.isArray(state.seededModules) ||
    !Array.isArray(state.backups)
  )
    throw new SetupError('STATE_INVALID', 'checkpoint形式が不正です。新規導入として上書きしません。');
  return state;
}
export async function saveState(dir: string, state: SetupState): Promise<void> {
  const path = join(dir, 'setup-state.json');
  if (await exists(path)) await privateFile(path);
  const temp = join(dirname(path), `.state-${randomBytes(8).toString('hex')}.tmp`);
  await writeExclusive(temp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temp, path);
  const directory = await open(dir, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
