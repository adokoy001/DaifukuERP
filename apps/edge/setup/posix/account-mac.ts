import { randomUUID } from 'node:crypto';
import { macAccountGroups } from '../../src/macos-membership.ts';
import type { ServiceContext } from '../types.js';
import type { PosixHost } from './host.js';
import type { PosixAccount } from './account-linux.js';
import { command } from './host.js';
import { ownershipTag } from './render.js';
const userPath = '/Users/_daifukuedge';
export function dsRecord(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  let key = '';
  for (const line of text.split('\n')) {
    const match = /^((?:dsAttrType(?:Standard|Native):)?[A-Za-z][A-Za-z0-9_]*):(?: (.*))?$/.exec(line);
    if (match?.[1]) {
      // dscl shortens standard names but retains the namespace of native IsHidden.
      key = match[1] === 'dsAttrTypeNative:IsHidden' ? 'IsHidden' : match[1].replace(/^dsAttrTypeStandard:/, '');
      if (result[key] !== undefined) throw new Error('mac_account_duplicate_attribute');
      result[key] = match[2] ?? '';
    }
    else if (key && /^ /.test(line)) result[key] = [result[key], line.trim()].filter(Boolean).join(' ');
  }
  return result;
}
async function record(host: PosixHost): Promise<Record<string, string> | null> {
  const names = await command(host, '/usr/bin/dscl', ['.', '-list', '/Users']);
  const exists = names.split('\n').includes('_daifukuedge');
  if (!exists) {
    const search = await host.run('/usr/bin/id', ['-u', '_daifukuedge']);
    if (search.code === 0) throw new Error('A nonlocal account uses the service account name.');
    if (search.code !== 1) throw new Error('Cannot verify absence of the service account.');
    return null;
  }
  return dsRecord(await command(host, '/usr/bin/dscl', ['.', '-read', userPath]));
}
async function nobodyGroup(host: PosixHost): Promise<number> {
  const fields = dsRecord(await command(host, '/usr/bin/dscl', ['.', '-read', '/Groups/nobody']));
  const raw = fields.PrimaryGroupID;
  if (raw === '-2') return 4294967294;
  if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 4294967294) throw new Error('Invalid nobody group.');
  return Number(raw);
}
function owned(record: Record<string, string>, context: ServiceContext): void {
  if (record.RealName !== ownershipTag(context)) throw new Error('Existing service account is not owned by this installation.');
}
/** Attribute errors are fixed codes; never include directory-service password/authentication values. */
export function validateMacAccountAttributes(fields: Record<string, string>, gid: number): void {
  if (!/^\d+$/.test(fields.UniqueID ?? '') || Number(fields.UniqueID) < 400 || Number(fields.UniqueID) >= 500) throw new Error('mac_account_uid_invalid');
  if (![String(gid), ...(gid === 4294967294 ? ['-2'] : [])].includes(fields.PrimaryGroupID ?? '')) throw new Error('mac_account_primary_group_changed');
  if (fields.UserShell !== '/usr/bin/false') throw new Error('mac_account_shell_changed');
  if (fields.NFSHomeDirectory !== '/var/empty') throw new Error('mac_account_home_changed');
  if (fields.Password !== '*') throw new Error('mac_account_password_changed');
  if (fields.IsHidden !== '1') throw new Error('mac_account_hidden_changed');
  if (fields.AuthenticationAuthority !== ';DisabledUser;') throw new Error('mac_account_authentication_changed');
}
export async function inspectMacAccount(host: PosixHost, context: ServiceContext, partial = false): Promise<PosixAccount | null> {
  const fields = await record(host);
  if (!fields) return null;
  owned(fields, context);
  const gid = await nobodyGroup(host);
  if (partial && !fields.UniqueID) return null;
  validateMacAccountAttributes(fields, gid);
  const groups = await macAccountGroups(host.run);
  if (!groups.includes(gid)) throw new Error('mac_account_primary_group_missing');
  return { name: '_daifukuedge', group: 'nobody', uid: Number(fields.UniqueID), gid, groups };
}
export function nextServiceUid(text: string): number {
  const used = new Set(text.split('\n').map((line) => line.trim().split(/\s+/).at(-1)));
  for (let uid = 400; uid < 500; uid++) if (!used.has(String(uid))) return uid;
  throw new Error('No unused service UID is available between 400 and 499.');
}
export async function prepareMacAccount(host: PosixHost, context: ServiceContext): Promise<PosixAccount> {
  let fields = await record(host);
  if (fields) owned(fields, context);
  if (fields?.UniqueID && fields?.AuthenticationAuthority) {
    const existing = await inspectMacAccount(host, context);
    if (existing) return existing;
  }
  const gid = await nobodyGroup(host);
  if (!fields) {
    // The creation request itself includes our owner tag, allowing interrupted provisioning to resume.
    await command(host, '/usr/bin/dscl', ['.', '-create', userPath, 'RealName', ownershipTag(context)]);
    fields = await record(host);
    if (!fields) throw new Error('Created service account could not be read.');
  }
  const users = await command(host, '/usr/bin/dscl', ['/Search', '-list', '/Users', 'UniqueID']);
  const uid = fields.UniqueID ? Number(fields.UniqueID) : nextServiceUid(users);
  if (!Number.isSafeInteger(uid) || uid < 400 || uid >= 500) throw new Error('Invalid managed service UID.');
  const collisions = users.split('\n').filter((line) => line.trim().split(/\s+/).at(-1) === String(uid) && line.trim().split(/\s+/)[0] !== '_daifukuedge');
  if (collisions.length) throw new Error('Service UID is already used by another account.');
  const attributes = { GeneratedUID: fields.GeneratedUID ?? randomUUID().toUpperCase(), Password: '*', AuthenticationAuthority: ';DisabledUser;', UserShell: '/usr/bin/false', NFSHomeDirectory: '/var/empty', IsHidden: '1', PrimaryGroupID: gid === 4294967294 ? '-2' : String(gid), UniqueID: String(uid) };
  for (const [key, value] of Object.entries(attributes)) {
    if (fields[key] !== undefined && fields[key] !== value) throw new Error('Partially created service account attributes changed.');
    await command(host, '/usr/bin/dscl', ['.', '-create', userPath, key, value]);
  }
  const account = await inspectMacAccount(host, context);
  if (!account) throw new Error('Created service account could not be verified.');
  return account;
}
