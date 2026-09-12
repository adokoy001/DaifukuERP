import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { EdgeError } from '../src/errors.ts';
import { assertNoMacAcl } from '../src/macos.ts';
import { windowsIo } from '../src/windows.ts';
import { pathChain } from './io.ts';
/** Administrator may consume another user's private file; it must never be publicly readable. */
export async function readPrivateSource(path: string, maxBytes: number): Promise<Buffer> {
  if (process.platform === 'win32') {
    const value = await windowsIo('read', { path, maxBytes });
    if (typeof value !== 'string') throw new EdgeError('invalid_state_file');
    return Buffer.from(value, 'utf8');
  }
  await pathChain(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new EdgeError('invalid_state_file');
    if (stat.mode & 0o077) throw new EdgeError('private_file_permissions_required');
    await assertNoMacAcl(path);
    const data = await handle.readFile();
    if (data.length > maxBytes) throw new EdgeError('invalid_state_file');
    return data;
  } finally { await handle.close(); }
}
