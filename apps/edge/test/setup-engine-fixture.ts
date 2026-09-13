import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ServiceAdapter, ServiceContext } from '../setup/types.ts';
import { digest } from '../setup/io.ts';
import { verifyBundle } from '../setup/bundle.ts';
export async function setupFixture() {
  const temporary = await realpath(tmpdir());
  const root = await mkdtemp(join(temporary, 'daifuku-setup-test-'));
  const source = join(root, 'source');
  const installRoot = join(root, 'install');
  const statePath = join(root, 'state');
  const configSource = join(root, 'config-source.json');
  await mkdir(source);
  const config = {
    apiBaseUrl: 'https://erp.example.test/api',
    devices: [
      {
        deviceId: '11111111-1111-4111-8111-111111111111',
        localDeviceId: 'synthetic',
        driver: 'simulator',
        simulationConfirmed: true,
      },
    ],
  };
  await writeFile(configSource, JSON.stringify(config), { mode: 0o600 });
  const fixture = {
    root,
    source,
    installRoot,
    statePath,
    configSource,
    config,
    events: [] as string[],
    registered: undefined as ServiceContext | undefined,
    running: false,
    fail: '',
    failAfter: false,
  };
  function failure(step: string) {
    if (fixture.fail === step) {
      fixture.fail = '';
      throw new Error('injected_' + step);
    }
  }
  const adapter: ServiceAdapter = {
    platform: process.platform as 'linux' | 'darwin' | 'win32',
    serviceId: 'synthetic-service',
    defaults: () => ({ installRoot, statePath }),
    assertAdministrator: async () => {
      fixture.events.push('administrator');
    },
    inspect: async (context) => ({
      serviceExists: Boolean(fixture.registered),
      serviceRunning: fixture.running,
      serviceOwned: Boolean(fixture.registered && fixture.registered.releaseDir === context.releaseDir),
      conflicts:
        fixture.registered && fixture.registered.releaseDir !== context.releaseDir ? ['different_release'] : [],
      ...(fixture.running ? { processId: process.pid } : {}),
    }),
    prepare: async () => {
      fixture.events.push('prepare');
      failure('prepare');
      await mkdir(statePath, { recursive: true, mode: 0o700 });
      await mkdir(join(statePath, 'logs'), { recursive: true, mode: 0o700 });
    },
    protect: async () => {
      fixture.events.push('protect');
      failure('protect');
    },
    register: async (context) => {
      fixture.events.push('register');
      if (!fixture.failAfter) failure('register');
      fixture.registered = context;
      if (fixture.failAfter) failure('register');
    },
    start: async () => {
      fixture.events.push('start');
      if (!fixture.failAfter) failure('start');
      fixture.running = true;
      await writeFile(
        join(statePath, 'service-status.json'),
        JSON.stringify({ pid: process.pid, phase: 'pairing_required', observedAt: new Date().toISOString() }),
        { mode: 0o600 },
      );
      if (fixture.failAfter) failure('start');
    },
    stop: async () => {
      fixture.events.push('stop');
      failure('stop');
      fixture.running = false;
    },
    uninstall: async () => {
      fixture.events.push('uninstall');
      failure('uninstall');
      fixture.running = false;
      fixture.registered = undefined;
    },
  };
  async function bundle(version = 'v1') {
    const directory = join(source, version);
    await mkdir(directory, { recursive: true });
    const entries = [
      'runtime/' + (process.platform === 'win32' ? 'node.exe' : 'node'),
      'app/edge.mjs',
      'setup/setup.mjs',
      'LICENSE',
      'THIRD_PARTY_NOTICES.txt',
      ...(process.platform === 'win32' ? ['wrapper/WinSW.NET461.exe', 'wrapper/LICENSE'] : []),
    ];
    const files = [];
    for (const path of entries) {
      const text = 'synthetic ' + version + ' ' + path;
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), text);
      files.push({
        path,
        bytes: Buffer.byteLength(text),
        sha256: digest(text),
        executable: path.startsWith('runtime/'),
      });
    }
    const raw = JSON.stringify({
      format: 1,
      kind: 'daifuku-edge-bundle',
      releaseId: version,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: '22.23.2',
      files,
    });
    await writeFile(join(directory, 'manifest.json'), raw);
    return verifyBundle(directory, digest(raw));
  }
  async function snapshot(path = root): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const item = join(path, entry.name);
      if (entry.isDirectory()) {
        result[item] = 'directory';
        Object.assign(result, await snapshot(item));
      } else result[item] = digest(await readFile(item));
    }
    return result;
  }
  async function dispose() {
    if (resolve(dirname(root)) !== resolve(temporary) || !root.includes('daifuku-setup-test-'))
      throw new Error('Unexpected fixture cleanup path');
    await rm(root, { recursive: true, force: true });
  }
  return { fixture, adapter, bundle, snapshot, dispose };
}
