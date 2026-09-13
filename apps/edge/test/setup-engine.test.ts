import { link, lstat, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupFixture } from './setup-engine-fixture.ts';
import { deploy } from '../setup/engine.ts';
import { operate } from '../setup/operations.ts';
import { pathChain } from '../setup/io.ts';
import type * as SetupIo from '../setup/io.ts';
import { verifyBundle } from '../setup/bundle.ts';

// Production ownership checks are verified separately below. Only the administrative UID/mode
// requirement is relaxed for our disposable, non-root-owned test directories; link checks remain real.
vi.mock('../setup/io.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof SetupIo>();
  return { ...actual, pathChain: vi.fn((path: string, _administrative = false) => actual.pathChain(path, false)) };
});
const fixtures: Awaited<ReturnType<typeof setupFixture>>[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose();
});
async function fixture() {
  const value = await setupFixture();
  fixtures.push(value);
  return value;
}
async function install(value: Awaited<ReturnType<typeof setupFixture>>, execute = true) {
  const bundle = await value.bundle();
  const request = {
    operation: 'install' as const,
    bundle,
    installRoot: value.fixture.installRoot,
    statePath: value.fixture.statePath,
    configSource: value.fixture.configSource,
    execute,
    resume: false,
  };
  const result = await deploy(request, value.adapter);
  return { request, result };
}

