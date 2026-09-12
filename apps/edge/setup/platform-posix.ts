import { join } from 'node:path';
import type { ServiceAdapter, ServiceContext, ServiceInspection } from './types.js';
import type { PosixHost } from './posix/host.js';
import type { PosixAccount } from './posix/account-linux.js';
import { nativeHost } from './posix/host.js';
import { inspectLinuxAccount, linuxGroup, prepareLinuxAccount } from './posix/account-linux.js';
import { inspectMacAccount, prepareMacAccount } from './posix/account-mac.js';
import { LINUX_SERVICE, MAC_SERVICE, validateContext } from './posix/render.js';
import { inspectLinuxService, registerLinux, startLinux, stopLinux, uninstallLinux } from './posix/service-linux.js';
import { inspectMacService, registerMac, startMac, stopMac, uninstallMac } from './posix/service-mac.js';
import { prepareDirectories, protectFiles, rootFile, validatePrivateFiles } from './posix/security.js';
export function createPosixAdapter(platform: 'linux' | 'darwin', host: PosixHost = nativeHost(platform)): ServiceAdapter {
  const administrator = async () => { if (host.platform !== platform || host.uid() !== 0) throw new Error('Run this service setup as root on the target operating system.'); };
  const validate = (context: ServiceContext) => { validateContext(context); if (context.platform !== platform) throw new Error('Service platform does not match this adapter.'); };
  const account = (context: ServiceContext, partial = false) => platform === 'linux' ? inspectLinuxAccount(host, context) : inspectMacAccount(host, context, partial);
  const requiredAccount = async (context: ServiceContext): Promise<PosixAccount> => { const result = await account(context); if (!result) throw new Error('The managed service account is missing.'); return result; };
  const ownedMutation = async (context: ServiceContext) => {
    await administrator(); validate(context);
    const raw = await rootFile(host, join(context.installRoot, 'installation.json'));
    if (!raw) throw new Error('A durable installation ownership marker is required.');
    const marker: { installationId?: string; platform?: string; installRoot?: string; statePath?: string } = JSON.parse(raw);
    if (marker.installationId !== context.installationId || marker.platform !== platform || marker.installRoot !== context.installRoot || marker.statePath !== context.statePath) throw new Error('Installation ownership marker does not match the service context.');
  };
  return {
    platform,
    serviceId: platform === 'linux' ? LINUX_SERVICE : MAC_SERVICE,
    defaults: () => platform === 'linux' ? { installRoot: '/opt/daifuku-edge', statePath: '/var/lib/daifuku-edge' } : { installRoot: '/Library/Application Support/DaifukuEdge', statePath: '/Library/Application Support/DaifukuEdgeData' },
    assertAdministrator: administrator,
    inspect: async (context) => {
      const result: ServiceInspection = { serviceExists: false, serviceRunning: false, serviceOwned: false, conflicts: [] };
      try {
        validate(context);
        if (host.uid() !== 0) throw new Error('Root access is required to inspect private service ownership.');
        const owner = await account(context, true);
        const service = platform === 'linux' ? await inspectLinuxService(host, context, owner?.group ?? (await linuxGroup(host)).name) : await inspectMacService(host, context);
        result.serviceExists = service.exists; result.serviceRunning = service.running; result.serviceOwned = service.owned;
        if (service.processId !== undefined) result.processId = service.processId;
        if (owner) {
          result.account = owner;
          const raw = await rootFile(host, join(context.installRoot, 'installation.json'));
          const marker = raw ? JSON.parse(raw) as { installationId?: string; pending?: unknown } : undefined;
          await validatePrivateFiles(host, context, owner, marker?.installationId === context.installationId && Boolean(marker.pending));
        }
        else if (service.exists) throw new Error('Registered service has no verified managed account.');
      } catch (error) { result.serviceOwned = false; result.conflicts.push(error instanceof Error ? error.message : 'Cannot verify service ownership.'); }
      return result;
    },
    prepare: async (context) => {
      await ownedMutation(context);
      const owner = await (platform === 'linux' ? prepareLinuxAccount(host, context) : prepareMacAccount(host, context));
      await prepareDirectories(host, context, owner);
    },
    protect: async (context) => { await ownedMutation(context); await protectFiles(host, context, await requiredAccount(context)); },
    register: async (context) => {
      await ownedMutation(context); const owner = await requiredAccount(context);
      if (platform === 'linux') await registerLinux(host, context, owner.group); else await registerMac(host, context);
    },
    start: async (context) => {
      await ownedMutation(context); const owner = await requiredAccount(context);
      await validatePrivateFiles(host, context, owner);
      if (platform === 'linux') await startLinux(host, context, owner.group); else await startMac(host, context);
    },
    stop: async (context) => {
      await ownedMutation(context); const owner = await requiredAccount(context);
      if (platform === 'linux') await stopLinux(host, context, owner.group); else await stopMac(host, context);
    },
    uninstall: async (context) => {
      await ownedMutation(context); const owner = await requiredAccount(context);
      if (platform === 'linux') await uninstallLinux(host, context, owner.group); else await uninstallMac(host, context);
    },
  };
}
export const linuxAdapter = createPosixAdapter('linux');
export const macAdapter = createPosixAdapter('darwin');
