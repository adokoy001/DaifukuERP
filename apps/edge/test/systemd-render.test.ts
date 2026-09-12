import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { renderSystemd } from '../setup/posix/render.js';
import type { ServiceContext } from '../setup/types.js';
import { PosixFixture } from './posix-fixture.js';
const execute = promisify(execFile);
it('uses the literal single-path WorkingDirectory syntax, while keeping command arguments quoted', () => {
  const context = new PosixFixture('linux').context;
  const unit = renderSystemd(context, 'nogroup');
  expect(unit).toContain('WorkingDirectory=' + context.statePath + '\n');
  expect(unit).toContain('ExecStart="' + context.nodePath + '" "' + context.appPath + '"');
});
// Linux CI requires the actual systemd parser. Other OS jobs exercise their native service managers.
if (process.platform === 'linux') for (const name of ['plain', 'paths with spaces']) it('systemd accepts the rendered unit for ' + name + ' without registering or starting a service', async () => {
  const temporary = await realpath(tmpdir()), directory = await mkdtemp(join(temporary, 'daifuku-systemd-verify-'));
  try {
    const installRoot = join(directory, name), statePath = join(directory, name + ' state'), releaseDir = join(installRoot, 'releases/v1');
    const context: ServiceContext = { platform: 'linux', installationId: '11111111-1111-4111-8111-111111111111', installRoot, statePath, releaseDir, nodePath: join(releaseDir, 'runtime/node'), appPath: join(releaseDir, 'app/edge.mjs'), configPath: join(statePath, 'config.json'), logPath: join(statePath, 'logs'), servicePath: join(installRoot, 'service'), caPath: join(statePath, 'ca-api.pem') };
    await mkdir(join(releaseDir, 'runtime'), { recursive: true }); await mkdir(statePath);
    // The parser checks executable existence, but never executes this fixture binary.
    await copyFile('/usr/bin/true', context.nodePath);
    const path = join(directory, 'daifuku-parser-fixture.service'), unit = renderSystemd(context, 'nogroup');
    await writeFile(path, unit);
    const accepted = await execute('/usr/bin/systemd-analyze', ['verify', path], { timeout: 15000, env: { PATH: '/usr/bin:/bin', LANG: 'C' } });
    expect(accepted.stderr).not.toMatch(/fatal error|bad unit file setting|Unknown key/);
    // This exact pre-fix syntax must be rejected, proving that the native parser regression is effective.
    await writeFile(path, unit.replace('WorkingDirectory=' + statePath, 'WorkingDirectory="' + statePath + '"'));
    await expect(execute('/usr/bin/systemd-analyze', ['verify', path], { timeout: 15000, env: { PATH: '/usr/bin:/bin', LANG: 'C' } })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('WorkingDirectory= path is not absolute') });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
