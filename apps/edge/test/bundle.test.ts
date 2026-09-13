import { describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Credentials } from '../src/credentials.ts';
import { syncJson } from '../src/files.ts';
import { job, relayFixture, until } from './fixtures.ts';
describe('standalone Linux edge bundle', () => {
  it('runs without node_modules and releases its writer lock after a killed process', async () => {
    const relay = await relayFixture(),
      cwd = fileURLToPath(new URL('../', import.meta.url)),
      run = promisify(execFile);
    let running: ReturnType<typeof spawn> | undefined;
    try {
      await run(process.execPath, ['scripts/build.mjs'], { cwd });
      const executable = join(relay.directory, 'edge.mjs');
      await copyFile(join(cwd, 'dist/edge.mjs'), executable);
      const notices = await readFile(join(cwd, 'dist/THIRD_PARTY_NOTICES.txt'), 'utf8');
      expect(notices).toContain('ws@');
      expect(notices).toContain('zod@');
      expect(notices).toContain('Permission is hereby granted');
      expect(notices).not.toContain('esbuild@');
      expect(await readFile(join(cwd, 'dist/LICENSE'), 'utf8')).toContain('adokoy001');
      const config = relay.config(),
        value = job();
      config.devices = [
        {
          deviceId: value.deviceId,
          localDeviceId: value.localDeviceId,
          driver: 'simulator',
          simulationConfirmed: true,
        },
      ];
      const configPath = join(relay.directory, 'config.json');
      await syncJson(configPath, config);
      const credentials = await Credentials.open(relay.directory, config);
      await credentials.pair(relay.state.pairing);
      const options = ['--config', configPath, '--state', relay.directory];
      relay.state.queued = value;
      const once = await run(process.execPath, [executable, 'once', ...options]);
      expect(once.stdout).toContain('job_succeeded');
      expect(once.stdout).not.toContain(credentials.authorization());
      expect(relay.state.startCalls).toBe(1);
      let output = '';
      running = spawn(process.execPath, [executable, 'run', ...options], { stdio: ['ignore', 'pipe', 'pipe'] });
      running.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });
      await until(() => output.includes('agent_started'));
      await expect(run(process.execPath, [executable, 'session', ...options])).rejects.toMatchObject({
        stderr: expect.stringContaining('another_agent_is_running'),
      });
      running.kill('SIGKILL');
      await new Promise<void>((resolve) => running?.once('exit', () => resolve()));
      running = undefined;
      await until(() => relay.wss.clients.size === 0);
      const session = await run(process.execPath, [executable, 'session', ...options]);
      expect(JSON.parse(session.stdout)).toMatchObject({ gatewayId: relay.session().gatewayId });
      expect(session.stdout).not.toContain(credentials.authorization());
    } finally {
      running?.kill('SIGKILL');
      await relay.close();
    }
  }, 15000);
});
