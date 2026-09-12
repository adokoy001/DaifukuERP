import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EdgeError } from './errors.ts';
const execute = promisify(execFile);
export type DirectoryRunner = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
// Apple standard groups: system, administrators, printer administration and developer authorization.
export const privilegedMacGroups = new Set([0, 80, 98, 204]);
export function numericMacGroups(text: string): number[] {
  const parts = text.trim().split(/\s+/);
  if (!parts.every((part) => /^(?:-2|\d+)$/.test(part))) throw new EdgeError('mac_account_group_list_invalid');
  const groups = [...new Set(parts.map((part) => part === '-2' ? 4294967294 : Number(part)))].sort((a, b) => a - b);
  if (groups.some((group) => !Number.isSafeInteger(group) || group > 4294967295) || groups.length > 1024) throw new EdgeError('mac_account_group_list_invalid');
  return groups;
}
export function sameMacGroups(left: number[], right: number[]): boolean {
  return JSON.stringify([...new Set(left)].sort((a, b) => a - b)) === JSON.stringify([...new Set(right)].sort((a, b) => a - b));
}
async function output(run: DirectoryRunner, file: string, args: string[]): Promise<string> {
  const result = await run(file, args);
  if (result.code !== 0) throw new EdgeError('mac_account_membership_lookup_failed');
  return result.stdout;
}
export async function macAccountGroups(run: DirectoryRunner): Promise<number[]> {
  const record = await output(run, '/usr/bin/dscl', ['.', '-read', '/Users/_daifukuedge', 'GeneratedUID']);
  const ids = [...record.matchAll(/^(?:dsAttrTypeStandard:)?GeneratedUID: ([a-fA-F0-9-]{36})\s*$/gm)];
  const uuid = ids[0]?.[1];
  if (ids.length !== 1 || !uuid || !/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(uuid)) throw new EdgeError('mac_account_guid_invalid');
  for (const [attribute, value] of [['GroupMembership', '_daifukuedge'], ['GroupMembers', uuid], ['NestedGroups', uuid]]) {
    if (!attribute || !value) throw new EdgeError('mac_account_membership_lookup_failed');
    // Apple DSTools search returns eDSNoErr and prints no rows when no records match.
    if ((await output(run, '/usr/bin/dscl', ['/Search', '-search', '/Groups', attribute, value])).trim()) throw new EdgeError('mac_account_explicit_group_membership');
  }
  const groups = numericMacGroups(await output(run, '/usr/bin/id', ['-G', '_daifukuedge']));
  if (groups.some((group) => privilegedMacGroups.has(group))) throw new EdgeError('mac_account_privileged_group_membership');
  return groups;
}
export const nativeDirectoryRunner: DirectoryRunner = async (file, args) => {
  try { const result = await execute(file, args, { timeout: 10000, maxBuffer: 1024 * 1024 }); return { code: 0, ...result }; }
  catch { throw new EdgeError('mac_account_membership_lookup_failed'); }
};
