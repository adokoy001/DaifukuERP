import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Credentials } from '../src/credentials.ts';
import { Journal } from '../src/journal.ts';
import { connectService } from '../src/pairing-inbox.ts';
import { currentServiceIdentity } from '../src/service-identity.ts';
import { runService, SERVICE_RETRY_MS } from '../src/service.ts';
import { readPrivateJson, syncJson } from '../src/files.ts';
import { relayFixture, secret, until } from './fixtures.ts';

describe('service pairing inbox and durable recovery', () => {
  it('waits without credentials and exposes a private, secret-free service status', async () => {
    const relay = await relayFixture();
    const abort = new AbortController();
    const codes: string[] = [];
    const credentials = await Credentials.open(relay.directory, relay.config());
    const journal = await Journal.open(relay.directory);
    const run = runService(credentials, journal, relay.directory, abort.signal, (code) => codes.push(code));
    try {
      await until(() => codes.includes('pairing_required'));
      const status = await readPrivateJson(join(relay.directory, 'service-status.json'));
      expect(status).toEqual({
        pid: process.pid,
        phase: 'pairing_required',
        observedAt: expect.any(String),
        unprivilegedIdentityRequired: false,
        unprivilegedIdentityVerified: false,
        ...(currentServiceIdentity() ? { identity: currentServiceIdentity() } : {}),
      });
      expect(SERVICE_RETRY_MS).toBeGreaterThanOrEqual(30000);
      expect(relay.state.credential).toBe('');
      expect(JSON.stringify(status)).not.toContain(relay.state.pairing);
      expect(codes).toEqual(['pairing_required']);
    } finally {
      abort.abort();
      await run;
    }
    try {
      expect(await readPrivateJson(join(relay.directory, 'service-status.json'))).toMatchObject({ phase: 'stopped' });
    } finally {
      await relay.close();
    }
  });
  it('takes an inbox once and removes it only after authentication is confirmed', async () => {
    const relay = await relayFixture();
    try {
      const credentials = await Credentials.open(relay.directory, relay.config());
      await syncJson(join(relay.directory, 'pairing.json'), { pairingToken: relay.state.pairing });
      expect(await connectService(credentials, relay.directory)).toBe('running');
      expect((await readdir(relay.directory)).filter((name) => name.startsWith('pairing.'))).toEqual([]);
      expect((await credentials.session()).gatewayId).toBe(relay.session().gatewayId);
    } finally {
      await relay.close();
    }
  });
  it('recovers a lost pairing reply after restart before removing the consumed code', async () => {
    const relay = await relayFixture();
    try {
      const credentials = await Credentials.open(relay.directory, relay.config());
      await syncJson(join(relay.directory, 'pairing.json'), { pairingToken: relay.state.pairing });
      relay.state.pairLost = true;
      await expect(connectService(credentials, relay.directory)).rejects.toThrow('transport_failed');
      expect(await readdir(relay.directory)).toContain('pairing.processing.json');
      expect(relay.state.pairing).toBe('');
      const restarted = await Credentials.open(relay.directory, relay.config());
      const pair = vi.spyOn(restarted, 'pair');
      expect(await connectService(restarted, relay.directory)).toBe('running');
      expect(pair).not.toHaveBeenCalled();
      expect(await readdir(relay.directory)).not.toContain('pairing.processing.json');
    } finally {
      await relay.close();
    }
  });
  it('preserves a rejected code and archives it only when a replacement arrives', async () => {
    const relay = await relayFixture();
    try {
      const credentials = await Credentials.open(relay.directory, relay.config());
      const invalid = { pairingToken: secret() };
      await syncJson(join(relay.directory, 'pairing.json'), invalid);
      await expect(connectService(credentials, relay.directory)).rejects.toThrow('credential_rejected');
      expect(await readPrivateJson(join(relay.directory, 'pairing.processing.json'))).toEqual(invalid);
      await syncJson(join(relay.directory, 'pairing.json'), { pairingToken: relay.state.pairing });
      expect(await connectService(credentials, relay.directory)).toBe('running');
      const names = (await readdir(relay.directory)).filter((name) => name.startsWith('pairing-rejected-'));
      expect(names).toHaveLength(1);
      const name = names[0];
      if (!name) throw new Error('Missing synthetic archive');
      expect(await readPrivateJson(join(relay.directory, name))).toEqual(invalid);
    } finally {
      await relay.close();
    }
  });
  it('retains both private inboxes when the archive limit is reached', async () => {
    const relay = await relayFixture();
    try {
      const credentials = await Credentials.open(relay.directory, relay.config());
      const old = { pairingToken: secret() };
      const next = { pairingToken: relay.state.pairing };
      await syncJson(join(relay.directory, 'pairing.processing.json'), old);
      await syncJson(join(relay.directory, 'pairing.json'), next);
      for (let i = 0; i < 10; i++)
        await syncJson(join(relay.directory, 'pairing-rejected-' + randomUUID() + '.json'), old);
      await expect(connectService(credentials, relay.directory)).rejects.toThrow('pairing_archive_full');
      expect(await readPrivateJson(join(relay.directory, 'pairing.processing.json'))).toEqual(old);
      expect(await readPrivateJson(join(relay.directory, 'pairing.json'))).toEqual(next);
      expect(relay.state.credential).toBe('');
    } finally {
      await relay.close();
    }
  });
  it('stops on rejected credentials and re-pairs only through a new private code', async () => {
    const relay = await relayFixture();
    try {
      const credentials = await Credentials.open(relay.directory, relay.config());
      await credentials.pair(relay.state.pairing);
      relay.state.credential = secret();
      relay.state.pairing = secret();
      expect(await connectService(credentials, relay.directory)).toBe('credential_rejected');
      expect(relay.state.claims).toBe(0);
      await syncJson(join(relay.directory, 'pairing.json'), { pairingToken: relay.state.pairing });
      expect(await connectService(credentials, relay.directory)).toBe('running');
      expect((await credentials.session()).gatewayId).toBe(relay.session().gatewayId);
    } finally {
      await relay.close();
    }
  });
  it('leaves a malformed processing file private and does not submit it', async () => {
    const relay = await relayFixture();
    try {
      const credentials = await Credentials.open(relay.directory, relay.config());
      await syncJson(join(relay.directory, 'pairing.json'), { pairingToken: 'invalid' });
      await expect(connectService(credentials, relay.directory)).rejects.toThrow('invalid_pairing_file');
      expect(await readPrivateJson(join(relay.directory, 'pairing.processing.json'))).toEqual({
        pairingToken: 'invalid',
      });
      expect(relay.state.credential).toBe('');
    } finally {
      await relay.close();
    }
  });
});
