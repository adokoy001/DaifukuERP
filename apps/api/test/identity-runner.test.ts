import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
const runner = fileURLToPath(new URL('../../../scripts/test-identity-e2e.mjs', import.meta.url));
const fixture = `import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
if(process.argv[2]==='server') {
 const server=createServer((_req,res)=>res.end('ok')).listen(Number(process.argv[3]),'127.0.0.1',()=>process.stdout.write('fixture-listening:'+process.argv[3]+':'+process.pid+'\\n'));
 for(const name of ['SIGTERM','SIGINT']) process.on(name,()=>server.close(()=>process.exit(0)));
} else {
 const port=process.argv.includes('tsx')?3109:process.argv.includes('vite')?5189:0;
 const child=spawn(process.execPath,[import.meta.filename,'server',String(port)],{stdio:'inherit'});
 process.on('SIGTERM',()=>{}); process.on('SIGINT',()=>{}); child.on('exit',()=>process.exit(0));
}`;
function environment(cli: string) { return { ...process.env, npm_execpath: cli, E2E_IDENTITY_PREPARE: '1', TEST_DATABASE_URL_OWNER: 'postgres://owner:synthetic@127.0.0.1/daifuku_e2e_test_enterprise', TEST_DATABASE_URL: 'postgres://daifuku_app:synthetic@127.0.0.1/daifuku_e2e_test_enterprise', E2E_IDENTITY_BASE_URL: 'http://localhost:5189' }; }
async function available(port: number) { await new Promise<void>((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(() => resolve())); }); }
describe('identity fixture runner isolation', () => {
  it('rejects an ambient external browser URL before launching any service', async () => {
    const child = spawn(process.execPath, [runner], { env: { ...environment('/does-not-run'), E2E_IDENTITY_BASE_URL: 'https://outside.example.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = ''; child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString(); });
    expect((await once(child, 'exit'))[0]).toBe(1); expect(error).toContain('fixed local fixture origin'); expect(error).not.toContain('Cannot find module');
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) it(`stops and awaits its detached service descendants on ${signal}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'daifuku-identity-runner-')), cli = join(directory, 'fixture.mjs');
    await writeFile(cli, fixture); await available(3109); await available(5189);
    const child = spawn(process.execPath, [runner], { env: environment(cli), stdio: ['ignore', 'pipe', 'pipe'] });
    const finished = once(child, 'exit'), serviceIds: number[] = []; let output = '';
    let signalReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => { signalReady = resolve; });
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); if (output.includes('fixture-listening:5189:')) signalReady(); });
    try {
      await Promise.race([ready, finished.then(() => { throw new Error('Fixture exited before readiness'); })]);
      for (const match of output.matchAll(/fixture-listening:\d+:(\d+)/g)) serviceIds.push(Number(match[1]));
      child.kill(signal); expect((await finished)[0]).toBe(signal === 'SIGINT' ? 130 : 143);
      await available(3109); await available(5189);
    } finally {
      child.kill('SIGTERM'); for (const pid of serviceIds) try { process.kill(pid, 'SIGTERM'); } catch { /* fixture exited */ }
      await rm(directory, { recursive: true, force: true });
    }
  }, 15000);
});
