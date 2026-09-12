import { isAbsolute, join, normalize, relative } from 'node:path';
import type { ServiceContext } from '../types.js';
export const LINUX_SERVICE = 'daifuku-edge.service';
export const MAC_SERVICE = 'jp.daifuku.edge';
export function ownershipTag(context: ServiceContext): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(context.installationId)) throw new Error('Invalid installation identifier.');
  return 'Daifuku edge installer ' + context.installationId;
}
export function validateContext(context: ServiceContext): void {
  ownershipTag(context);
  for (const path of [context.installRoot, context.statePath, context.releaseDir, context.nodePath, context.appPath, context.configPath, context.logPath, context.servicePath, ...(context.caPath ? [context.caPath] : [])]) {
    if (!isAbsolute(path) || normalize(path) !== path || !/^\/[a-zA-Z0-9_./ -]+$/.test(path) || path.includes('/../') || path.includes('/./') || path.endsWith('/')) throw new Error('Use a normalized absolute service path without control characters or shell syntax.');
  }
  const inside = (parent: string, child: string) => { const path = relative(parent, child); return path !== '' && !path.startsWith('..') && !isAbsolute(path); };
  if (context.installRoot === context.statePath || inside(context.installRoot, context.statePath) || inside(context.statePath, context.installRoot) || !inside(join(context.installRoot, 'releases'), context.releaseDir) || context.nodePath !== join(context.releaseDir, 'runtime/node') || context.appPath !== join(context.releaseDir, 'app/edge.mjs') || context.servicePath !== join(context.installRoot, 'service') || context.configPath !== join(context.statePath, 'config.json') || context.logPath !== join(context.statePath, 'logs') || (context.caPath && context.caPath !== join(context.statePath, 'ca-api.pem'))) throw new Error('Service paths do not follow the immutable release/private state layout.');
}
const quote = (value: string) => '"' + value + '"';
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function serviceArguments(context: ServiceContext): string[] {
  validateContext(context);
  return [context.nodePath, context.appPath, 'service', '--config', context.configPath, '--state', context.statePath];
}
export function renderSystemd(context: ServiceContext, group: string): string {
  const args = serviceArguments(context);
  if (!['nogroup', 'nobody'].includes(group)) throw new Error('Invalid unprivileged service group.');
  return [`# ${ownershipTag(context)}`, '[Unit]', 'Description=Daifuku outbound LAN relay', 'Wants=network-online.target', 'After=network-online.target', '', '[Service]', 'Type=simple', 'User=daifuku-edge', `Group=${group}`, 'UMask=0077', `ExecStart=${args.map(quote).join(' ')}`, `WorkingDirectory=${quote(context.statePath)}`, ...(context.caPath ? [`Environment="NODE_EXTRA_CA_CERTS=${context.caPath}"`] : []), 'Restart=on-failure', 'RestartSec=15', 'TimeoutStopSec=30', 'KillMode=control-group', 'NoNewPrivileges=true', 'PrivateTmp=true', 'ProtectSystem=strict', 'ProtectHome=true', `ReadWritePaths=${quote(context.statePath)}`, 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6', 'LimitNOFILE=256', 'MemoryMax=256M', 'StandardOutput=journal', 'StandardError=journal', '', '[Install]', 'WantedBy=multi-user.target', ''].join('\n');
}
export function renderLaunchDaemon(context: ServiceContext): string {
  const args = serviceArguments(context);
  const string = (value: string) => `<string>${xml(value)}</string>`;
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">', `<plist version="1.0"><dict><!-- ${ownershipTag(context)} -->`, '<key>Label</key>' + string(MAC_SERVICE), '<key>UserName</key>' + string('_daifukuedge'), '<key>GroupName</key>' + string('nobody'), '<key>ProgramArguments</key><array>' + args.map(string).join('') + '</array>', '<key>WorkingDirectory</key>' + string(context.statePath), '<key>RunAtLoad</key><true/>', '<key>KeepAlive</key><true/>', '<key>ThrottleInterval</key><integer>15</integer>', '<key>ExitTimeOut</key><integer>30</integer>', '<key>Umask</key><integer>63</integer>', '<key>ProcessType</key>' + string('Background'), '<key>StandardOutPath</key>' + string(context.logPath + '/service.log'), '<key>StandardErrorPath</key>' + string(context.logPath + '/service.log'), ...(context.caPath ? ['<key>EnvironmentVariables</key><dict><key>NODE_EXTRA_CA_CERTS</key>' + string(context.caPath) + '</dict>'] : []), '</dict></plist>', ''].join('\n');
}
