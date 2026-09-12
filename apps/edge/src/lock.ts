import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { EdgeError } from './errors.ts';
import { privateDirectory } from './files.ts';
/** Kernel flock survives PID reuse and is released on crashes, without unsafe stale-lock takeover. */
export async function acquireWriter(directory: string, onLost: () => void): Promise<() => Promise<void>> {
  if (process.platform !== 'linux') throw new EdgeError('linux_flock_required');
  await privateDirectory(directory);
  const path = join(directory, 'writer.lock'), handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  const stat = await handle.stat(); if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid?.()) { await handle.close(); throw new EdgeError('unsafe_writer_lock'); }
  await handle.close();
  const helper = "process.stdout.write('locked');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));";
  const child = spawn('/usr/bin/flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', path, process.execPath, '-e', helper], { stdio: ['pipe', 'pipe', 'ignore'], shell: false });
  let released = false, acquired = false;
  child.once('exit', () => { if (acquired && !released) onLost(); });
  await new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new EdgeError('flock_unavailable')));
    child.once('exit', (code) => { if (!acquired) reject(new EdgeError(code === 73 ? 'another_agent_is_running' : 'writer_lock_failed')); });
    child.stdout.once('data', (data: Buffer) => { if (data.toString() === 'locked') { acquired = true; resolve(); } else { child.kill(); reject(new EdgeError('writer_lock_failed')); } });
  });
  return async () => { released = true; child.stdin.end(); if (child.exitCode === null) await new Promise<void>((resolve) => child.once('exit', () => resolve())); };
}
