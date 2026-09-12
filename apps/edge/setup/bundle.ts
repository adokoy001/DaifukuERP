import { readdir, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { digest, exclusiveWrite, makeDirectory, readRegular } from './io.ts';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const manifestSchema = z.object({
  format: z.literal(1), kind: z.literal('daifuku-edge-bundle'), releaseId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/),
  platform: z.enum(['linux', 'darwin', 'win32']), arch: z.enum(['x64', 'arm64']), nodeVersion: z.literal('22.23.2'),
  files: z.array(z.object({ path: z.string().regex(/^[a-zA-Z0-9._/-]+$/), sha256: hash, bytes: z.number().int().positive().max(200_000_000), executable: z.boolean() }).strict()).min(5).max(50),
}).strict();
export type BundleManifest = z.infer<typeof manifestSchema>;
export interface VerifiedBundle { directory: string; manifest: BundleManifest; manifestHash: string }
async function inventory(directory: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) out.push(...await inventory(directory, path + '/'));
    else if (entry.isFile()) out.push(path); else throw new Error('bundle_links_forbidden');
  }
  return out.sort();
}
export async function verifyBundle(directory: string, expectedHash: string, platform = process.platform, arch = process.arch): Promise<VerifiedBundle> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('expected_manifest_sha256_required');
  const raw = await readRegular(join(directory, 'manifest.json')); if (digest(raw) !== expectedHash) throw new Error('manifest_hash_mismatch');
  const manifest = manifestSchema.parse(JSON.parse(raw.toString('utf8')));
  if (manifest.platform !== platform || manifest.arch !== arch) throw new Error('bundle_platform_mismatch');
  const paths = manifest.files.map((file) => file.path);
  if (new Set(paths).size !== paths.length || paths.some((path) => path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..'))) throw new Error('unsafe_bundle_entry');
  const required = ['runtime/' + (platform === 'win32' ? 'node.exe' : 'node'), 'app/edge.mjs', 'setup/setup.mjs', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'];
  if (platform === 'win32') required.push('wrapper/WinSW.NET461.exe', 'wrapper/LICENSE');
  if (required.some((path) => !paths.includes(path))) throw new Error('incomplete_bundle');
  if (JSON.stringify(await inventory(directory)) !== JSON.stringify([...paths, 'manifest.json'].sort())) throw new Error('unexpected_bundle_file');
  for (const file of manifest.files) { const bytes = await readRegular(join(directory, file.path), file.bytes); if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('bundle_file_hash_mismatch'); }
  return { directory, manifest, manifestHash: expectedHash };
}
/** Partial copies are resumable only when every existing byte still matches the verified artifact. */
export async function copyBundle(bundle: VerifiedBundle, destination: string): Promise<void> {
  await makeDirectory(destination);
  for (const file of bundle.manifest.files) {
    const target = join(destination, file.path); await makeDirectory(dirname(target)); const data = await readRegular(join(bundle.directory, file.path), file.bytes);
    if (digest(data) !== file.sha256) throw new Error('bundle_changed_during_copy');
    try { await exclusiveWrite(target, data, file.executable ? 0o755 : 0o644); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST') || digest(await readRegular(target, file.bytes)) !== file.sha256) throw error; }
    if (process.platform !== 'win32') await chmod(target, file.executable ? 0o755 : 0o644);
  }
}
