import type { ServiceContext } from '../types.js';
import type { PosixHost } from './host.js';
import { command } from './host.js';
import { LINUX_SERVICE, ownershipTag, renderSystemd } from './render.js';
import { rootFile } from './security.js';
import { saveDefinition } from './service-files.js';
export const linuxUnitPath = '/etc/systemd/system/' + LINUX_SERVICE;
interface LinuxStatus {
  exists: boolean;
  running: boolean;
  fields: Record<string, string>;
}
export async function linuxStatus(host: PosixHost): Promise<LinuxStatus> {
  const result = await host.run('/usr/bin/systemctl', [
    'show',
    LINUX_SERVICE,
    '--no-pager',
    '--property=LoadState,ActiveState,SubState,FragmentPath,DropInPaths,Transient,NeedDaemonReload,User,Group,MainPID',
  ]);
  const fields = Object.fromEntries(
    result.stdout
      .trim()
      .split('\n')
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
  if (result.code !== 0 && !(result.code === 4 && fields.LoadState === 'not-found'))
    throw new Error('Cannot query the system service manager.');
  if (!fields.LoadState) throw new Error('Unrecognized service manager response.');
  return {
    exists: fields.LoadState !== 'not-found',
    running: ['active', 'reloading'].includes(fields.ActiveState ?? '') && Number(fields.MainPID) > 0,
    fields,
  };
}
function noOverrides(status: LinuxStatus): void {
  if (
    status.exists &&
    (status.fields.FragmentPath !== linuxUnitPath ||
      status.fields.DropInPaths ||
      status.fields.Transient === 'yes' ||
      status.fields.LoadState !== 'loaded')
  )
    throw new Error('An existing service or override conflicts with this installation.');
}
export async function inspectLinuxService(
  host: PosixHost,
  context: ServiceContext,
  group: string,
): Promise<{ exists: boolean; running: boolean; owned: boolean; processId?: number }> {
  const body = await rootFile(host, linuxUnitPath);
  const state = await linuxStatus(host);
  noOverrides(state);
  if (body === null && !state.exists) return { exists: false, running: false, owned: false };
  if (body !== renderSystemd(context, group))
    throw new Error('The registered service definition differs from this installation.');
  if (
    state.exists &&
    ((state.running && state.fields.NeedDaemonReload === 'yes') ||
      state.fields.User !== 'daifuku-edge' ||
      state.fields.Group !== group)
  )
    throw new Error('The loaded service configuration differs from the protected definition.');
  return {
    exists: true,
    running: state.running,
    owned: true,
    ...(state.running ? { processId: Number(state.fields.MainPID) } : {}),
  };
}
export async function registerLinux(host: PosixHost, context: ServiceContext, group: string): Promise<void> {
  const state = await linuxStatus(host);
  noOverrides(state);
  if (state.running || (state.exists && !['inactive', 'failed'].includes(state.fields.ActiveState ?? '')))
    throw new Error('Stop the existing service before changing its definition.');
  const old = await rootFile(host, linuxUnitPath);
  if (state.exists && (!old || !old.includes(ownershipTag(context))))
    throw new Error('Cannot replace an unowned service.');
  await saveDefinition(host, context, LINUX_SERVICE, linuxUnitPath, renderSystemd(context, group));
  await command(host, '/usr/bin/systemctl', ['daemon-reload']);
  await command(host, '/usr/bin/systemctl', ['enable', LINUX_SERVICE]);
}
export async function startLinux(host: PosixHost, context: ServiceContext, group: string): Promise<void> {
  const state = await inspectLinuxService(host, context, group);
  if (!state.owned) throw new Error('No owned service is registered.');
  if (!state.running) {
    if ((await linuxStatus(host)).fields.NeedDaemonReload === 'yes')
      await command(host, '/usr/bin/systemctl', ['daemon-reload']);
    await command(host, '/usr/bin/systemctl', ['start', LINUX_SERVICE]);
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await inspectLinuxService(host, context, group)).running) return;
    await host.wait(250);
  }
  throw new Error('The service did not enter a running state.');
}
export async function stopLinux(host: PosixHost, context: ServiceContext, group: string): Promise<void> {
  const state = await inspectLinuxService(host, context, group);
  if (!state.exists) return;
  await command(host, '/usr/bin/systemctl', ['stop', LINUX_SERVICE]);
  const stopped = await linuxStatus(host);
  if (
    stopped.running ||
    Number(stopped.fields.MainPID) > 0 ||
    !['inactive', 'failed'].includes(stopped.fields.ActiveState ?? '')
  )
    throw new Error('The service is still stopping; its files were preserved.');
}
export async function uninstallLinux(host: PosixHost, context: ServiceContext, group: string): Promise<void> {
  const state = await inspectLinuxService(host, context, group);
  if (!state.exists) return;
  await stopLinux(host, context, group);
  await command(host, '/usr/bin/systemctl', ['disable', LINUX_SERVICE]);
  if ((await rootFile(host, linuxUnitPath)) !== renderSystemd(context, group))
    throw new Error('Service definition changed during removal.');
  await host.remove(linuxUnitPath);
  await command(host, '/usr/bin/systemctl', ['daemon-reload']);
}
