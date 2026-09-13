import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { unprivilegedServiceIdentity, matchesMacServiceIdentity } from '../src/service-identity.ts';
import * as membership from '../src/macos-membership.ts';
import * as identity from '../src/service-identity.ts';
import { renderLaunchDaemon } from '../setup/posix/render.ts';
import { createPosixAdapter } from '../setup/platform-posix.ts';
import { daemonEnvironment, macPlistPath } from '../setup/posix/service-mac.ts';
import { PosixFixture } from './posix-fixture.ts';
import { runService } from '../src/service.ts';
import { Credentials } from '../src/credentials.ts';
import { Journal } from '../src/journal.ts';
import { readPrivateJson } from '../src/files.ts';
import { relayFixture, until } from './fixtures.ts';
const primary = { uid: 400, euid: 400, gid: 4294967294, egid: 4294967294, groups: [4294967294] };
describe('macOS unprivileged process identity', () => {
  it('accepts OS ordinary memberships but rejects administrative process capabilities', () => {
    expect(unprivilegedServiceIdentity(primary)).toBe(true);
    expect(unprivilegedServiceIdentity({ ...primary, groups: [] })).toBe(false);
    expect(unprivilegedServiceIdentity({ ...primary, groups: [4294967294, 12, 61, 100, 701] })).toBe(true);
    for (const extra of [0, 80, 98, 204])
      expect(unprivilegedServiceIdentity({ ...primary, groups: [...primary.groups, extra] })).toBe(false);
    for (const changed of [{ uid: 0 }, { euid: 0 }, { gid: 0 }, { egid: 0 }, { uid: 501 }, { groups: 'unknown' }])
      expect(unprivilegedServiceIdentity({ ...primary, ...changed })).toBe(false);
    expect(unprivilegedServiceIdentity(undefined)).toBe(false);
  });
  it('requires measured identity, explicit enforcement and exact owned account for Mac readiness', () => {
    const runtime = { identity: primary, unprivilegedIdentityRequired: true, unprivilegedIdentityVerified: true },
      account = { uid: 400, gid: 4294967294, groups: primary.groups };
    expect(matchesMacServiceIdentity('darwin', runtime, account)).toBe(true);
    for (const altered of [
      {},
      { identity: primary },
      { ...runtime, unprivilegedIdentityRequired: false },
      { ...runtime, unprivilegedIdentityVerified: false },
      { ...runtime, identity: { ...primary, groups: [0] } },
    ])
      expect(matchesMacServiceIdentity('darwin', altered, account)).toBe(false);
    expect(matchesMacServiceIdentity('darwin', runtime, { ...account, uid: 401 })).toBe(false);
    expect(matchesMacServiceIdentity('darwin', runtime, { ...account, groups: [4294967294, 701] })).toBe(false);
    expect(matchesMacServiceIdentity('darwin', runtime)).toBe(false);
    expect(matchesMacServiceIdentity('linux', {})).toBe(true);
  });
  it('parses only the explicit environment section and refuses duplicate keys or sections', () => {
    expect(
      daemonEnvironment(
        'inherited environment = {\n DAIFUKU_EDGE_REQUIRE_UNPRIVILEGED_IDENTITY => 0\n}\nenvironment = {\n DAIFUKU_EDGE_REQUIRE_UNPRIVILEGED_IDENTITY => 1\n NODE_EXTRA_CA_CERTS => /private/ca.pem\n}',
      ),
    ).toEqual({ DAIFUKU_EDGE_REQUIRE_UNPRIVILEGED_IDENTITY: '1', NODE_EXTRA_CA_CERTS: '/private/ca.pem' });
    expect(daemonEnvironment('environment = {\n DAIFUKU_EDGE_REQUIRE_UNPRIVILEGED_IDENTITY = 1\n}')).toEqual({
      DAIFUKU_EDGE_REQUIRE_UNPRIVILEGED_IDENTITY: '1',
    });
    for (const text of [
      'DAIFUKU_EDGE_REQUIRE_UNPRIVILEGED_IDENTITY => 1',
      'environment = {\n A => 1\n A => 2\n}',
      'environment = {\n A => 1\n}\nenvironment = {\n A => 1\n}',
    ])
      expect(() => daemonEnvironment(text)).toThrow('environment');
  });
  it('requires standard InitGroups=true on disk and the fixed guard in the loaded daemon', async () => {
    const f = new PosixFixture('darwin'),
      adapter = createPosixAdapter('darwin', f);
    await adapter.prepare(f.context);
    f.addRelease();
    await adapter.protect(f.context);
    await adapter.register(f.context);
    await adapter.start(f.context);
    expect(renderLaunchDaemon(f.context)).toContain('<key>InitGroups</key><true/>');
    const before = f.changes.length,
      original = f.loaded;
    if (!original) throw new Error('Expected synthetic daemon');
    f.loaded = original.replace('<key>DAIFUKU_EDGE_REQUIRE_UNPRIVILEGED_IDENTITY</key><string>1</string>', '');
    expect((await adapter.inspect(f.context)).conflicts).toEqual([expect.stringContaining('unprivileged identity')]);
    await expect(adapter.start(f.context)).rejects.toThrow('unprivileged identity');
    expect(f.changes.length).toBe(before);
    f.loaded = original;
    f.put(macPlistPath, original.replace('<key>InitGroups</key><true/>', '<key>InitGroups</key><false/>'), 0, 0o644);
    expect((await adapter.inspect(f.context)).conflicts).toEqual([expect.stringContaining('registered LaunchDaemon')]);
  });
  it('compares the controller CA with the explicit loaded environment arrow value', async () => {
    const f = new PosixFixture('darwin');
    f.context = { ...f.context, caPath: join(f.context.statePath, 'ca-api.pem') };
    const adapter = createPosixAdapter('darwin', f),
      ca = f.context.caPath;
    if (!ca) throw new Error('Synthetic CA path required');
    await adapter.prepare(f.context);
    f.addRelease();
    f.put(ca, 'synthetic CA', 0);
    await adapter.protect(f.context);
    await adapter.register(f.context);
    await adapter.start(f.context);
    expect((await adapter.inspect(f.context)).serviceOwned).toBe(true);
    const loaded = f.loaded;
    if (!loaded) throw new Error('Expected synthetic daemon');
    f.loaded = loaded.replace(ca, join(f.context.statePath, 'other-ca.pem'));
    expect((await adapter.inspect(f.context)).conflicts).toEqual([expect.stringContaining('CA configuration')]);
  });
  it('runs unpaired with ordinary OS groups after verifying no explicit additions', async () => {
    const relay = await relayFixture(),
      abort = new AbortController(),
      codes: string[] = [];
    const credentials = await Credentials.open(relay.directory, relay.config()),
      journal = await Journal.open(relay.directory);
    const groups = [4294967294, 12, 61, 100, 701];
    vi.stubEnv('DAIFUKU_EDGE_REQUIRE_UNPRIVILEGED_IDENTITY', '1');
    const measured = vi.spyOn(identity, 'currentServiceIdentity').mockReturnValue({ ...primary, groups });
    const verified = vi.spyOn(membership, 'macAccountGroups').mockResolvedValue([12, 61, 100, 701, 4294967294]);
    const run = runService(credentials, journal, relay.directory, abort.signal, (code) => codes.push(code));
    try {
      await until(() => codes.includes('pairing_required'));
      expect(verified).toHaveBeenCalled();
      expect(relay.state.claims).toBe(0);
    } finally {
      abort.abort();
      await run;
      measured.mockRestore();
      verified.mockRestore();
      vi.unstubAllEnvs();
      await relay.close();
    }
  });
  it('does not pair or execute work when runtime has a privileged membership', async () => {
    const relay = await relayFixture(),
      abort = new AbortController(),
      codes: string[] = [];
    const credentials = await Credentials.open(relay.directory, relay.config()),
      journal = await Journal.open(relay.directory);
    const pair = vi.spyOn(credentials, 'pair'),
      session = vi.spyOn(credentials, 'session');
    vi.stubEnv('DAIFUKU_EDGE_REQUIRE_UNPRIVILEGED_IDENTITY', '1');
    const measured = vi
      .spyOn(identity, 'currentServiceIdentity')
      .mockReturnValue({ ...primary, groups: [4294967294, 80] });
    const run = runService(credentials, journal, relay.directory, abort.signal, (code) => codes.push(code));
    try {
      await until(() => codes.includes('service_identity_not_unprivileged'));
      await vi.waitFor(async () =>
        expect(await readPrivateJson(join(relay.directory, 'service-status.json'))).toMatchObject({
          phase: 'error',
          unprivilegedIdentityRequired: true,
          identity: { groups: [4294967294, 80] },
        }),
      );
      expect(pair).not.toHaveBeenCalled();
      expect(session).not.toHaveBeenCalled();
      expect(relay.state.claims).toBe(0);
    } finally {
      abort.abort();
      await run;
      measured.mockRestore();
      vi.unstubAllEnvs();
      await relay.close();
    }
  });
});
