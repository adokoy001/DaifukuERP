import { dirname, join, sep } from 'node:path';
import { chmod } from 'node:fs/promises';
import { acquireWriter } from '../src/lock.ts';
import { copyBundle } from './bundle.ts';
import type { VerifiedBundle } from './bundle.ts';
import { prepareConfig, writeConfig } from './configuration.ts';
import type { PreparedConfig } from './configuration.ts';
import { absentOrEmpty, makeDirectory, pathChain, safePath } from './io.ts';
import { contextFor, newInstallation, readInstallation, requireIntent, saveInstallation } from './state.ts';
import type { Installation } from './state.ts';
import type { ServiceAdapter, ServiceContext } from './types.ts';
import { awaitService } from './readiness.ts';
export interface DeployRequest {
  operation: 'install' | 'update';
  bundle: VerifiedBundle;
  installRoot: string;
  statePath: string;
  configSource?: string;
  execute: boolean;
  resume: boolean;
}
interface Deployment {
  marker: Installation;
  context: ServiceContext;
  config?: PreparedConfig;
}
function distinctPaths(root: string, state: string): void {
  const a = process.platform === 'win32' ? root.toLowerCase() : root;
  const b = process.platform === 'win32' ? state.toLowerCase() : state;
  if (a === b || a.startsWith(b + sep) || b.startsWith(a + sep))
    throw new Error('installation_and_state_must_be_separate');
}
async function plan(request: DeployRequest, adapter: ServiceAdapter): Promise<Deployment> {
  const root = safePath(request.installRoot);
  const state = safePath(request.statePath);
  distinctPaths(root, state);
  await pathChain(root, true);
  await pathChain(dirname(state), true);
  await pathChain(state);
  let marker = await readInstallation(root);
  if (!marker) {
    if (request.operation !== 'install') throw new Error('installation_missing');
    await absentOrEmpty(root, ['.setup-lock']);
    await absentOrEmpty(state);
    marker = newInstallation(root, state, request.bundle);
  }
  if (marker.statePath !== state) throw new Error('state_path_change_forbidden');
  requireIntent(marker, request.operation, request.bundle, request.resume);
  if (request.operation === 'install' && marker.status === 'installed' && !marker.pending)
    throw new Error('already_installed_use_update');
  if (request.operation === 'update' && !marker.active) throw new Error('installation_missing');
  if (request.configSource && marker.active) throw new Error('update_preserves_existing_config');
  const config = request.configSource ? await prepareConfig(request.configSource, state) : undefined;
  if (!marker.active && !config) throw new Error('config_file_required');
  if (marker.pending?.configHash && marker.pending.configHash !== config?.hash)
    throw new Error('resume_config_mismatch');
  const context = contextFor(
    root,
    state,
    marker.installationId,
    request.bundle,
    config?.caPath ?? marker.active?.context.caPath,
  );
  let inspection = await adapter.inspect(context);
  if ((inspection.conflicts.length || !inspection.serviceOwned) && marker.active)
    inspection = await adapter.inspect(marker.active.context);
  if (inspection.conflicts.length || (inspection.serviceExists && !inspection.serviceOwned))
    throw new Error('service_registration_conflict');
  return { marker, context, ...(config ? { config } : {}) };
}
async function bootstrap(deployment: Deployment, request: DeployRequest, adapter: ServiceAdapter): Promise<void> {
  await adapter.assertAdministrator();
  if (adapter.prepareRoot) await adapter.prepareRoot(deployment.context);
  else await makeDirectory(deployment.marker.installRoot);
  const { marker, context, config } = deployment;
  if (!marker.pending) {
    marker.pending = {
      operation: request.operation,
      phase: 'prepared',
      target: { releaseId: request.bundle.manifest.releaseId, manifestHash: request.bundle.manifestHash, context },
      ...(marker.active ? { previousContext: marker.active.context } : {}),
      ...(config ? { configHash: config.hash } : {}),
    };
    await saveInstallation(marker);
  }
}
async function execute(deployment: Deployment, request: DeployRequest, adapter: ServiceAdapter): Promise<void> {
  const { marker, context, config } = deployment;
  const pending = marker.pending;
  if (!pending) throw new Error('intent_missing');
  await adapter.prepare(context);
  await copyBundle(request.bundle, context.releaseDir);
  if (config) await writeConfig(config);
  await adapter.protect(context);
  if (pending.phase === 'prepared') {
    pending.phase = 'copied';
    await saveInstallation(marker);
  }
  if (pending.phase === 'copied') {
    const previous = pending.previousContext ?? context;
    const inspection = await adapter.inspect(previous);
    if (inspection.conflicts.length || (inspection.serviceExists && !inspection.serviceOwned))
      throw new Error('service_registration_conflict');
    if (inspection.serviceExists) await adapter.stop(previous);
    pending.phase = 'stopped';
    await saveInstallation(marker);
  }
  if (pending.phase === 'stopped') {
    await adapter.register(context);
    pending.phase = 'registered';
    await saveInstallation(marker);
  }
  const startedAt = Date.now();
  await adapter.start(context);
  await awaitService(context, adapter, startedAt);
  const inspection = await adapter.inspect(context);
  if (!inspection.serviceOwned || !inspection.serviceRunning || inspection.conflicts.length)
    throw new Error('service_start_not_confirmed_resume_required');
  marker.active = pending.target;
  marker.status = 'installed';
  delete marker.pending;
  await saveInstallation(marker);
}
export async function deploy(request: DeployRequest, adapter: ServiceAdapter): Promise<unknown> {
  const deployment = await plan(request, adapter);
  const result = {
    operation: request.operation,
    execute: request.execute,
    service: adapter.serviceId,
    installRoot: deployment.marker.installRoot,
    statePath: deployment.marker.statePath,
    releaseId: request.bundle.manifest.releaseId,
    manifestHash: request.bundle.manifestHash,
    retainsCredentialsAndJournal: true,
  };
  if (!request.execute) return result;
  await adapter.assertAdministrator();
  if (adapter.prepareRoot) await adapter.prepareRoot(deployment.context);
  else await makeDirectory(deployment.marker.installRoot);
  const lockPath = join(deployment.marker.installRoot, '.setup-lock');
  await makeDirectory(lockPath);
  if (process.platform !== 'win32') await chmod(lockPath, 0o700);
  const release = await acquireWriter(lockPath, () => process.exit(1));
  try {
    const fresh = await plan(request, adapter);
    await bootstrap(fresh, request, adapter);
    await execute(fresh, request, adapter);
    return { ...result, status: 'installed' };
  } finally {
    await release();
  }
}
