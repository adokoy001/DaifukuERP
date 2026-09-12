import { z } from 'zod';
const id = z.number().int().min(0).max(4294967295);
export const serviceIdentitySchema = z.object({ uid: id, euid: id, gid: id, egid: id, groups: z.array(id).max(1024) }).strict();
export type ServiceIdentity = z.infer<typeof serviceIdentitySchema>;
export function currentServiceIdentity(): ServiceIdentity | undefined {
  if (!process.getuid || !process.geteuid || !process.getgid || !process.getegid || !process.getgroups) return undefined;
  return { uid: process.getuid(), euid: process.geteuid(), gid: process.getgid(), egid: process.getegid(), groups: process.getgroups() };
}
/** Node getgroups includes the effective GID even when the supplementary list is empty. */
export function isolatedServiceIdentity(value: unknown): value is ServiceIdentity {
  const parsed = serviceIdentitySchema.safeParse(value);
  if (!parsed.success) return false;
  const { uid, euid, gid, egid, groups } = parsed.data;
  return uid >= 400 && uid < 500 && uid === euid && gid > 0 && gid === egid && groups.every((group) => group === gid);
}
export function matchesMacServiceIdentity(platform: string, runtime: { identity?: unknown; groupIsolationRequired?: unknown }, account?: { uid?: number; gid?: number }): boolean {
  if (platform !== 'darwin') return true;
  return runtime.groupIsolationRequired === true && isolatedServiceIdentity(runtime.identity) && runtime.identity.uid === account?.uid && runtime.identity.gid === account?.gid;
}
