import type { ServiceContext } from '../types.js';
import type { PosixHost } from './host.js';
import { command } from './host.js';
import { MAC_SERVICE, ownershipTag, renderLaunchDaemon, serviceArguments } from './render.js';
import { rootFile } from './security.js';
import { saveDefinition } from './service-files.js';
export const macPlistPath = '/Library/LaunchDaemons/' + MAC_SERVICE + '.plist';
const target = 'system/' + MAC_SERVICE;
interface MacStatus { loaded: boolean; running: boolean; text: string }
export async function macStatus(host: PosixHost): Promise<MacStatus> {
  const result = await host.run('/bin/launchctl', ['print', target]);
  if (result.code !== 0) {
    if (result.stderr.includes('Could not find service "' + MAC_SERVICE + '"') && result.stderr.includes('system')) return { loaded: false, running: false, text: '' };
    throw new Error('Cannot inspect the system LaunchDaemon.');
  }
  if (!result.stdout.includes(target + ' = {')) throw new Error('Unrecognized LaunchDaemon status.');
  return { loaded: true, running: /^\s*pid = [1-9]\d*$/m.test(result.stdout), text: result.stdout };
}
function property(text: string, name: string): string | undefined {
  const line = text.split('\n').map((part) => part.trim()).find((part) => part.startsWith(name + ' = '));
  return line?.slice(name.length + 3);
}
export function validateLoadedDaemon(text: string, context: ServiceContext): void {
  const args = /(?:^|\n)\s*arguments = \{\n([\s\S]*?)\n\s*\}/.exec(text)?.[1]?.split('\n').map((line) => line.trim()).filter(Boolean);
  if (property(text, 'path') !== macPlistPath || property(text, 'program') !== context.nodePath || property(text, 'username') !== '_daifukuedge' || property(text, 'group') !== 'nobody' || JSON.stringify(args) !== JSON.stringify(serviceArguments(context))) throw new Error('Loaded LaunchDaemon differs from the owned service definition.');
  const ca = property(text, 'NODE_EXTRA_CA_CERTS');
  if (ca !== context.caPath) throw new Error('Loaded LaunchDaemon CA configuration differs from this installation.');
}
export async function inspectMacService(host: PosixHost, context: ServiceContext): Promise<{ exists: boolean; running: boolean; owned: boolean; processId?: number }> {
  const body = await rootFile(host, macPlistPath), state = await macStatus(host);
  if (body === null && !state.loaded) return { exists: false, running: false, owned: false };
  if (body !== renderLaunchDaemon(context)) throw new Error('The registered LaunchDaemon differs from this installation.');
  if (state.loaded) validateLoadedDaemon(state.text, context);
  return { exists: true, running: state.running, owned: true, ...(state.running ? { processId: Number(property(state.text, 'pid')) } : {}) };
}
export async function registerMac(host: PosixHost, context: ServiceContext): Promise<void> {
  const state = await macStatus(host), body = await rootFile(host, macPlistPath);
  if (state.loaded) throw new Error('Boot out the old LaunchDaemon before changing its definition.');
  if (body !== null && !body.includes(ownershipTag(context))) throw new Error('Cannot replace an unowned LaunchDaemon.');
  await saveDefinition(host, context, MAC_SERVICE + '.plist', macPlistPath, renderLaunchDaemon(context));
  await command(host, '/usr/bin/plutil', ['-lint', macPlistPath]);
}
export async function startMac(host: PosixHost, context: ServiceContext): Promise<void> {
  const owned = await inspectMacService(host, context);
  if (!owned.owned) throw new Error('No owned LaunchDaemon is registered.');
  const state = await macStatus(host);
  if (!state.loaded) await command(host, '/bin/launchctl', ['bootstrap', 'system', macPlistPath]);
  else if (!state.running) await command(host, '/bin/launchctl', ['kickstart', target]);
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await inspectMacService(host, context)).running) return;
    await host.wait(250);
  }
  throw new Error('The LaunchDaemon did not enter a running state.');
}
export async function stopMac(host: PosixHost, context: ServiceContext): Promise<void> {
  await inspectMacService(host, context);
  if (!(await macStatus(host)).loaded) return;
  await command(host, '/bin/launchctl', ['bootout', target]);
  for (let attempt = 0; attempt < 120; attempt++) {
    if (!(await macStatus(host)).loaded) return;
    await host.wait(250);
  }
  throw new Error('The LaunchDaemon is still stopping; its files were preserved.');
}
export async function uninstallMac(host: PosixHost, context: ServiceContext): Promise<void> {
  const state = await inspectMacService(host, context);
  if (!state.exists) return;
  await stopMac(host, context);
  if (await rootFile(host, macPlistPath) !== renderLaunchDaemon(context)) throw new Error('LaunchDaemon definition changed during removal.');
  await host.remove(macPlistPath);
}