it('a valid dry-run inspects protected target ancestors but makes no files, account or service changes', async () => {
  const f = await fixture(),
    bundle = await f.bundle(),
    before = await f.snapshot();
  const request = {
    operation: 'install' as const,
    bundle,
    installRoot: f.fixture.installRoot,
    statePath: f.fixture.statePath,
    configSource: f.fixture.configSource,
    execute: false,
    resume: false,
  };
  expect(await deploy(request, f.adapter)).toMatchObject({ execute: false, retainsCredentialsAndJournal: true });
  expect(await f.snapshot()).toEqual(before);
  expect(f.fixture.events).toEqual([]);
  expect(pathChain).toHaveBeenCalledWith(f.fixture.installRoot, true);
  expect(pathChain).toHaveBeenCalledWith(dirname(f.fixture.statePath), true);
});
it('real administrative path policy and real link checks are not disabled by production code', async () => {
  const f = await fixture(),
    actual = await vi.importActual<typeof SetupIo>('../setup/io.ts');
  if (process.platform !== 'win32')
    await expect(actual.pathChain(f.fixture.root, true)).rejects.toThrow(/administrator_owned/);
  const alias = join(f.fixture.root, 'source-alias');
  await symlink(f.fixture.source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(actual.pathChain(alias)).rejects.toThrow(/unsafe_path_link/);
});
it('rejects manifest hash tampering, additional files and source hardlinks before a deployment is created', async () => {
  const f = await fixture(),
    bundle = await f.bundle();
  await expect(verifyBundle(bundle.directory, '0'.repeat(64))).rejects.toThrow(/manifest_hash_mismatch/);
  const extra = join(bundle.directory, 'unexpected');
  await writeFile(extra, 'extra');
  await expect(verifyBundle(bundle.directory, bundle.manifestHash)).rejects.toThrow(/unexpected_bundle_file/);
  await unlink(extra);
  await link(join(bundle.directory, 'LICENSE'), join(f.fixture.root, 'hardlink'));
  await expect(verifyBundle(bundle.directory, bundle.manifestHash)).rejects.toThrow(
    /unsafe_path_link|unsafe_regular_file/,
  );
  await expect(lstat(f.fixture.installRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(f.fixture.events).toEqual([]);
});
it('rejects a source directory symlink even when the caller supplies the correct manifest digest', async () => {
  const f = await fixture(),
    bundle = await f.bundle(),
    alias = join(f.fixture.root, 'bundle-alias');
  await symlink(bundle.directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(verifyBundle(alias, bundle.manifestHash)).rejects.toThrow(/unsafe_path_link/);
  expect(f.fixture.events).toEqual([]);
});
it('refuses mixed state/install paths and unrelated contents instead of adopting or clearing them', async () => {
  const f = await fixture(),
    bundle = await f.bundle();
  const base = {
    operation: 'install' as const,
    bundle,
    configSource: f.fixture.configSource,
    execute: true,
    resume: false,
  };
  await expect(
    deploy({ ...base, installRoot: f.fixture.installRoot, statePath: join(f.fixture.installRoot, 'data') }, f.adapter),
  ).rejects.toThrow(/must_be_separate/);
  await expect(
    deploy({ ...base, installRoot: f.fixture.source, statePath: f.fixture.statePath }, f.adapter),
  ).rejects.toThrow(/unmanaged_directory_not_empty/);
  expect(f.fixture.events).toEqual([]);
  expect(await readFile(join(bundle.directory, 'LICENSE'), 'utf8')).toContain('synthetic');
});

describe.each(['prepare', 'protect', 'register', 'start'])('explicit resume after %s failure', (step) => {
  it('retains intent and completes only with the same operation, artifact and original configuration', async () => {
    const f = await fixture(),
      bundle = await f.bundle();
    const request = {
      operation: 'install' as const,
      bundle,
      installRoot: f.fixture.installRoot,
      statePath: f.fixture.statePath,
      configSource: f.fixture.configSource,
      execute: true,
      resume: false,
    };
    f.fixture.fail = step;
    await expect(deploy(request, f.adapter)).rejects.toThrow('injected_' + step);
    const markerPath = join(f.fixture.installRoot, 'installation.json');
    const pending = JSON.parse(await readFile(markerPath, 'utf8'));
    expect(pending.pending.operation).toBe('install');
    expect(pending.pending.target.manifestHash).toBe(bundle.manifestHash);
    await expect(deploy(request, f.adapter)).rejects.toThrow(/matching_explicit_resume/);
    await expect(deploy({ ...request, operation: 'update', resume: true }, f.adapter)).rejects.toThrow(
      /matching_explicit_resume/,
    );
    await writeFile(
      f.fixture.configSource,
      JSON.stringify({ ...f.fixture.config, apiBaseUrl: 'https://different.example.test/api' }),
    );
    await expect(deploy({ ...request, resume: true }, f.adapter)).rejects.toThrow(/resume_config_mismatch/);
    await writeFile(f.fixture.configSource, JSON.stringify(f.fixture.config));
    expect(await deploy({ ...request, resume: true }, f.adapter)).toMatchObject({ status: 'installed' });
    const installed = JSON.parse(await readFile(markerPath, 'utf8'));
    expect(installed.installationId).toBe(pending.installationId);
    expect(installed.pending).toBeUndefined();
    expect(installed.status).toBe('installed');
  });
});
it('resumes a service registration that succeeded before its command reported failure', async () => {
  const f = await fixture(),
    bundle = await f.bundle();
  const request = {
    operation: 'install' as const,
    bundle,
    installRoot: f.fixture.installRoot,
    statePath: f.fixture.statePath,
    configSource: f.fixture.configSource,
    execute: true,
    resume: false,
  };
  f.fixture.fail = 'register';
  f.fixture.failAfter = true;
  await expect(deploy(request, f.adapter)).rejects.toThrow(/injected_register/);
  expect(f.fixture.registered).toBeDefined();
  expect(f.fixture.running).toBe(false);
  expect(await deploy({ ...request, resume: true }, f.adapter)).toMatchObject({ status: 'installed' });
});
it('updates and uninstalls through the owned service while retaining old/new code, credentials, journal and configuration', async () => {
  const f = await fixture();
  await install(f);
  const old = f.fixture.registered;
  if (!old) throw new Error('Expected installed fixture');
  const credentials = join(f.fixture.statePath, 'credentials.json'),
    journal = join(f.fixture.statePath, 'journal.json');
  await writeFile(credentials, 'synthetic private credentials');
  await writeFile(journal, 'unresolved device work');
  const config = await readFile(old.configPath);
  const bundle = await f.bundle('v2');
  const update = {
    operation: 'update' as const,
    bundle,
    installRoot: f.fixture.installRoot,
    statePath: f.fixture.statePath,
    execute: true,
    resume: false,
  };
  await expect(deploy({ ...update, configSource: f.fixture.configSource }, f.adapter)).rejects.toThrow(
    /preserves_existing_config/,
  );
  const before = f.fixture.events.length;
  expect(await deploy(update, f.adapter)).toMatchObject({ status: 'installed' });
  const updated = f.fixture.registered;
  if (!updated) throw new Error('Expected updated fixture');
  const events = f.fixture.events.slice(before);
  expect(events.indexOf('stop')).toBeLessThan(events.indexOf('register'));
  expect(await readFile(updated.configPath)).toEqual(config);
  const existing = await f.snapshot();
  const count = f.fixture.events.length;
  await operate({ operation: 'uninstall', installRoot: f.fixture.installRoot, execute: false }, f.adapter);
  expect(await f.snapshot()).toEqual(existing);
  expect(f.fixture.events.length).toBe(count);
  await operate({ operation: 'uninstall', installRoot: f.fixture.installRoot, execute: true }, f.adapter);
  expect(f.fixture.registered).toBeUndefined();
  expect(f.fixture.running).toBe(false);
  expect(await readFile(credentials, 'utf8')).toBe('synthetic private credentials');
  expect(await readFile(journal, 'utf8')).toBe('unresolved device work');
  expect(await readFile(updated.configPath)).toEqual(config);
  expect(await lstat(old.nodePath)).toBeDefined();
  expect(await lstat(updated.nodePath)).toBeDefined();
});
it('a changed source after verification does not register or start partially copied code', async () => {
  const f = await fixture(),
    bundle = await f.bundle();
  await writeFile(join(bundle.directory, 'app/edge.mjs'), 'changed unverified code');
  await expect(
    deploy(
      {
        operation: 'install',
        bundle,
        installRoot: f.fixture.installRoot,
        statePath: f.fixture.statePath,
        configSource: f.fixture.configSource,
        execute: true,
        resume: false,
      },
      f.adapter,
    ),
  ).rejects.toThrow(/changed_during_copy|unsafe_regular_file/);
  expect(f.fixture.events).not.toContain('register');
  expect(f.fixture.events).not.toContain('start');
  const marker = JSON.parse(await readFile(join(f.fixture.installRoot, 'installation.json'), 'utf8'));
  expect(marker.pending).toBeDefined();
  expect(marker.active).toBeUndefined();
});
