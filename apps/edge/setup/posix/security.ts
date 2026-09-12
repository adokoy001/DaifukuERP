import { dirname, join } from 'node:path';
import type { ServiceContext } from '../types.js';
import type { PosixAccount } from './account-linux.js';
import type { FileInfo, PosixHost } from './host.js';
import { command } from './host.js';
export async function noAcl(host: PosixHost, path: string): Promise<void> {
  if (host.platform !== 'darwin') return;
  const listing = await command(host, '/bin/ls', ['-lde', path]);
  if (/^[bcdlps-][rwxStTs-]{9}\+/m.test(listing) || /^\s*\d+: /m.test(listing)) throw new Error('Extended ACLs are not permitted on managed service paths.');
}
export function ordinary(info: FileInfo | null, kind: 'file' | 'directory'): asserts info is FileInfo {
  if (!info || info.kind !== kind || (kind === 'file' && info.links !== 1)) throw new Error('Managed paths must be ordinary files/directories without links.');
}
export async function rootParents(host: PosixHost, path: string): Promise<void> {
  for (let current = dirname(path); ; current = dirname(current)) {
    const info = await host.stat(current); ordinary(info, 'directory');
    if (info.uid !== 0 || (info.mode & 0o022)) throw new Error('Service path parent must be root-owned and not writable by other accounts.');
    await noAcl(host, current);
    if (current === '/') break;
  }
}
export async function rootFile(host: PosixHost, path: string): Promise<string | null> {
  const info = await host.stat(path);
  if (!info) return null;
  ordinary(info, 'file');
  if (info.uid !== 0 || (info.mode & 0o022)) throw new Error('Service definition is not protected by root ownership.');
  await noAcl(host, path);
  return host.read(path);
}
export async function createDirectory(host: PosixHost, path: string, owner: PosixAccount | null): Promise<void> {
  const existing = await host.stat(path);
  if (existing) {
    ordinary(existing, 'directory');
    if (existing.uid !== (owner?.uid ?? 0) || (existing.mode & (owner ? 0o077 : 0o022))) throw new Error('Existing directory has unexpected ownership or permissions.');
    await noAcl(host, path); return;
  }
  await rootParents(host, path);
  await host.mkdir(path, owner ? 0o700 : 0o755);
  if (host.platform === 'darwin') await command(host, '/bin/chmod', ['-N', path]);
  await host.chown(path, owner?.uid ?? 0, owner?.gid ?? 0);
}
async function privateFile(host: PosixHost, path: string, owner: PosixAccount, newManagement: boolean, readOnly = false): Promise<void> {
  const info = await host.stat(path); ordinary(info, 'file');
  if (newManagement && info.uid === 0) {
    if (readOnly) { if (info.mode & 0o077) throw new Error('Pending private management file is not private.'); await noAcl(host, path); return; }
    // Engine creates these management files exclusively. Never repair arbitrary existing journal files.
    if (host.platform === 'darwin') await command(host, '/bin/chmod', ['-N', path]);
    await host.chmod(path, 0o600); await host.chown(path, owner.uid, owner.gid); return;
  }
  if (info.uid !== owner.uid || (info.mode & 0o077)) throw new Error('Existing private data ownership or permissions changed.');
  await noAcl(host, path);
}
async function privateTree(host: PosixHost, path: string, owner: PosixAccount, management: Set<string>, readOnly = false): Promise<void> {
  const info = await host.stat(path); ordinary(info, 'directory');
  if (info.uid !== owner.uid || (info.mode & 0o077)) throw new Error('Private directory ownership or permissions changed.');
  await noAcl(host, path);
  for (const name of await host.list(path)) {
    const item = join(path, name), child = await host.stat(item);
    if (child?.kind === 'directory') await privateTree(host, item, owner, management, readOnly);
    else await privateFile(host, item, owner, management.has(item), readOnly);
  }
}
async function immutableTree(host: PosixHost, path: string, nodePath: string): Promise<void> {
  const info = await host.stat(path);
  if (!info || !['file', 'directory'].includes(info.kind) || info.uid !== 0 || (info.mode & 0o022) || (info.kind === 'file' && info.links !== 1)) throw new Error('Release code must be root-owned ordinary files without links.');
  await noAcl(host, path);
  await host.chmod(path, info.kind === 'directory' || path === nodePath ? 0o755 : 0o644);
  if (info.kind === 'directory') for (const name of await host.list(path)) await immutableTree(host, join(path, name), nodePath);
}
export async function prepareDirectories(host: PosixHost, context: ServiceContext, owner: PosixAccount): Promise<void> {
  await createDirectory(host, context.servicePath, null);
  await createDirectory(host, context.statePath, owner);
  // state is private and service-owned, so this child has a different parent policy.
  const logs = await host.stat(context.logPath);
  if (!logs) {
    await host.mkdir(context.logPath, 0o700);
    if (host.platform === 'darwin') await command(host, '/bin/chmod', ['-N', context.logPath]);
    await host.chown(context.logPath, owner.uid, owner.gid);
  }
  const checkedLogs = await host.stat(context.logPath); ordinary(checkedLogs, 'directory');
  if (checkedLogs.uid !== owner.uid || (checkedLogs.mode & 0o077)) throw new Error('Log directory is not private service data.');
  await noAcl(host, context.logPath);
  const logFile = join(context.logPath, 'service.log');
  if (!(await host.stat(logFile))) { await host.write(logFile, '', 0o600); await host.chown(logFile, owner.uid, owner.gid); }
}
export async function protectFiles(host: PosixHost, context: ServiceContext, owner: PosixAccount): Promise<void> {
  await rootParents(host, context.installRoot);
  const install = await host.stat(context.installRoot); ordinary(install, 'directory');
  if (install.uid !== 0 || (install.mode & 0o022)) throw new Error('Installation root is not immutable to the service account.');
  await noAcl(host, context.installRoot);
  await host.chmod(context.installRoot, 0o755);
  await rootParents(host, context.releaseDir);
  const releases = join(context.installRoot, 'releases');
  const releasesInfo = await host.stat(releases); ordinary(releasesInfo, 'directory');
  if (releasesInfo.uid !== 0 || (releasesInfo.mode & 0o022)) throw new Error('Releases directory must be root-owned.');
  await noAcl(host, releases); await host.chmod(releases, 0o755);
  await immutableTree(host, context.releaseDir, context.nodePath);
  const caFiles = (await host.list(context.statePath)).filter((name) => /^ca-(?:api|[a-f0-9-]{36})\.pem$/.test(name)).map((name) => join(context.statePath, name));
  await privateTree(host, context.statePath, owner, new Set([context.configPath, join(context.statePath, 'pairing.json'), join(context.statePath, 'pairing.incoming.json'), ...caFiles, ...(context.caPath ? [context.caPath] : [])]));
}
export async function validatePrivateFiles(host: PosixHost, context: ServiceContext, owner: PosixAccount, pending = false): Promise<void> {
  if (!(await host.stat(context.statePath))) return;
  const caFiles = (await host.list(context.statePath)).filter((name) => /^ca-(?:api|[a-f0-9-]{36})\.pem$/.test(name)).map((name) => join(context.statePath, name));
  const management = new Set([join(context.statePath, 'pairing.incoming.json'), ...(pending ? [context.configPath, ...caFiles] : [])]);
  await privateTree(host, context.statePath, owner, management, true);
}
