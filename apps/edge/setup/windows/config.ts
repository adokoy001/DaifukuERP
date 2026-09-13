import { win32 } from 'node:path';
import type { ServiceContext } from '../types.ts';

export const WINDOWS_SERVICE_ID = 'DaifukuEdge';
export const WINDOWS_SERVICE_SID = 'S-1-5-19';
export function windowsPath(path: string): string {
  if (
    !/^[A-Za-z]:\\/.test(path) ||
    /["%<>|?*]/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) < 32) ||
    path.slice(2).includes(':')
  )
    throw new Error('windows_local_path_required');
  const normalized = win32.normalize(path);
  if (
    normalized
      .split('\\')
      .slice(1)
      .some((part) => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
  )
    throw new Error('windows_local_path_required');
  return normalized;
}
function samePath(actual: string, expected: string): void {
  if (windowsPath(actual).toLowerCase() !== windowsPath(expected).toLowerCase())
    throw new Error('windows_service_path_mismatch');
}
export function validateWindowsContext(context: ServiceContext): void {
  if (context.platform !== 'win32' || !/^[0-9a-f-]{36}$/i.test(context.installationId))
    throw new Error('windows_service_context_invalid');
  const root = windowsPath(context.installRoot),
    state = windowsPath(context.statePath),
    release = windowsPath(context.releaseDir);
  if (
    root.length <= 3 ||
    state.length <= 3 ||
    !release.toLowerCase().startsWith(win32.join(root, 'releases').toLowerCase() + '\\')
  )
    throw new Error('windows_service_path_mismatch');
  if (
    [root.toLowerCase(), state.toLowerCase()].some(
      (path, index, paths) => path === paths[1 - index] || path.startsWith(paths[1 - index] + '\\'),
    )
  )
    throw new Error('windows_service_path_mismatch');
  samePath(context.servicePath, win32.join(root, 'service'));
  samePath(context.nodePath, win32.join(release, 'runtime', 'node.exe'));
  samePath(context.appPath, win32.join(release, 'app', 'edge.mjs'));
  samePath(context.logPath, win32.join(state, 'logs'));
  if (
    !windowsPath(context.configPath)
      .toLowerCase()
      .startsWith(state.toLowerCase() + '\\')
  )
    throw new Error('windows_service_path_mismatch');
  if (
    context.caPath &&
    !windowsPath(context.caPath)
      .toLowerCase()
      .startsWith(state.toLowerCase() + '\\')
  )
    throw new Error('windows_service_path_mismatch');
}
const xml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
const quoted = (value: string): string => `"${windowsPath(value).replace(/\\+$/, (slashes) => slashes + slashes)}"`;
export function windowsServiceXml(context: ServiceContext): string {
  validateWindowsContext(context);
  const argumentsText = `${quoted(context.appPath)} service --config ${quoted(context.configPath)} --state ${quoted(context.statePath)}`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<service>',
    `  <id>${WINDOWS_SERVICE_ID}</id>`,
    '  <name>Daifuku Edge</name>',
    `  <description>Daifuku Edge installation ${context.installationId}</description>`,
    `  <executable>${xml(windowsPath(context.nodePath))}</executable>`,
    `  <arguments>${xml(argumentsText)}</arguments>`,
    `  <workingdirectory>${xml(windowsPath(context.releaseDir))}</workingdirectory>`,
    '  <serviceaccount><domain>NT AUTHORITY</domain><user>LocalService</user></serviceaccount>',
    '  <startmode>Automatic</startmode>',
    '  <delayedAutoStart>true</delayedAutoStart>',
    '  <stoptimeout>30sec</stoptimeout>',
    '  <onfailure action="restart" delay="10 sec"/>',
    '  <resetfailure>1 hour</resetfailure>',
    `  <logpath>${xml(windowsPath(context.logPath))}</logpath>`,
    '  <log mode="roll-by-size"><sizeThreshold>1024</sizeThreshold><keepFiles>4</keepFiles></log>',
    // Erase inherited Node injection flags; an optional CA is scoped to this service.
    '  <env name="NODE_OPTIONS" value=""/>',
    '  <env name="NODE_PATH" value=""/>',
    ...(context.caPath ? [`  <env name="NODE_EXTRA_CA_CERTS" value="${xml(windowsPath(context.caPath))}"/>`] : []),
    '</service>',
    '',
  ].join('\n');
}
