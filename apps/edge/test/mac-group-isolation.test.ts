import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { isolatedServiceIdentity, matchesMacServiceIdentity } from '../src/service-identity.ts';
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
describe('macOS process group isolation', () => {
  it('accepts only an unprivileged service process with no supplementary groups', () => {
    expect(isolatedServiceIdentity(primary)).toBe(true); expect(isolatedServiceIdentity({ ...primary, groups: [] })).toBe(true);
    for (const extra of [0, 12, 61, 80, 100, 701]) expect(isolatedServiceIdentity({ ...primary, groups: [...primary.groups, extra] })).toBe(false);
    for (const changed of [{ uid: 0 }, { euid: 0 }, { gid: 0 }, { egid: 0 }, { uid: 501 }, { groups: 'unknown' }]) expect(isolatedServiceIdentity({ ...primary, ...changed })).toBe(false);
    expect(isolatedServiceIdentity(undefined)).toBe(false);
  });
  it('requires measured identity, explicit enforcement and exact owned account for Mac readiness', () => {
    const runtime = { identity: primary, groupIsolationRequired: true }, account = { uid: 400, gid: 4294967294 };
    expect(matchesMacServiceIdentity('darwin', runtime, account)).toBe(true);
    for (const altered of [{}, { identity: primary }, { ...runtime, groupIsolationRequired: false }, { ...runtime, identity: { ...primary, groups: [0] } }]) expect(matchesMacServiceIdentity('darwin', altered, account)).toBe(false);
    expect(matchesMacServiceIdentity('darwin', runtime, { ...account, uid: 401 })).toBe(false);
    expect(matchesMacServiceIdentity('darwin', runtime)).toBe(false); expect(matchesMacServiceIdentity('linux', {})).toBe(true);
  });
  it('parses only the explicit environment section and refuses duplicate keys or sections', () => {
    expect(daemonEnvironment('inherited environment = {\n DAIFUKU_EDGE_REQUIRE_ISOLATED_GROUPS => 0\n}\nenvironment = {\n DAIFUKU_EDGE_REQUIRE_ISOLATED_GROUPS => 1\n NODE_EXTRA_CA_CERTS => /private/ca.pem\n}')).toEqual({ DAIFUKU_EDGE_REQUIRE_ISOLATED_GROUPS: '1', NODE_EXTRA_CA_CERTS: '/private/ca.pem' });
    expect(daemonEnvironment('environment = {\n DAIFUKU_EDGE_REQUIRE_ISOLATED_GROUPS = 1\n}')).toEqual({ DAIFUKU_EDGE_REQUIRE_ISOLATED_GROUPS: '1' });
    for (const text of ['DAIFUKU_EDGE_REQUIRE_ISOLATED_GROUPS => 1', 'environment = {\n A => 1\n A => 2\n}', 'environment = {\n A => 1\n}\nenvironment = {\n A => 1\n}']) expect(() => daemonEnvironment(text)).toThrow('environment');
  });
  it('requires InitGroups=false on disk and the fixed guard in the loaded daemon', async () => {
    const f = new PosixFixture('darwin'), adapter = createPosixAdapter('darwin', f);
    await adapter.prepare(f.context); f.addRelease(); await adapter.protect(f.context); await adapter.register(f.context); await adapter.start(f.context);
    expect(renderLaunchDaemon(f.context)).toContain('<key>InitGroups</key><false/>');
    const before = f.changes.length, original = f.loaded; if (!original) throw new Error('Expected synthetic daemon');
    f.loaded = original.replace('<key>DAIFUKU_EDGE_REQUIRE_ISOLATED_GROUPS</key><string>1</string>', '');
    expect((await adapter.inspect(f.context)).conflicts).toEqual([expect.stringContaining('group isolation')]);
    await expect(adapter.start(f.context)).rejects.toThrow('group isolation'); expect(f.changes.length).toBe(before);
    f.loaded = original;
    f.put(macPlistPath, original.replace('<key>InitGroups</key><false/>', '<key>InitGroups</key><true/>'), 0, 0o644);
    expect((await adapter.inspect(f.context)).conflicts).toEqual([expect.stringContaining('registered LaunchDaemon')]);
  });
  it('compares the controller CA with the explicit loaded environment arrow value', async () => {
    const f = new PosixFixture('darwin'); f.context = { ...f.context, caPath: join(f.context.statePath, 'ca-api.pem') };
    const adapter = createPosixAdapter('darwin', f), ca = f.context.caPath;
    if (!ca) throw new Error('Synthetic CA path required');
    await adapter.prepare(f.context); f.addRelease(); f.put(ca, 'synthetic CA', 0); await adapter.protect(f.context);
    await adapter.register(f.context); await adapter.start(f.context);
    expect((await adapter.inspect(f.context)).serviceOwned).toBe(true);
    const loaded = f.loaded; if (!loaded) throw new Error('Expected synthetic daemon');
    f.loaded = loaded.replace(ca, join(f.context.statePath, 'other-ca.pem'));
    expect((await adapter.inspect(f.context)).conflicts).toEqual([expect.stringContaining('CA configuration')]);
  });
  it('does not pair or execute work when required runtime groups are not isolated', async () => {
    const relay = await relayFixture(), abort = new AbortController(), codes: string[] = [];
    const credentials = await Credentials.open(relay.directory, relay.config()), journal = await Journal.open(relay.directory);
    const pair = vi.spyOn(credentials, 'pair'), session = vi.spyOn(credentials, 'session');
    vi.stubEnv('DAIFUKU_EDGE_REQUIRE_ISOLATED_GROUPS', '1');
    const measured = vi.spyOn(identity, 'currentServiceIdentity').mockReturnValue({ ...primary, groups: [4294967294, 100] });
    const run = runService(credentials, journal, relay.directory, abort.signal, (code) => codes.push(code));
    try {
      await until(() => codes.includes('service_group_isolation_failed'));
      await vi.waitFor(async () => expect(await readPrivateJson(join(relay.directory, 'service-status.json'))).toMatchObject({ phase: 'error', groupIsolationRequired: true, identity: { groups: [4294967294, 100] } }));
      expect(pair).not.toHaveBeenCalled(); expect(session).not.toHaveBeenCalled(); expect(relay.state.claims).toBe(0);
    } finally { abort.abort(); await run; measured.mockRestore(); vi.unstubAllEnvs(); await relay.close(); }
  });
});
