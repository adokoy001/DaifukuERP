import { win32 } from 'node:path';
import type { ServiceAdapter, ServiceContext, ServiceInspection } from './types.ts';
import { WINDOWS_SERVICE_ID, windowsServiceXml, validateWindowsContext } from './windows/config.ts';
import { runWindowsSetup, type WindowsRunner } from './windows/runner.ts';
import type { WindowsSetupOperation } from './windows/script.ts';

function inspection(value: unknown): ServiceInspection {
  if (!value || typeof value !== 'object') throw new Error('windows_service_output_invalid');
  const row = value as Record<string, unknown>;
  if (
    typeof row.serviceExists !== 'boolean' ||
    typeof row.serviceRunning !== 'boolean' ||
    typeof row.serviceOwned !== 'boolean' ||
    !Array.isArray(row.conflicts) ||
    row.conflicts.some((v: unknown) => typeof v !== 'string')
  )
    throw new Error('windows_service_output_invalid');
  if (row.processId !== undefined && (!Number.isSafeInteger(row.processId) || Number(row.processId) <= 0))
    throw new Error('windows_service_output_invalid');
  return {
    serviceExists: row.serviceExists,
    serviceRunning: row.serviceRunning,
    serviceOwned: row.serviceOwned,
    conflicts: row.conflicts,
    ...(typeof row.processId === 'number' ? { processId: row.processId } : {}),
    account: { name: 'NT AUTHORITY\\LocalService', sid: 'S-1-5-19' },
  };
}
export function createWindowsAdapter(run: WindowsRunner = runWindowsSetup): ServiceAdapter {
  const call = async (operation: WindowsSetupOperation, context: ServiceContext): Promise<unknown> => {
    validateWindowsContext(context);
    return run(operation, context, windowsServiceXml(context));
  };
  return {
    platform: 'win32',
    serviceId: WINDOWS_SERVICE_ID,
    defaults: () => ({
      installRoot: win32.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'DaifukuEdge'),
      statePath: win32.join(process.env.ProgramData ?? 'C:\\ProgramData', 'DaifukuEdge'),
    }),
    inspect: async (context) => inspection(await call('inspect', context)),
    assertAdministrator: async () => {
      await run('administrator');
    },
    prepareRoot: async (context) => {
      await call('prepareRoot', context);
    },
    prepare: async (context) => {
      await call('prepare', context);
    },
    protect: async (context) => {
      await call('protect', context);
    },
    register: async (context) => {
      await call('register', context);
    },
    start: async (context) => {
      await call('start', context);
    },
    stop: async (context) => {
      await call('stop', context);
    },
    uninstall: async (context) => {
      await call('uninstall', context);
    },
  };
}
export const windowsAdapter = createWindowsAdapter();
