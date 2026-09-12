import type { ServiceContext } from '../types.js';
import type { PosixHost } from './host.js';
import { command } from './host.js';
import { ownershipTag } from './render.js';
export interface PosixAccount { name: string; group: string; uid: number; gid: number; groups?: number[] }
export async function linuxGroup(host: PosixHost): Promise<{ name: string; gid: number }> {
  for (const name of ['nogroup', 'nobody']) {
    const result = await host.run('/usr/bin/getent', ['group', name]);
    if (result.code === 2) continue;
    if (result.code !== 0) throw new Error('Cannot inspect the service group.');
    const fields = result.stdout.trim().split(':');
    if (fields[0] !== name || !/^\d+$/.test(fields[2] ?? '') || Number(fields[2]) === 0) throw new Error('Invalid unprivileged service group.');
    return { name, gid: Number(fields[2]) };
  }
  throw new Error('A system nogroup or nobody group is required.');
}
export async function inspectLinuxAccount(host: PosixHost, context: ServiceContext): Promise<PosixAccount | null> {
  const result = await host.run('/usr/bin/getent', ['passwd', 'daifuku-edge']);
  if (result.code === 2) return null;
  if (result.code !== 0) throw new Error('Cannot inspect the service account.');
  const fields = result.stdout.trim().split(':');
  const group = await linuxGroup(host);
  if (fields.length !== 7 || fields[0] !== 'daifuku-edge' || !/^\d+$/.test(fields[2] ?? '') || Number(fields[2]) < 1 || fields[3] !== String(group.gid) || fields[4] !== ownershipTag(context) || fields[5] !== '/nonexistent' || fields[6] !== '/usr/sbin/nologin') throw new Error('Existing service account is not owned by this installation.');
  const groups = (await command(host, '/usr/bin/id', ['-G', 'daifuku-edge'])).trim().split(/\s+/);
  if (groups.length !== 1 || groups[0] !== String(group.gid)) throw new Error('Service account has unexpected supplementary groups.');
  const shadow = await command(host, '/usr/bin/getent', ['shadow', 'daifuku-edge']);
  if (!['!', '!!', '*'].includes(shadow.trim().split(':')[1] ?? '')) throw new Error('Service account authentication is not locked.');
  return { name: 'daifuku-edge', group: group.name, uid: Number(fields[2]), gid: group.gid };
}
export async function prepareLinuxAccount(host: PosixHost, context: ServiceContext): Promise<PosixAccount> {
  const existing = await inspectLinuxAccount(host, context);
  if (existing) return existing;
  const group = await linuxGroup(host);
  await command(host, '/usr/sbin/useradd', ['--system', '--gid', group.name, '--no-create-home', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', '--password', '!', '--comment', ownershipTag(context), 'daifuku-edge']);
  const account = await inspectLinuxAccount(host, context);
  if (!account) throw new Error('Created service account could not be verified.');
  return account;
}
