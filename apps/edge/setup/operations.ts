import { join } from 'node:path';
import { rename } from 'node:fs/promises';
import { z } from 'zod';
import { edgeSecret } from '@daifuku/mod-edge-integration/contract';
import { matchesMacServiceIdentity, serviceIdentitySchema } from '../src/service-identity.ts';
import { acquireWriter } from '../src/lock.ts';
import { digest, exclusiveWrite, jsonFile, pathChain, readRegular, safePath, syncDirectory } from './io.ts';
import { windowsDurablePublish } from './windows/durable.ts';
import { readPrivateSource } from './source.ts';
import { readInstallation, saveInstallation } from './state.ts';
import type { ServiceAdapter, SetupOperation } from './types.ts';
const pairingSchema = z.object({ pairingToken: edgeSecret }).strict();
const statusSchema = z
  .object({
    pid: z.number().int().positive(),
    phase: z.enum(['pairing_required', 'connecting', 'running', 'credential_rejected', 'stopped', 'error']),
    observedAt: z.string().datetime(),
    unprivilegedIdentityRequired: z.boolean().optional(),
    unprivilegedIdentityVerified: z.boolean().optional(),
    identity: serviceIdentitySchema.optional(),
  })
  .strict();
export interface OperationRequest {
  operation: Exclude<SetupOperation, 'install' | 'update'>;
  installRoot: string;
  execute: boolean;
  pairingSource?: string;
}
async function inspect(request: OperationRequest, adapter: ServiceAdapter) {
  const root = safePath(request.installRoot);
  await pathChain(root, true);
  const marker = await readInstallation(root);
  const context = marker?.pending?.target.context ?? marker?.active?.context;
  if (!marker || !context) throw new Error('installation_missing');
  if (marker.pending && request.operation !== 'status') throw new Error('pending_operation_resume_required');
  let service = await adapter.inspect(context);
  if (marker.pending && marker.active && service.conflicts.length)
    service = await adapter.inspect(marker.active.context);
  if (request.operation !== 'status' && (service.conflicts.length || (service.serviceExists && !service.serviceOwned)))
    throw new Error('service_registration_conflict');
  return { marker, context, service };
}
export async function operate(request: OperationRequest, adapter: ServiceAdapter): Promise<unknown> {
  const initial = await inspect(request, adapter);
  const output = {
    operation: request.operation,
    execute: request.execute,
    service: adapter.serviceId,
    ...initial.service,
    statePath: initial.context.statePath,
    dataRetained: true,
    pendingPhase: initial.marker.pending?.phase ?? null,
  };
  if (request.operation === 'status') {
    const raw = await jsonFile(join(initial.context.statePath, 'service-status.json'));
    const status = statusSchema.safeParse(raw);
    const age = status.success ? Date.now() - Date.parse(status.data.observedAt) : -1;
    return {
      ...output,
      runtime: status.success ? status.data : null,
      runtimeStatusFresh:
        status.success &&
        matchesMacServiceIdentity(initial.context.platform, status.data, initial.service.account) &&
        initial.service.serviceOwned &&
        initial.service.conflicts.length === 0 &&
        initial.service.serviceRunning &&
        initial.service.processId === status.data.pid &&
        age >= 0 &&
        age < 90000,
    };
  }
  const pairing =
    request.operation === 'pair' && request.pairingSource
      ? pairingSchema.parse(JSON.parse((await readPrivateSource(request.pairingSource, 8192)).toString('utf8')))
      : undefined;
  if (request.operation === 'pair' && !pairing) throw new Error('pairing_file_required');
  if (!request.execute) return output;
  await adapter.assertAdministrator();
  const release = await acquireWriter(join(initial.context.installRoot, '.setup-lock'), () => process.exit(1));
  try {
    const { marker, context, service } = await inspect(request, adapter);
    if (request.operation === 'uninstall') {
      if (service.serviceExists) await adapter.uninstall(context);
      marker.status = 'uninstalled';
      await saveInstallation(marker);
    } else if (!service.serviceExists) throw new Error('service_missing_reinstall_required');
    else if (request.operation === 'stop') await adapter.stop(context);
    else if (request.operation === 'start') await adapter.start(context);
    else if (request.operation === 'pair' && pairing) {
      const target = join(context.statePath, 'pairing.json'),
        staging = join(context.statePath, 'pairing.incoming.json'),
        data = JSON.stringify(pairing);
      if ((await jsonFile(target)) !== undefined) throw new Error('pairing_already_queued');
      try {
        await exclusiveWrite(staging, data);
      } catch (error) {
        if (
          !(error instanceof Error && 'code' in error && error.code === 'EEXIST') ||
          digest(await readRegular(staging, 8192)) !== digest(data)
        )
          throw error;
      }
      await adapter.protect(context);
      if (process.platform === 'win32') await windowsDurablePublish(staging, target);
      else await rename(staging, target);
      await syncDirectory(context.statePath);
    }
    return { ...output, status: request.operation === 'pair' ? 'pairing_queued_check_status' : 'completed' };
  } finally {
    await release();
  }
}
