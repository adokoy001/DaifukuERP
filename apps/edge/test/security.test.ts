import { describe, expect, it } from 'vitest';
import { mkdtemp, chmod, readFile, writeFile, symlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, loadConfig } from '../src/config.ts';
import { syncJson, readPrivateJson } from '../src/files.ts';
import { acquireWriter } from '../src/lock.ts';
import { Credentials } from '../src/credentials.ts';
import { relayFixture, secret } from './fixtures.ts';
describe('edge local trust boundary', () => {
  it('requires verified HTTPS and rejects credentials in URLs, duplicate devices and unconfirmed simulators', () => {
    for (const apiBaseUrl of [
      'http://erp.example/api',
      'https://erp.example/api?access_token=secret',
      'https://user:secret@erp.example/api',
      'https://erp.example/api#secret',
    ])
      expect(() => parseConfig({ apiBaseUrl, devices: [] })).toThrow();
    expect(() =>
      parseConfig({ apiBaseUrl: 'https://erp.example', syntheticLoopbackTest: true, devices: [] }),
    ).toThrow();
    expect(() =>
      parseConfig({ apiBaseUrl: 'https://erp.example', devices: [{ deviceId: 'bad', driver: 'simulator' }] }),
    ).toThrow();
  });
  it('atomically persists private files and rejects world-readable or symlinked inputs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edge-private-'));
    await chmod(directory, 0o700);
    try {
      const file = join(directory, 'config.json');
      await syncJson(file, { apiBaseUrl: 'https://erp.example', devices: [] });
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect((await loadConfig(file)).apiBaseUrl).toBe('https://erp.example');
      const link = join(directory, 'link.json');
      await symlink(file, link);
      await expect(readPrivateJson(link)).rejects.toThrow();
      await chmod(file, 0o644);
      await expect(loadConfig(file)).rejects.toThrow();
      await chmod(file, 0o600);
      await writeFile(file, '{');
      await expect(loadConfig(file)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('holds an operating-system writer lock and releases it without stale-file takeover', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edge-lock-'));
    await chmod(directory, 0o700);
    let lost = false;
    try {
      const release = await acquireWriter(directory, () => {
        lost = true;
      });
      await expect(acquireWriter(directory, () => undefined)).rejects.toMatchObject({
        code: 'another_agent_is_running',
      });
      await release();
      const again = await acquireWriter(directory, () => undefined);
      await again();
      expect(lost).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('recovers pairing and rotation response loss with the already persisted new secret', async () => {
    const relay = await relayFixture();
    try {
      const config = relay.config(),
        credentials = await Credentials.open(relay.directory, config);
      relay.state.pairLost = true;
      await expect(credentials.pair(relay.state.pairing)).rejects.toThrow();
      const pending = JSON.parse(await readFile(join(relay.directory, 'credentials.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(pending['pending']).toBe(relay.state.credential);
      expect(pending['current']).toBeUndefined();
      const recovered = await Credentials.open(relay.directory, config);
      await recovered.session();
      expect(recovered.authorization()).toBe(relay.state.credential);
      relay.state.rotateLost = true;
      await expect(recovered.rotate()).rejects.toThrow();
      const rotated = await Credentials.open(relay.directory, config);
      const session = await rotated.session();
      expect(session.credentialVersion).toBe(2);
      expect(rotated.authorization()).toBe(relay.state.credential);
      const saved = JSON.parse(await readFile(join(relay.directory, 'credentials.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(saved['pending']).toBeUndefined();
      expect(saved['rotationId']).toBeUndefined();
      await expect(
        Credentials.open(relay.directory, { ...config, apiBaseUrl: 'https://other.example' }),
      ).rejects.toMatchObject({ code: 'credential_endpoint_mismatch' });
    } finally {
      await relay.close();
    }
  });
  it('rejects unknown TLS roots and revoked credentials without disclosing the secret', async () => {
    const relay = await relayFixture();
    try {
      const config = relay.config(),
        credentials = await Credentials.open(relay.directory, config);
      await credentials.pair(relay.state.pairing);
      const { caFile: ignored, ...untrusted } = config;
      void ignored;
      const insecure = await Credentials.open(relay.directory, untrusted);
      await expect(insecure.session()).rejects.toMatchObject({ code: 'transport_failed' });
      relay.state.credential = secret();
      await expect(credentials.session()).rejects.toMatchObject({ code: 'credential_rejected' });
    } finally {
      await relay.close();
    }
  });
});
