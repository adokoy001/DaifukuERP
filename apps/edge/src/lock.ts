import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { EdgeError } from './errors.ts';
import { privateDirectory } from './files.ts';
import { assertNoMacAcl, macosLockScript } from './macos.ts';
import { windowsHelper } from './windows.ts';
function posixHelper(path: string) {
  if (process.platform === 'darwin')
    return spawn('/bin/zsh', ['-f', '-c', macosLockScript, 'edge-lock', path], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
  const helper =
    "process.stdout.write('locked\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));";
  return spawn(
    '/usr/bin/flock',
    ['--exclusive', '--nonblock', '--conflict-exit-code', '73', path, process.execPath, '-e', helper],
    { stdio: ['pipe', 'pipe', 'pipe'], shell: false },
  );
}
async function hold(
  child: ReturnType<typeof posixHelper> | ReturnType<typeof windowsHelper>,
  onLost: () => void,
): Promise<() => Promise<void>> {
  let released = false;
  let acquired = false;
  child.stderr?.resume();
  child.stdin.on('error', () => undefined);
  child.once('exit', () => {
    if (acquired && !released) onLost();
  });
  await new Promise<void>((resolve, reject) => {
    let pending = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new EdgeError('writer_lock_start_timeout'));
    }, 20000);
    const fail = (code: string) => {
      clearTimeout(timer);
      reject(new EdgeError(code));
    };
    child.once('error', () => fail('os_lock_unavailable'));
    child.once('exit', (code) => {
      if (!acquired)
        fail(code === 73 ? 'another_agent_is_running' : code === 69 ? 'os_lock_unavailable' : 'writer_lock_failed');
    });
    child.stdout.on('data', (data: Buffer) => {
      if (acquired) return;
      pending += data.toString('utf8');
      if (pending === 'locked\n' || pending === 'locked\r\n') {
        clearTimeout(timer);
        acquired = true;
        resolve();
      } else if (pending.length > 32 || pending.includes('\n')) {
        child.kill();
        fail('writer_lock_failed');
      }
    });
  });
  return async () => {
    released = true;
    child.stdin.end();
    if (child.exitCode === null) await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  };
}
/** OS-owned locks survive PID reuse and release on crashes, without timeout-based takeover. */
export async function acquireWriter(directory: string, onLost: () => void): Promise<() => Promise<void>> {
  if (!['linux', 'darwin', 'win32'].includes(process.platform)) throw new EdgeError('unsupported_platform');
  await privateDirectory(directory);
  const path = join(directory, 'writer.lock');
  if (process.platform === 'win32') {
    const child = windowsHelper('lock', { path });
    return hold(child, onLost);
  }
  const handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid?.())
      throw new EdgeError('unsafe_writer_lock');
    await assertNoMacAcl(path);
  } finally {
    await handle.close();
  }
  return hold(posixHelper(path), onLost);
}
