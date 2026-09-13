import { z } from 'zod';
import { privilegedMacGroups, sameMacGroups } from './macos-membership.ts';
const id = z.number().int().min(0).max(4294967295);
export const serviceIdentitySchema = z
  .object({ uid: id, euid: id, gid: id, egid: id, groups: z.array(id).max(1024) })
  .strict();
export type ServiceIdentity = z.infer<typeof serviceIdentitySchema>;
export function currentServiceIdentity(): ServiceIdentity | undefined {
  if (!process.getuid || !process.geteuid || !process.getgid || !process.getegid || !process.getgroups)
    return undefined;
  return {
    uid: process.getuid(),
    euid: process.geteuid(),
    gid: process.getgid(),
    egid: process.getegid(),
    groups: process.getgroups(),
  };
}
/** OS-calculated ordinary memberships are permitted; administrative capabilities are rejected. */
export function unprivilegedServiceIdentity(value: unknown): value is ServiceIdentity {
  const parsed = serviceIdentitySchema.safeParse(value);
  if (!parsed.success) return false;
  const { uid, euid, gid, egid, groups } = parsed.data;
  return (
    uid >= 400 &&
    uid < 500 &&
    uid === euid &&
    gid > 0 &&
    gid === egid &&
    groups.includes(gid) &&
    groups.every((group) => !privilegedMacGroups.has(group))
  );
}
export function matchesMacServiceIdentity(
  platform: string,
  runtime: { identity?: unknown; unprivilegedIdentityRequired?: unknown; unprivilegedIdentityVerified?: unknown },
  account?: { uid?: number; gid?: number; groups?: number[] },
): boolean {
  if (platform !== 'darwin') return true;
  return (
    runtime.unprivilegedIdentityRequired === true &&
    runtime.unprivilegedIdentityVerified === true &&
    unprivilegedServiceIdentity(runtime.identity) &&
    runtime.identity.uid === account?.uid &&
    runtime.identity.gid === account?.gid &&
    Array.isArray(account?.groups) &&
    sameMacGroups(runtime.identity.groups, account.groups)
  );
}
