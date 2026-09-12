import { chmod, link, lstat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPrivateSource } from '../setup/source.ts';
import { prepareConfig } from '../setup/configuration.ts';
import { deploy } from '../setup/engine.ts';
import { operate } from '../setup/operations.ts';
import { setupFixture } from './setup-engine-fixture.ts';
import type * as SetupIo from '../setup/io.ts';
// Only the root-owned ancestor requirement is relaxed for this isolated non-root fixture.
// File mode, no-follow, size and hardlink checks still use real filesystem handles.
vi.mock('../setup/io.ts', async (original) => {
  const actual = await original<typeof SetupIo>();
  return { ...actual, pathChain: (path: string) => actual.pathChain(path, false) };
});
const fixtures: Awaited<ReturnType<typeof setupFixture>>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.dispose(); });
async function fixture() { const value = await setupFixture(); fixtures.push(value); return value; }
async function install(f: Awaited<ReturnType<typeof setupFixture>>) {
  await deploy({ operation: 'install', bundle: await f.bundle(), installRoot: f.fixture.installRoot, statePath: f.fixture.statePath, configSource: f.fixture.configSource, execute: true, resume: false }, f.adapter);
}
describe('protected installer inputs and truthful runtime freshness', () => {
  it('reads a private input owned by the caller and rejects an oversized input', async () => {
    const f = await fixture();
    expect(JSON.parse((await readPrivateSource(f.fixture.configSource, 65536)).toString('utf8'))).toEqual(f.fixture.config);
    await expect(readPrivateSource(f.fixture.configSource, 4)).rejects.toThrow('invalid_state_file');
  });
  it('rejects a readable-by-others configuration before preparing any managed files', async () => {
    const f = await fixture(); await chmod(f.fixture.configSource, 0o644);
    await expect(prepareConfig(f.fixture.configSource, f.fixture.statePath)).rejects.toThrow('private_file_permissions_required');
    await expect(lstat(f.fixture.statePath)).rejects.toMatchObject({ code: 'ENOENT' }); expect(f.fixture.events).toEqual([]);
  });
  it('rejects source aliases rather than copying an unsafe input', async () => {
    const f = await fixture(), alias = join(f.fixture.root, 'alias.json'), hard = join(f.fixture.root, 'hard.json');
    await symlink(f.fixture.configSource, alias); await expect(readPrivateSource(alias, 65536)).rejects.toThrow('unsafe_path_link');
    await link(f.fixture.configSource, hard); await expect(readPrivateSource(hard, 65536)).rejects.toThrow(/unsafe_path_link|invalid_state_file/);
  });
  it('does not queue a world-readable pairing token or mutate the service', async () => {
    const f = await fixture(); await install(f);
    const source = join(f.fixture.root, 'pair.json'); await writeFile(source, JSON.stringify({ pairingToken: 's'.repeat(43) }), { mode: 0o644 });
    const events = [...f.fixture.events];
    await expect(operate({ operation: 'pair', installRoot: f.fixture.installRoot, execute: true, pairingSource: source }, f.adapter)).rejects.toThrow('private_file_permissions_required');
    expect(f.fixture.events).toEqual(events); await expect(lstat(join(f.fixture.statePath, 'pairing.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['unowned', 'private_file_conflict'] as const)('marks a matching PID heartbeat unhealthy when inspection reports %s', async (failure) => {
    const f = await fixture(); await install(f);
    const inspect = f.adapter.inspect;
    f.adapter.inspect = async (context) => ({ ...await inspect(context), serviceOwned: failure !== 'unowned', conflicts: failure === 'private_file_conflict' ? ['Private file permissions changed.'] : [] });
    expect(await operate({ operation: 'status', installRoot: f.fixture.installRoot, execute: false }, f.adapter)).toMatchObject({ serviceRunning: true, processId: process.pid, runtimeStatusFresh: false });
  });
});
