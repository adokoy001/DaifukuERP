import { X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { parseConfig } from '../src/config.ts';
import { readPrivateSource } from './source.ts';
import { digest, exclusiveWrite, readRegular } from './io.ts';
export interface PreparedConfig {
  files: { path: string; data: Buffer }[];
  hash: string;
  caPath?: string;
}
export async function prepareConfig(source: string, statePath: string): Promise<PreparedConfig> {
  const config = parseConfig(JSON.parse((await readPrivateSource(source, 65536)).toString('utf8')));
  if (config.syntheticLoopbackTest) throw new Error('service_requires_https');
  const files: PreparedConfig['files'] = [];
  async function ca(sourcePath: string, name: string): Promise<string> {
    const data = await readRegular(sourcePath, 1000000);
    if (data.toString().includes('PRIVATE KEY')) throw new Error('ca_certificate_only');
    const certificates = data.toString().match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!certificates?.length || certificates.some((pem) => !new X509Certificate(pem).ca))
      throw new Error('invalid_ca_bundle');
    const path = join(statePath, name);
    files.push({ path, data });
    return path;
  }
  if (config.caFile) config.caFile = await ca(config.caFile, 'ca-api.pem');
  for (const device of config.devices)
    if (device.driver === 'ipp_text' && device.caFile)
      device.caFile = await ca(device.caFile, 'ca-' + device.deviceId + '.pem');
  files.push({ path: join(statePath, 'config.json'), data: Buffer.from(JSON.stringify(config, null, 2) + '\n') });
  return {
    files,
    hash: digest(JSON.stringify(files.map((file) => [file.path, digest(file.data)]))),
    ...(config.caFile ? { caPath: config.caFile } : {}),
  };
}
export async function writeConfig(config: PreparedConfig): Promise<void> {
  for (const file of config.files) {
    try {
      await exclusiveWrite(file.path, file.data);
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'EEXIST') ||
        digest(await readRegular(file.path)) !== digest(file.data)
      )
        throw error;
    }
  }
}
