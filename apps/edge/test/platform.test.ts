import { describe, expect, it } from 'vitest';
import { chmod, lstat, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { privateDirectory, readPrivateJson, syncJson } from '../src/files.ts';
import { acquireWriter } from '../src/lock.ts';
import { readPrivateSource } from '../setup/source.ts';
const base = process.platform === 'win32' ? process.env.ProgramData ?? 'C:\\ProgramData' : await realpath(tmpdir());
async function directory() { const path = process.platform === 'win32' ? join(base, 'DaifukuEdgeTest-' + randomUUID()) : await mkdtemp(join(base, 'DaifukuEdgeTest-')); await privateDirectory(path); return path; }
async function cleanup(path: string) { if (dirname(resolve(path)) !== resolve(base) || !/^DaifukuEdgeTest-[a-zA-Z0-9-]+$/.test(basename(path)) || (await lstat(path)).isSymbolicLink()) throw new Error('Unsafe synthetic cleanup path'); await rm(path, { recursive: true, force: true }); }
async function eventuallyLock(path: string): Promise<() => Promise<void>> { for (let n = 0; n < 8; n++) { try { return await acquireWriter(path, () => undefined); } catch (error) { if (!(error instanceof Error) || error.message !== 'another_agent_is_running') throw error; await new Promise((resolve) => setTimeout(resolve, 100)); } } throw new Error('OS did not release the terminated writer'); }
describe('native platform privacy and process-owned writer locks', () => {
  it('persists private Unicode documents and rejects an additional public permission', async () => {
    const dir = await directory(), path = join(dir, 'private.json');
    try {
      await syncJson(path, { text: '日本語の合成データ', version: 1 }); await syncJson(path, { text: '日本語の合成データ', version: 2 }); expect(await readPrivateJson(path)).toEqual({ text: '日本語の合成データ', version: 2 });
      expect(JSON.parse((await readPrivateSource(path, 65536)).toString('utf8'))).toEqual({ text: '日本語の合成データ', version: 2 });
      if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [path, '/grant', '*S-1-1-0:(R)'], { windowsHide: true });
      else if (process.platform === 'darwin') await promisify(execFile)('/bin/chmod', ['+a', 'everyone allow read', path]);
      else await chmod(path, 0o644);
      await expect(readPrivateJson(path)).rejects.toThrow(/private_file/); await expect(readPrivateSource(path, 65536)).rejects.toThrow(/private_file/);
    } finally { await cleanup(dir); }
  }, 60000);
  it('rejects a state-directory symlink or Windows junction before persisting a secret', async () => {
    const dir = await directory(), link = join(dir, 'linked'), target = join(dir, 'target');
    try { await privateDirectory(target); await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir'); await expect(privateDirectory(link)).rejects.toThrow(/unsafe_state/); await expect(syncJson(join(link, 'secret.json'), { synthetic: true })).rejects.toThrow(/unsafe_state/); }
    finally { await cleanup(dir); }
  }, 60000);
  it('rejects a concurrent writer and reacquires after its process is killed, without deleting the lock', async () => {
    const dir = await directory();
    const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)), fileURLToPath(new URL('./scripts/platform-probe.ts', import.meta.url)), 'hold', dir], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    try {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Synthetic writer startup timed out')), 25000); child.stdout.once('data', (data: Buffer) => { clearTimeout(timer); if (data.toString().trim() === 'locked') resolve(); else reject(new Error('Synthetic writer did not acquire its lock')); }); child.once('error', reject); child.once('exit', () => { clearTimeout(timer); reject(new Error('Synthetic writer exited before lock acquisition')); }); });
      await expect(acquireWriter(dir, () => undefined)).rejects.toThrow('another_agent_is_running');
      child.kill('SIGKILL'); await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      const release = await eventuallyLock(dir); await release(); expect((await lstat(join(dir, 'writer.lock'))).isFile()).toBe(true);
    } finally { if (child.exitCode === null) child.kill('SIGKILL'); await cleanup(dir); }
  }, 90000);
});
