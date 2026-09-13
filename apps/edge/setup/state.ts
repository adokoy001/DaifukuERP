import { z } from 'zod';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { durableJson, jsonFile, safePath } from './io.ts';
import type { ServiceContext, SetupOperation } from './types.ts';
import type { VerifiedBundle } from './bundle.ts';
const contextSchema = z
  .object({
    platform: z.enum(['win32', 'linux', 'darwin']),
    installationId: z.uuid(),
    installRoot: z.string(),
    statePath: z.string(),
    releaseDir: z.string(),
    nodePath: z.string(),
    appPath: z.string(),
    configPath: z.string(),
    logPath: z.string(),
    servicePath: z.string(),
    caPath: z.string().optional(),
  })
  .strict();
const releaseSchema = z
  .object({ releaseId: z.string(), manifestHash: z.string().regex(/^[a-f0-9]{64}$/), context: contextSchema })
  .strict();
const markerSchema = z
  .object({
    format: z.literal(1),
    kind: z.literal('daifuku-edge-installation'),
    installationId: z.uuid(),
    platform: z.enum(['linux', 'darwin', 'win32']),
    arch: z.enum(['x64', 'arm64']),
    installRoot: z.string(),
    statePath: z.string(),
    status: z.enum(['preparing', 'installed', 'uninstalled']),
    active: releaseSchema.optional(),
    pending: z
      .object({
        operation: z.enum(['install', 'update']),
        phase: z.enum(['prepared', 'copied', 'stopped', 'registered']),
        target: releaseSchema,
        previousContext: contextSchema.optional(),
        configHash: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Installation = z.infer<typeof markerSchema>;
export function contextFor(
  root: string,
  state: string,
  installationId: string,
  bundle: VerifiedBundle,
  caPath?: string,
): ServiceContext {
  const releaseDir = join(root, 'releases', bundle.manifest.releaseId + '-' + bundle.manifestHash.slice(0, 16));
  return {
    platform: bundle.manifest.platform,
    installationId,
    installRoot: root,
    statePath: state,
    releaseDir,
    nodePath: join(releaseDir, 'runtime', bundle.manifest.platform === 'win32' ? 'node.exe' : 'node'),
    appPath: join(releaseDir, 'app', 'edge.mjs'),
    configPath: join(state, 'config.json'),
    logPath: join(state, 'logs'),
    servicePath: join(root, 'service'),
    ...(caPath ? { caPath } : {}),
  };
}
export function newInstallation(root: string, state: string, bundle: VerifiedBundle): Installation {
  return {
    format: 1,
    kind: 'daifuku-edge-installation',
    installationId: randomUUID(),
    platform: bundle.manifest.platform,
    arch: bundle.manifest.arch,
    installRoot: root,
    statePath: state,
    status: 'preparing',
  };
}
export async function readInstallation(root: string): Promise<Installation | undefined> {
  const data = await jsonFile(join(root, 'installation.json'));
  if (data === undefined) return undefined;
  const marker = markerSchema.parse(data);
  if (marker.installRoot !== root || marker.platform !== process.platform || marker.arch !== process.arch)
    throw new Error('installation_identity_mismatch');
  for (const release of [marker.active, marker.pending?.target]) {
    if (!release) continue;
    const expected = contextFor(
      root,
      safePath(marker.statePath),
      marker.installationId,
      {
        directory: '',
        manifestHash: release.manifestHash,
        manifest: {
          releaseId: release.releaseId,
          platform: marker.platform,
          arch: marker.arch,
          format: 1,
          kind: 'daifuku-edge-bundle',
          nodeVersion: '22.23.2',
          files: [],
        },
      },
      release.context.caPath,
    );
    if (JSON.stringify(expected) !== JSON.stringify(release.context)) throw new Error('installation_context_mismatch');
    if (release.context.caPath && release.context.caPath !== join(marker.statePath, 'ca-api.pem'))
      throw new Error('installation_ca_mismatch');
  }
  if (
    marker.pending?.previousContext &&
    JSON.stringify(marker.pending.previousContext) !== JSON.stringify(marker.active?.context)
  )
    throw new Error('previous_context_mismatch');
  return marker;
}
export const saveInstallation = (marker: Installation): Promise<void> =>
  durableJson(join(marker.installRoot, 'installation.json'), marker);
export function requireIntent(
  marker: Installation,
  operation: SetupOperation,
  bundle: VerifiedBundle,
  resume: boolean,
): void {
  if (!marker.pending) {
    if (resume) throw new Error('nothing_to_resume');
    return;
  }
  if (!resume || marker.pending.operation !== operation || marker.pending.target.manifestHash !== bundle.manifestHash)
    throw new Error('matching_explicit_resume_required');
}
