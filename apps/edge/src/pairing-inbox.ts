import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { edgeSecret } from '@daifuku/mod-edge-integration/contract';
import type { Credentials } from './credentials.ts';
import { EdgeError } from './errors.ts';
import { missingFile, movePrivateFile, readPrivateJson, removePrivateFile } from './files.ts';
const pairing = z.object({ pairingToken: edgeSecret }).strict();
const archivePattern = /^pairing-rejected-[a-f0-9-]{36}\.json$/;
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (missingFile(error)) return false;
    throw error;
  }
}
export async function connectService(
  credentials: Credentials,
  directory: string,
): Promise<'running' | 'pairing_required' | 'credential_rejected'> {
  const inbox = join(directory, 'pairing.json'),
    processing = join(directory, 'pairing.processing.json');
  let waiting: 'pairing_required' | 'credential_rejected' = 'pairing_required';
  try {
    await credentials.session();
    // Only this service takes an inbox, and only after authentication was absent/rejected.
    // A live saved credential proves a previously interrupted pairing completed successfully.
    if (await exists(processing)) await removePrivateFile(processing);
    return 'running';
  } catch (error) {
    if (!(error instanceof EdgeError) || !['pairing_required', 'credential_rejected'].includes(error.code)) throw error;
    if (error.code === 'credential_rejected') waiting = 'credential_rejected';
  }
  if (await exists(inbox)) {
    if (await exists(processing)) {
      if ((await readdir(directory)).filter((name) => archivePattern.test(name)).length >= 10)
        throw new EdgeError('pairing_archive_full');
      await movePrivateFile(processing, join(directory, 'pairing-rejected-' + randomUUID() + '.json'));
    }
    await movePrivateFile(inbox, processing);
  }
  if (!(await exists(processing))) return waiting;
  let value: unknown;
  try {
    value = await readPrivateJson(processing, 2048);
  } catch (error) {
    if (error instanceof SyntaxError) throw new EdgeError('invalid_pairing_file');
    throw error;
  }
  const input = pairing.safeParse(value);
  if (!input.success) throw new EdgeError('invalid_pairing_file');
  await credentials.pair(input.data.pairingToken);
  await credentials.session();
  await removePrivateFile(processing);
  return 'running';
}
