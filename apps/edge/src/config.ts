import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { EdgeError } from './errors.ts';
import { readPrivateJson } from './files.ts';
const localId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const file = z.string().refine(isAbsolute);
const device = z.discriminatedUnion('driver', [
  z
    .object({
      deviceId: z.uuid(),
      localDeviceId: localId,
      driver: z.literal('ipp_text'),
      printerUri: z.string(),
      caFile: file.optional(),
    })
    .strict(),
  z
    .object({
      deviceId: z.uuid(),
      localDeviceId: localId,
      driver: z.literal('simulator'),
      simulationConfirmed: z.literal(true),
    })
    .strict(),
]);
export const configSchema = z
  .object({
    apiBaseUrl: z.string(),
    caFile: file.optional(),
    syntheticLoopbackTest: z.boolean().default(false),
    requestTimeoutMs: z.number().int().min(100).max(30000).default(10000),
    printWaitMs: z.number().int().min(100).max(300000).default(60000),
    devices: z.array(device).max(100),
  })
  .strict();
export type EdgeConfig = z.infer<typeof configSchema>;
export type DeviceConfig = EdgeConfig['devices'][number];
export function validateUrl(raw: string, protocols: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EdgeError('invalid_endpoint');
  }
  if (!protocols.includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new EdgeError('invalid_endpoint');
  return url;
}
export const loopback = (url: URL): boolean => ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
export function parseConfig(value: unknown): EdgeConfig {
  const result = configSchema.safeParse(value);
  if (!result.success) throw new EdgeError('invalid_config');
  const config = result.data;
  const url = validateUrl(config.apiBaseUrl, ['https:', 'http:']);
  if (config.syntheticLoopbackTest && (process.env['DAIFUKU_EDGE_SYNTHETIC_TEST'] !== '1' || !loopback(url)))
    throw new EdgeError('synthetic_test_not_allowed');
  if (url.protocol !== 'https:' && !config.syntheticLoopbackTest) throw new EdgeError('https_required');
  if (
    new Set(config.devices.map((row) => row.deviceId)).size !== config.devices.length ||
    new Set(config.devices.map((row) => row.localDeviceId)).size !== config.devices.length
  )
    throw new EdgeError('duplicate_local_device');
  for (const row of config.devices) if (row.driver === 'ipp_text') validateUrl(row.printerUri, ['ipp:', 'ipps:']);
  return config;
}
export const loadConfig = async (path: string): Promise<EdgeConfig> => parseConfig(await readPrivateJson(path, 65536));
export function deviceBindingHash(config: EdgeConfig, deviceId: string): string {
  return createHash('sha256')
    .update(JSON.stringify(config.devices.filter((row) => row.deviceId === deviceId)))
    .digest('hex');
}
