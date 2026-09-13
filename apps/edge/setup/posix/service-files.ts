import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ServiceContext } from '../types.js';
import type { PosixHost } from './host.js';
import { ownershipTag } from './render.js';
import { noAcl, rootFile, rootParents } from './security.js';
export async function replaceDefinition(
  host: PosixHost,
  path: string,
  body: string,
  context: ServiceContext,
): Promise<void> {
  await rootParents(host, path);
  const previous = await rootFile(host, path);
  if (previous !== null && !previous.includes(ownershipTag(context)))
    throw new Error('Existing service definition belongs to another installation.');
  const temporary = path + '.new-' + randomUUID();
  await host.write(temporary, body, 0o600);
  try {
    await noAcl(host, temporary);
    await host.chown(temporary, 0, 0);
    await host.rename(temporary, path);
  } catch (error) {
    // Only our exclusive temporary file is removed. Registration/data are retained for resume.
    await host.remove(temporary).catch(() => undefined);
    throw error;
  }
}
export async function saveDefinition(
  host: PosixHost,
  context: ServiceContext,
  name: string,
  destination: string,
  body: string,
): Promise<void> {
  await replaceDefinition(host, destination, body, context);
  await replaceDefinition(host, join(context.servicePath, name), body, context);
}
